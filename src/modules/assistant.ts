import {
  PermissionFlagsBits,
  type Attachment,
  type Client,
  type Message,
} from "discord.js";
import {
  formatAssistantContextMessage,
  generateAssistantResponse,
  getAssistantAttachmentKind,
  summarizeAssistantConversation,
  type AssistantAttachment,
  type AssistantContextMessage,
  type AssistantConversationSummary,
  type AssistantEmoji,
} from "../ai/openrouter";
import { eq } from "drizzle-orm";
import { assistantEmojiGuideTable } from "../db/schema";
import {
  assistantSummaryCache,
  type AssistantSummaryCacheEntry,
} from "./assistant-summary-cache";

export const ACTIVE_CONVERSATION_GAP_MS = 15 * 60 * 1_000;
export const MAX_CONTEXT_MESSAGES = 500;
export const RECENT_FOCUS_LIMIT = 8;
export const RAW_CONTEXT_COMPACTION_THRESHOLD = 500_000;
export const RETAINED_EXACT_CONTEXT_TARGET = 250_000;
export const SUMMARY_TRANSCRIPT_CHUNK_LIMIT = 480_000;

const HISTORY_PAGE_SIZE = 100;
const MULTIMODAL_ATTACHMENT_LIMIT = 4;
const DISCORD_MESSAGE_LIMIT = 2_000;

const EMPTY_PROMPT_REPLY = "What do you want me to do?";
const FAILURE_REPLY = "I hit a snag while working on that. Try again in a moment.";

export interface CollectedConversation {
  directReplyFocus: AssistantContextMessage[];
  ambientContext: AssistantContextMessage[];
}

export interface AssistantContextSections {
  directReplyFocus: AssistantContextMessage[];
  recentFocus: AssistantContextMessage[];
  supportingRecentContext: AssistantContextMessage[];
}

interface PreparedConversation extends AssistantContextSections {
  summary?: AssistantConversationSummary;
}

/**
 * Handles staff mentions and direct staff replies to the assistant. A true
 * return value means the message should not reach other reply automations.
 */
export async function assistantHandler(client: Client, message: Message): Promise<boolean> {
  if (!message.guild || message.author.bot || !client.user) return false;
  if (!message.channel.isTextBased()) return false;

  const hasMention = message.mentions.users.has(client.user.id);
  const referencedMessageId = message.reference?.messageId;
  const referenceMessage = referencedMessageId
    ? await fetchMessage(message, referencedMessageId)
    : null;
  if (!isAssistantInvocation(hasMention, referenceMessage?.author.id, client.user.id)) return false;

  const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member?.permissions.has(PermissionFlagsBits.ManageChannels)) return false;

  const prompt = extractAssistantPrompt(message.content, client.user.id);
  if (!prompt) {
    await replyWithoutMentions(message, EMPTY_PROMPT_REPLY);
    return true;
  }

  try {
    await ((message.channel as { sendTyping?: () => Promise<void> }).sendTyping?.() ?? Promise.resolve())
      .catch(() => undefined);

    const collected = await collectConversationContext(message, client.user.id, referenceMessage);
    const prepared = await prepareConversationContext(message, collected);
    const currentAttachments = message.attachments.map(toAssistantAttachment);
    const attachments = limitMultimodalAttachments([
      ...currentAttachments,
      ...[...prepared.directReplyFocus].reverse().flatMap(context => context.attachments ?? []),
      ...[...prepared.recentFocus].reverse().flatMap(context => context.attachments ?? []),
      ...[...prepared.supportingRecentContext].reverse().flatMap(context => context.attachments ?? []),
    ]);
    const emojiGuides = await fetchEmojiGuides(message.guild.id);
    const emojis = message.guild.emojis.cache
      .filter(emoji => emoji.available !== false)
      .map(emoji => toAssistantEmoji(emoji, emojiGuides.get(emoji.id)))
      .sort((left, right) => left.name.localeCompare(right.name));

    const answer = await generateAssistantResponse({
      prompt,
      directReplyFocus: prepared.directReplyFocus,
      recentFocus: prepared.recentFocus,
      supportingRecentContext: prepared.supportingRecentContext,
      summary: prepared.summary,
      attachments,
      emojis,
    });

    const sentMessage = await replyWithoutMentions(message, fitDiscordMessage(answer));
    assistantSummaryCache.addContinuation(
      message.channel.id,
      [message.id, ...(sentMessage ? [sentMessage.id] : [])],
      message.createdTimestamp,
    );
  } catch (error) {
    console.error("Assistant request failed", error);
    await replyWithoutMentions(message, FAILURE_REPLY);
  }

  return true;
}

