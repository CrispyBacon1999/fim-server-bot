import { describe, expect, test } from "bun:test";
import {
  extractAssistantPrompt,
  limitMultimodalAttachments,
  toAssistantEmoji,
} from "./assistant";

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
});
