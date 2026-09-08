import { describe, expect, spyOn, test } from "bun:test";
import type { Message } from "discord.js";
import { fetchReferencedMessage } from "./message-reference";

describe("reputation message helpers", () => {
  test("returns a referenced message when Discord can fetch it", async () => {
    const referencedMessage = { id: "target" } as Message;
    const message = {
      channel: {
        messages: {
          fetch: async (messageId: string) => {
            expect(messageId).toBe("target");
            return referencedMessage;
          },
        },
      },
    } as unknown as Message;

    expect(await fetchReferencedMessage(message, "target")).toBe(referencedMessage);
  });

  test("returns null when a referenced message no longer exists", async () => {
    const warning = spyOn(console, "warn").mockImplementation(() => undefined);
    const message = {
      channel: {
        messages: {
          fetch: async () => { throw new Error("Unknown Message"); },
        },
      },
    } as unknown as Message;

    expect(await fetchReferencedMessage(message, "missing")).toBeNull();
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });
});
