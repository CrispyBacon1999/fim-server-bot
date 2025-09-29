import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { db } from "../../db/db";
import { desc, eq, sql } from "drizzle-orm";
import { reputationMessageTable } from "../../db/schema";

export const data = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("View the reputation leaderboard for this month.");

export async function execute(interaction: ChatInputCommandInteraction) {
  // Get the count of messages from this guild, grouped by user id.
  const guildId = interaction.guildId!;
  try {
    const leaderboard = await db
      .select({
        authorId: reputationMessageTable.authorId,
        authorUsername: reputationMessageTable.authorUsername,
        count: sql<number>`COUNT(${reputationMessageTable.messageId})`,
      })
      .from(reputationMessageTable)
      .groupBy(reputationMessageTable.authorId, reputationMessageTable.authorUsername)
      .orderBy(desc(sql`COUNT(*)`))
      .where(eq(reputationMessageTable.guildId, guildId))
      .limit(20);

    if (leaderboard.length === 0) {
      await interaction.reply({ content: "No reputation leaderboard found for this month." });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("Reputation Leaderboard")
      .setDescription(
        leaderboard
          .map(
            (l, i) =>
              `**${i + 1}.** ${l.authorUsername} — \`${l.count}\``
          )
          .join("\n")
      )
      .setColor(0x00AE86);

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error(error);
    await interaction.reply({ content: "There was an error while executing this command!", ephemeral: true });
  }
}
