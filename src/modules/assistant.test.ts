import { describe, expect, test } from "bun:test";
import { Collection, type Message } from "discord.js";
import {
  ACTIVE_CONVERSATION_GAP_MS,
  SUMMARY_TRANSCRIPT_CHUNK_LIMIT,
  chunkContextMessages,
  collectConversationContext,
  estimateContextCharacters,
  extractAssistantPrompt,
  isAssistantInvocation,
  isSummaryConnected,
  limitMultimodalAttachments,
  retainPriorityContext,
  selectConversationSections,
  toAssistantEmoji,
} from "./assistant";
import type { AssistantSummaryCacheEntry } from "./assistant-summary-cache";

interface FakeMessageInput {
  id: string;
  createdTimestamp: number;
  authorId?: string;
  content?: string;
  replyTo?: string;
}

function fakeMessages(inputs: FakeMessageInput[]): Map<string, Message> {
  const ordered = [...inputs].sort((left, right) => left.createdTimestamp - right.createdTimestamp);
  const messages = new Map<string, Message>();
  const channel = {
    id: "channel",
    messages: {
      fetch: async (request: string | { before: string; limit: number }) => {
        if (typeof request === "string") {
          const result = messages.get(request);
          if (!result) throw new Error("Unknown message");
          return result;
        }

        const beforeIndex = ordered.findIndex(input => input.id === request.before);
        const eligible = ordered.slice(0, beforeIndex < 0 ? ordered.length : beforeIndex);
        const page = eligible.slice(-request.limit).reverse();
        return new Collection(page.map(input => [input.id, messages.get(input.id)!]));
      },
    },
  };

  for (const input of ordered) {
    messages.set(input.id, {
      id: input.id,
      content: input.content ?? input.id,
      createdTimestamp: input.createdTimestamp,
      reference: input.replyTo ? { messageId: input.replyTo } : null,
      author: { id: input.authorId ?? "user", username: input.authorId ?? "user" },
      member: null,
      embeds: [],
      attachments: new Collection(),
      channel,
    } as unknown as Message);
  }

  return messages;
}

function cacheEntry(overrides: Partial<AssistantSummaryCacheEntry> = {}): AssistantSummaryCacheEntry {
  return {
    channelId: "channel",
    content: "Older summary",
    sourceStartedAt: 0,
    sourceEndedAt: 1,
    generatedAt: 1,
    model: "openrouter/free",
    usedFallback: false,
    createdAt: 1,
    updatedAt: 1,
    lastAccessedAt: 1,
    lastConversationActivityAt: 1,
    summarizedThroughMessageId: "source",
    summarizedThroughTimestamp: 1,
    sourceMessageIds: ["source"],
    continuationAnchorIds: ["assistant-reply"],
    estimatedBytes: 1_000,
    ...overrides,
  };
}

