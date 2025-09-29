import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { db } from "../../db/db";
import { desc, eq, sql } from "drizzle-orm";
import { reputationMessageTable } from "../../db/schema";

export const data = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("View the reputation leaderboard for this month.");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  // Get the count of messages from this guild, grouped by user id.
  const guildId = interaction.guildId!;
  const leaderboard = await db
    .select({
      authorId: reputationMessageTable.authorId,
      authorUsername: reputationMessageTable.authorUsername,
      count: db.$count(reputationMessageTable.messageId),
    })
    .from(reputationMessageTable)
    .groupBy(reputationMessageTable.authorId, reputationMessageTable.authorUsername)
    .orderBy(desc(sql`COUNT(*)`))
    .where(eq(reputationMessageTable.guildId, guildId))
    .limit(20);

  await interaction.editReply({ content: `Leaderboard: ${leaderboard.map(l => `<@${l.authorId}> (${l.count})`).join("\n")}` });
}
