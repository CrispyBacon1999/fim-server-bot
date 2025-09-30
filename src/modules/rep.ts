import type { Client, Message } from "discord.js";
import { db } from "../db/db";
import { reputationMessageTable } from "../db/schema";
import { eq } from "drizzle-orm";
import { isThankingReply } from "../ai/openrouter";

export async function reputationHandler(client: Client, message: Message) {
  if (message.author.bot) return;

  if (!message.reference?.messageId) return;

  const referenceMessage = await message.channel.messages.fetch(message.reference.messageId);

  // Can't thank yourself
  if (message.author.id === referenceMessage.author.id) return;

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