import { describe, expect, test } from "bun:test";
import { parseCustomEmoji, parseCustomEmojiId, splitDiscordMessage } from "./assistant-emoji";

describe("assistant emoji helpers", () => {
  test("parses static and animated custom emoji tokens", () => {
    expect(parseCustomEmoji("<:COPIUM:123456789012345678>")).toEqual({
      id: "123456789012345678", name: "COPIUM", animated: false,
    });
    expect(parseCustomEmoji("<a:hype:123456789012345678>")).toMatchObject({ animated: true });
    expect(parseCustomEmoji(":COPIUM:")).toBeNull();
  });

  test("accepts a raw emoji id for removal", () => {
    expect(parseCustomEmojiId("123456789012345678")).toBe("123456789012345678");
    expect(parseCustomEmojiId("not-an-id")).toBeNull();
  });

  test("splits guide lists on line boundaries", () => {
    expect(splitDiscordMessage("one\ntwo\nthree", 7)).toEqual(["one\ntwo", "three"]);
  });
});