describe("assistant message helpers", () => {
  test("removes both Discord mention forms", () => {
    expect(extractAssistantPrompt("<@123>  what happened?", "123")).toBe("what happened?");
    expect(extractAssistantPrompt("<@!123> do the thing", "123")).toBe("do the thing");
  });

  test("does not remove mentions for a different bot id", () => {
    expect(extractAssistantPrompt("<@456> hello", "123")).toBe("<@456> hello");
  });

  test("keeps only the first four image/PDF attachments", () => {
    const attachments = [
      ...Array.from({ length: 5 }, (_, index) => ({
        filename: `image-${index}.png`,
        url: `https://cdn.example/image-${index}.png`,
        contentType: "image/png",
      })),
      {
        filename: "notes.txt",
        url: "https://cdn.example/notes.txt",
        contentType: "text/plain",
      },
    ];

    expect(limitMultimodalAttachments(attachments)).toHaveLength(4);
    expect(limitMultimodalAttachments(attachments).every(attachment => attachment.filename.endsWith(".png"))).toBe(true);
  });

  test("formats static and animated custom emojis for Discord", () => {
    expect(toAssistantEmoji({ id: "123", name: "COPIUM", animated: false }, "Playful denial.")).toEqual({
      id: "123",
      name: "COPIUM",
      token: "<:COPIUM:123>",
      description: "Playful denial.",
    });
    expect(toAssistantEmoji({ id: "456", name: "hype", animated: true })).toMatchObject({
      token: "<a:hype:456>",
    });
  });

  test("invokes on a mention or a direct reply to the assistant", () => {
    expect(isAssistantInvocation(true, undefined, "bot")).toBe(true);
    expect(isAssistantInvocation(false, "bot", "bot")).toBe(true);
    expect(isAssistantInvocation(false, "someone-else", "bot")).toBe(false);
  });

  test("keeps the eight newest ambient messages in recent focus", () => {
    const ambient = Array.from({ length: 12 }, (_, index) => ({
      id: `message-${index}`,
      author: "Alex",
      content: `${index}`,
      createdTimestamp: index,
    }));
    const sections = selectConversationSections([], ambient);

    expect(sections.recentFocus.map(message => message.id)).toEqual(
      Array.from({ length: 8 }, (_, index) => `message-${index + 4}`),
    );
    expect(sections.supportingRecentContext).toHaveLength(4);
  });

  test("reuses summaries for active or reply-linked conversations only", () => {
    const entry = cacheEntry({ lastConversationActivityAt: 1_000 });

    expect(isSummaryConnected(entry, 1_000 + ACTIVE_CONVERSATION_GAP_MS, [])).toBe(true);
    expect(isSummaryConnected(entry, 1_000 + ACTIVE_CONVERSATION_GAP_MS + 1, ["assistant-reply"])).toBe(true);
    expect(isSummaryConnected(entry, 1_000 + ACTIVE_CONVERSATION_GAP_MS + 1, ["unrelated"])).toBe(false);
  });

  test("collects paginated active history", async () => {
    const now = 2_000_000;
    const inputs = Array.from({ length: 120 }, (_, index) => ({
      id: `message-${index}`,
      createdTimestamp: now - (120 - index) * 1_000,
    }));
    inputs.push({ id: "current", createdTimestamp: now });
    const messages = fakeMessages(inputs);

    const collected = await collectConversationContext(messages.get("current")!, "bot", null);
    expect(collected.ambientContext).toHaveLength(120);
    expect(collected.ambientContext[0]?.id).toBe("message-0");
  });

  test("caps exceptionally busy active history at 500 messages", async () => {
    const now = 3_000_000;
    const inputs = Array.from({ length: 600 }, (_, index) => ({
      id: `busy-${index}`,
      createdTimestamp: now - (600 - index) * 100,
    }));
    inputs.push({ id: "current", createdTimestamp: now });
    const messages = fakeMessages(inputs);

    const collected = await collectConversationContext(messages.get("current")!, "bot", null);
    expect(collected.ambientContext).toHaveLength(500);
  });

  test("stops ambient history at 15 minutes but follows old reply ancestors", async () => {
    const now = 5_000_000;
    const messages = fakeMessages([
      { id: "old-root", createdTimestamp: 1_000 },
      { id: "old-direct", createdTimestamp: 2_000, replyTo: "old-root", authorId: "bot" },
      { id: "old-branch", createdTimestamp: 3_000 },
      { id: "recent-one", createdTimestamp: now - 10_000 },
      { id: "recent-two", createdTimestamp: now - 5_000, replyTo: "old-branch" },
      { id: "current", createdTimestamp: now, replyTo: "old-direct" },
    ]);

    const collected = await collectConversationContext(
      messages.get("current")!,
      "bot",
      messages.get("old-direct")!,
    );

    expect(collected.directReplyFocus.map(message => message.id)).toEqual(["old-root", "old-direct"]);
    expect(collected.ambientContext.map(message => message.id)).toEqual([
      "old-branch",
      "recent-one",
      "recent-two",
    ]);
  });

  test("keeps direct reply context ahead of ambient overflow", () => {
    const direct = [{
      id: "direct",
      author: "Bot",
      content: "d".repeat(150_000),
      createdTimestamp: 1,
      isAssistant: true,
    }];
    const ambient = [
      { id: "ambient-old", author: "Alex", content: "a".repeat(150_000), createdTimestamp: 2 },
      { id: "ambient-new", author: "Alex", content: "b".repeat(90_000), createdTimestamp: 3 },
    ];
    const result = retainPriorityContext(direct, ambient);

    expect(result.retained.map(message => message.id)).toContain("direct");
    expect(result.retained.map(message => message.id)).toContain("ambient-new");
    expect(result.overflow.map(message => message.id)).toContain("ambient-old");
  });

  test("splits summary transcript chunks below the configured character limit", () => {
    const messages = [
      { id: "one", author: "Alex", content: "a".repeat(260_000), createdTimestamp: 1 },
      { id: "two", author: "Sam", content: "b".repeat(260_000), createdTimestamp: 2 },
    ];
    const chunks = chunkContextMessages(messages);

    expect(chunks).toHaveLength(2);
    expect(chunks.every(chunk => estimateContextCharacters(chunk) <= SUMMARY_TRANSCRIPT_CHUNK_LIMIT)).toBe(true);
  });
});