export function extractAssistantPrompt(content: string, botUserId: string): string {
  const mentionPattern = new RegExp(`<@!?${escapeRegExp(botUserId)}>`, "g");
  return content.replace(mentionPattern, "").trim();
}

export function isAssistantInvocation(
  hasMention: boolean,
  referencedAuthorId: string | undefined,
  botUserId: string,
): boolean {
  return hasMention || referencedAuthorId === botUserId;
}

export function toAssistantAttachment(attachment: Attachment): AssistantAttachment {
  return {
    filename: attachment.name,
    url: attachment.url,
    contentType: attachment.contentType,
    kind: getAssistantAttachmentKind({
      filename: attachment.name,
      contentType: attachment.contentType,
    }),
  };
}

export function toAssistantContextMessage(message: Message, botUserId?: string): AssistantContextMessage {
  const embeds = message.embeds.flatMap(embed => [
    embed.title ? `Title: ${embed.title}` : null,
    embed.description ? `Description: ${embed.description}` : null,
    ...embed.fields.map(field => `${field.name}: ${field.value}`),
  ].filter((value): value is string => value !== null));

  return {
    id: message.id,
    ...(message.reference?.messageId ? { replyToMessageId: message.reference.messageId } : {}),
    author: message.member?.displayName ?? message.author.username,
    content: message.content,
    createdTimestamp: message.createdTimestamp,
    isAssistant: message.author.id === botUserId,
    embeds,
    attachments: message.attachments.map(toAssistantAttachment),
  };
}

export function toAssistantEmoji(
  emoji: { id: string; name: string | null; animated: boolean | null },
  description?: string,
): AssistantEmoji {
  const name = emoji.name ?? "emoji";
  return {
    id: emoji.id,
    name,
    token: `<${emoji.animated ? "a" : ""}:${name}:${emoji.id}>`,
    ...(description ? { description } : {}),
  };
}

export function limitMultimodalAttachments(attachments: AssistantAttachment[]): AssistantAttachment[] {
  return attachments.filter(attachment => {
    const kind = getAssistantAttachmentKind(attachment);
    return kind === "image" || kind === "pdf";
  }).slice(0, MULTIMODAL_ATTACHMENT_LIMIT);
}

export function selectConversationSections(
  directReplyFocus: AssistantContextMessage[],
  ambientContext: AssistantContextMessage[],
): AssistantContextSections {
  const directIds = new Set(directReplyFocus.map(message => message.id).filter(Boolean));
  const ambient = ambientContext
    .filter(message => !message.id || !directIds.has(message.id))
    .sort(compareContextMessages);
  const recentFocus = ambient.slice(-RECENT_FOCUS_LIMIT);

  return {
    directReplyFocus: [...directReplyFocus].sort(compareContextMessages),
    recentFocus,
    supportingRecentContext: recentFocus.length === 0 ? ambient : ambient.slice(0, -recentFocus.length),
  };
}

export function isSummaryConnected(
  entry: AssistantSummaryCacheEntry,
  currentTimestamp: number,
  contextMessageIds: Iterable<string>,
): boolean {
  if (currentTimestamp - entry.lastConversationActivityAt <= ACTIVE_CONVERSATION_GAP_MS) return true;

  const anchors = new Set([...entry.sourceMessageIds, ...entry.continuationAnchorIds]);
  return [...contextMessageIds].some(messageId => anchors.has(messageId));
}

