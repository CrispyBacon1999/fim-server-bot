import type { Client, Message } from "discord.js";
import { db } from "../db/db";
import { reputationMessageTable } from "../db/schema";
import { eq } from "drizzle-orm";
import { isThankingReply } from "../ai/openrouter";
import { fetchReferencedMessage } from "./message-reference";

export async function reputationHandler(client: Client, message: Message) {
  if (message.author.bot) return;

  const mentionedUsers = message.mentions.users;

  mentionedUsers.delete(message.author.id);
  mentionedUsers.delete(client.user?.id!);

  if (mentionedUsers.size > 0) {
    const isThankMessage = await isThankingReply(message.content);

    if (!isThankMessage) return;


    const users = Array.from(mentionedUsers.values());
    for (const user of users) {
      await db.insert(reputationMessageTable).values({
        messageId: message.id,
        authorId: user.id,
        authorUsername: user.username,
        guildId: message.guild?.id!,
      });
    }
    const mentions = users.map((u) => `<@${u.id}>`).join(", ");
    const verb = users.length === 1 ? "has" : "have";
    await message.reply({ content: `${mentions} ${verb} been awarded 1 rep!` });

    return;
  }

  if (!message.reference?.messageId) return;

  const referenceMessage = await fetchReferencedMessage(message, message.reference.messageId);
  if (!referenceMessage) return;

  // Can't thank yourself
  if (message.author.id === referenceMessage.author.id) return;

  // Can't thank the bot
  if (referenceMessage.author.id === client.user?.id!) return;

  // Has this already been awarded rep?
  const hasAlreadyBeenAwardedRep = await db.query.reputationMessageTable.findFirst({
    where: eq(reputationMessageTable.messageId, message.reference.messageId),
  })
  if (hasAlreadyBeenAwardedRep) return;

  // Is this thanking the user?
  const isThankMessage = await isThankingReply(message.content);

  if (!isThankMessage) return;

  await db.insert(reputationMessageTable).values({
    messageId: referenceMessage.id,
    authorId: referenceMessage.author.id,
    authorUsername: referenceMessage.author.username,
    guildId: message.guild?.id!,
  })

  await message.reply({ content: `<@${referenceMessage.author.id}> has been been awarded 1 rep!` });
}
