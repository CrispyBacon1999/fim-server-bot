import type { Message } from "discord.js";

/**
 * Discord can retain a reply reference after its target has been deleted (or
 * when the target is otherwise unavailable to the bot). Treat that as missing
 * context rather than allowing Discord's 10008 response to reject the event
 * handler and terminate the process.
 */
export async function fetchReferencedMessage(message: Message, messageId: string): Promise<Message | null> {
  try {
    return await message.channel.messages.fetch(messageId);
  } catch (error) {
    console.warn(`Unable to fetch reputation reference ${messageId}`, error);
    return null;
  }
}