export function invalidateAssistantSummary(channelId: string, messageId: string): boolean {
  return assistantSummaryCache.invalidateMessage(channelId, messageId);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compareContextMessages(left: AssistantContextMessage, right: AssistantContextMessage): number {
  const timestampDifference = (left.createdTimestamp ?? 0) - (right.createdTimestamp ?? 0);
  if (timestampDifference !== 0) return timestampDifference;
  return (left.id ?? "").localeCompare(right.id ?? "");
}

async function fetchMessage(message: Message, messageId: string): Promise<Message | null> {
  return message.channel.messages.fetch(messageId).catch(error => {
    console.warn(`Unable to fetch referenced message ${messageId}`, error);
    return null;
  });
}

export async function collectConversationContext(
  message: Message,
  botUserId: string,
  knownReference: Message | null,
): Promise<CollectedConversation> {
  const fetched = new Map<string, Message>();
  if (knownReference) fetched.set(knownReference.id, knownReference);
  const direct = new Map<string, Message>();
  await followReplyAncestors(message, message.reference?.messageId, fetched, direct);

  const ambientSeeds: Message[] = [];
  let before = message.id;
  let newerTimestamp = message.createdTimestamp;
  let reachedGap = false;

  while (!reachedGap && fetched.size < MAX_CONTEXT_MESSAGES) {
    let page: Message[];
    try {
      const messages = await message.channel.messages.fetch({
        before,
        limit: HISTORY_PAGE_SIZE,
        cache: false,
      });
      page = [...messages.values()].sort((left, right) => right.createdTimestamp - left.createdTimestamp);
    } catch (error) {
      console.warn(`Unable to fetch conversation context for message ${message.id}`, error);
      break;
    }

    if (page.length === 0) break;

    for (const candidate of page) {
      if (newerTimestamp - candidate.createdTimestamp > ACTIVE_CONVERSATION_GAP_MS) {
        reachedGap = true;
        break;
      }

      newerTimestamp = candidate.createdTimestamp;
      ambientSeeds.push(candidate);
      fetched.set(candidate.id, candidate);
      if (fetched.size >= MAX_CONTEXT_MESSAGES) break;
    }

    if (reachedGap || page.length < HISTORY_PAGE_SIZE || fetched.size >= MAX_CONTEXT_MESSAGES) break;
    before = page[page.length - 1]!.id;
  }

  for (const seed of ambientSeeds) {
    if (fetched.size >= MAX_CONTEXT_MESSAGES) break;
    await followReplyAncestors(seed, seed.reference?.messageId, fetched, undefined);
  }

  const directIds = new Set(direct.keys());
  const directReplyFocus = [...direct.values()]
    .map(context => toAssistantContextMessage(context, botUserId))
    .sort(compareContextMessages);
  const ambientContext = [...fetched.values()]
    .filter(context => !directIds.has(context.id))
    .map(context => toAssistantContextMessage(context, botUserId))
    .sort(compareContextMessages);

  return { directReplyFocus, ambientContext };
}

async function followReplyAncestors(
  source: Message,
  initialMessageId: string | undefined,
  fetched: Map<string, Message>,
  direct?: Map<string, Message>,
): Promise<void> {
  let messageId = initialMessageId;
  const visited = new Set<string>();

  while (messageId && !visited.has(messageId) && fetched.size < MAX_CONTEXT_MESSAGES) {
    visited.add(messageId);
    const ancestor = fetched.get(messageId) ?? await fetchMessage(source, messageId);
    if (!ancestor) break;

    fetched.set(ancestor.id, ancestor);
    direct?.set(ancestor.id, ancestor);
    messageId = ancestor.reference?.messageId;
  }
}

async function prepareConversationContext(
  message: Message,
  collected: CollectedConversation,
): Promise<PreparedConversation> {
  const now = Date.now();
  const allContextIds = [...collected.directReplyFocus, ...collected.ambientContext]
    .map(context => context.id)
    .filter((id): id is string => Boolean(id));
  let cached = assistantSummaryCache.get(message.channel.id, now);

  if (cached && !isSummaryConnected(cached, message.createdTimestamp, allContextIds)) {
    assistantSummaryCache.delete(message.channel.id);
    cached = undefined;
  }

  const summarizedIds = new Set(cached?.sourceMessageIds ?? []);
  const ambientContext = collected.ambientContext.filter(context => !context.id || !summarizedIds.has(context.id));
  const initialSections = selectConversationSections(collected.directReplyFocus, ambientContext);
  const exactMessages = uniqueContextMessages([
    ...initialSections.directReplyFocus,
    ...initialSections.supportingRecentContext,
    ...initialSections.recentFocus,
  ]);

  if (estimateContextCharacters(exactMessages) <= RAW_CONTEXT_COMPACTION_THRESHOLD) {
    if (cached) {
      console.info(`Assistant summary cache reused for channel ${message.channel.id}`);
      assistantSummaryCache.addContinuation(message.channel.id, [message.id], message.createdTimestamp, now);
    }
    return { ...initialSections, summary: cached && toConversationSummary(cached) };
  }

  const { retained, overflow } = retainPriorityContext(
    initialSections.directReplyFocus,
    [...initialSections.supportingRecentContext, ...initialSections.recentFocus],
  );
  const summaryResult = await summarizeOverflow(message, overflow, cached, now);
  const retainedDirectIds = new Set(initialSections.directReplyFocus.map(context => context.id).filter(Boolean));
  const retainedDirect = retained.filter(context => context.id && retainedDirectIds.has(context.id));
  const retainedAmbient = retained.filter(context => !context.id || !retainedDirectIds.has(context.id));
  const retainedSections = selectConversationSections(retainedDirect, retainedAmbient);

  return {
    ...retainedSections,
    summary: summaryResult ?? (cached && toConversationSummary(cached)),
  };
}

function uniqueContextMessages(messages: AssistantContextMessage[]): AssistantContextMessage[] {
  const seen = new Set<string>();
  return messages.filter((message, index) => {
    const key = message.id ?? `missing-${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort(compareContextMessages);
}

export function estimateContextCharacters(messages: AssistantContextMessage[]): number {
  return messages.reduce((total, message) => total + formatAssistantContextMessage(message).length + 2, 0);
}

export function retainPriorityContext(
  directReplyFocus: AssistantContextMessage[],
  ambientContext: AssistantContextMessage[],
): { retained: AssistantContextMessage[]; overflow: AssistantContextMessage[] } {
  const priority = [
    ...[...directReplyFocus].sort(compareContextMessages).reverse(),
    ...[...ambientContext].sort(compareContextMessages).reverse(),
  ];
  const retainedIds = new Set<string>();
  let retainedCharacters = 0;

  for (const message of priority) {
    const size = formatAssistantContextMessage(message).length + 2;
    if (retainedCharacters > 0 && retainedCharacters + size > RETAINED_EXACT_CONTEXT_TARGET) continue;
    retainedCharacters += size;
    if (message.id) retainedIds.add(message.id);
  }

  const all = uniqueContextMessages([...directReplyFocus, ...ambientContext]);
  return {
    retained: all.filter(message => !message.id || retainedIds.has(message.id)),
    overflow: all.filter(message => message.id && !retainedIds.has(message.id)),
  };
}

async function summarizeOverflow(
  message: Message,
  overflow: AssistantContextMessage[],
  cached: AssistantSummaryCacheEntry | undefined,
  now: number,
): Promise<AssistantConversationSummary | undefined> {
  const chunks = chunkContextMessages(overflow);
  let rollingSummary = cached?.content;
  let finalModel = cached?.model ?? "";
  let usedFallback = cached?.usedFallback ?? false;
  const coveredMessages: AssistantContextMessage[] = [];

  for (const chunk of chunks) {
    try {
      const result = await summarizeAssistantConversation({
        transcript: chunk.map(formatAssistantContextMessage).join("\n\n"),
        previousSummary: rollingSummary,
      });
      rollingSummary = result.content;
      finalModel = result.model;
      usedFallback ||= result.usedFallback;
      coveredMessages.push(...chunk);
      if (result.usedFallback) {
        console.info(`Assistant summary used paid fallback for channel ${message.channel.id}`);
      }
    } catch (error) {
      console.warn(`Unable to compact assistant context for channel ${message.channel.id}`, error);
      break;
    }
  }

  if (!rollingSummary || coveredMessages.length === 0) return cached && toConversationSummary(cached);

  const coveredTimestamps = coveredMessages
    .map(context => context.createdTimestamp)
    .filter((timestamp): timestamp is number => timestamp !== undefined);
  const lastCovered = coveredMessages[coveredMessages.length - 1]!;
  const sourceStartedAt = Math.min(cached?.sourceStartedAt ?? Infinity, ...coveredTimestamps);
  const sourceEndedAt = Math.max(cached?.sourceEndedAt ?? -Infinity, ...coveredTimestamps);
  const sourceMessageIds = coveredMessages
    .map(context => context.id)
    .filter((id): id is string => Boolean(id));
  const entry = assistantSummaryCache.set({
    channelId: message.channel.id,
    content: rollingSummary,
    sourceStartedAt: Number.isFinite(sourceStartedAt) ? sourceStartedAt : now,
    sourceEndedAt: Number.isFinite(sourceEndedAt) ? sourceEndedAt : now,
    generatedAt: now,
    model: finalModel,
    usedFallback,
    createdAt: cached?.createdAt ?? now,
    updatedAt: now,
    lastAccessedAt: now,
    lastConversationActivityAt: message.createdTimestamp,
    summarizedThroughMessageId: lastCovered.id ?? cached?.summarizedThroughMessageId ?? message.id,
    summarizedThroughTimestamp: lastCovered.createdTimestamp ?? cached?.summarizedThroughTimestamp ?? now,
    sourceMessageIds: [...(cached?.sourceMessageIds ?? []), ...sourceMessageIds],
    continuationAnchorIds: [...(cached?.continuationAnchorIds ?? []), message.id],
  }, now);

  if (!entry) return undefined;
  console.info(`Assistant summary cache ${cached ? "refreshed" : "created"} for channel ${message.channel.id}`);
  return toConversationSummary(entry);
}

export function chunkContextMessages(messages: AssistantContextMessage[]): AssistantContextMessage[][] {
  const chunks: AssistantContextMessage[][] = [];
  let current: AssistantContextMessage[] = [];
  let currentCharacters = 0;

  for (const message of messages) {
    const size = formatAssistantContextMessage(message).length + 2;
    if (current.length > 0 && currentCharacters + size > SUMMARY_TRANSCRIPT_CHUNK_LIMIT) {
      chunks.push(current);
      current = [];
      currentCharacters = 0;
    }
    current.push(message);
    currentCharacters += size;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

function toConversationSummary(entry: AssistantSummaryCacheEntry): AssistantConversationSummary {
  return {
    content: entry.content,
    sourceStartedAt: entry.sourceStartedAt,
    sourceEndedAt: entry.sourceEndedAt,
    generatedAt: entry.generatedAt,
    model: entry.model,
    usedFallback: entry.usedFallback,
  };
}

async function fetchEmojiGuides(guildId: string): Promise<Map<string, string>> {
  try {
    const { db } = await import("../db/db");
    const guides = await db
      .select({ emojiId: assistantEmojiGuideTable.emojiId, description: assistantEmojiGuideTable.description })
      .from(assistantEmojiGuideTable)
      .where(eq(assistantEmojiGuideTable.guildId, guildId));
    return new Map(guides.map(guide => [guide.emojiId, guide.description]));
  } catch (error) {
    console.warn(`Unable to fetch assistant emoji guides for guild ${guildId}`, error);
    return new Map();
  }
}

async function replyWithoutMentions(message: Message, content: string): Promise<Message | null> {
  try {
    return await message.reply({
      content,
      allowedMentions: {
        parse: [],
        repliedUser: false,
      },
    });
  } catch (error) {
    console.error(`Unable to send assistant reply for message ${message.id}`, error);
    return null;
  }
}

function fitDiscordMessage(content: string): string {
  if (content.length <= DISCORD_MESSAGE_LIMIT) return content;

  const truncated = content.slice(0, DISCORD_MESSAGE_LIMIT - 1).trimEnd();
  const lastWhitespace = truncated.lastIndexOf(" ");
  return `${(lastWhitespace > 1 ? truncated.slice(0, lastWhitespace) : truncated)}…`;
}
