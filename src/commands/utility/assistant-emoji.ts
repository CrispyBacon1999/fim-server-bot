import { PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/db";
import { assistantEmojiGuideTable } from "../../db/schema";
import { parseCustomEmoji, parseCustomEmojiId, splitDiscordMessage } from "../../modules/assistant-emoji";

const MANAGE_EMOJI_GUIDE_PERMISSION = PermissionFlagsBits.ManageChannels;

export const data = new SlashCommandBuilder()
  .setName("assistant-emoji")
  .setDescription("Manage custom emoji guidance for the assistant.")
  .setDefaultMemberPermissions(MANAGE_EMOJI_GUIDE_PERMISSION)
  .addSubcommand(subcommand => subcommand
    .setName("set")
    .setDescription("Set the assistant's usage note for a custom emoji.")
    .addStringOption(option => option
      .setName("emoji")
      .setDescription("Paste a custom emoji from this server.")
      .setRequired(true))
    .addStringOption(option => option
      .setName("meaning")
      .setDescription("When and how the assistant should use it.")
      .setMaxLength(500)
      .setRequired(true)))
  .addSubcommand(subcommand => subcommand
    .setName("remove")
    .setDescription("Remove an emoji usage note.")
    .addStringOption(option => option
      .setName("emoji")
      .setDescription("Paste the emoji, or use its ID from the list.")
      .setRequired(true)))
  .addSubcommand(subcommand => subcommand
    .setName("list")
    .setDescription("List this server's emoji usage notes."));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild || !interaction.guildId) {
    await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
    return;
  }
  if (!interaction.memberPermissions?.has(MANAGE_EMOJI_GUIDE_PERMISSION)) {
    await interaction.reply({ content: "You need Manage Channels to manage assistant emoji guidance.", ephemeral: true });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "set") await setEmojiGuide(interaction);
  else if (subcommand === "remove") await removeEmojiGuide(interaction);
  else await listEmojiGuides(interaction);
}

async function setEmojiGuide(interaction: ChatInputCommandInteraction): Promise<void> {
  const suppliedEmoji = parseCustomEmoji(interaction.options.getString("emoji", true));
  const description = interaction.options.getString("meaning", true).trim();
  if (!suppliedEmoji || !description) {
    await interaction.reply({ content: "Paste a custom emoji from this server and provide a usage note.", ephemeral: true });
    return;
  }

  const emoji = interaction.guild!.emojis.cache.get(suppliedEmoji.id);
  if (!emoji || emoji.available === false) {
    await interaction.reply({ content: "That custom emoji is not currently available in this server.", ephemeral: true });
    return;
  }

  await db.insert(assistantEmojiGuideTable).values({
    guildId: interaction.guildId!,
    emojiId: emoji.id,
    description,
  }).onDuplicateKeyUpdate({ set: { description } });

  await interaction.reply({ content: `Saved assistant guidance for ${emoji}: ${description}`, ephemeral: true });
}

async function removeEmojiGuide(interaction: ChatInputCommandInteraction): Promise<void> {
  const emojiId = parseCustomEmojiId(interaction.options.getString("emoji", true));
  if (!emojiId) {
    await interaction.reply({ content: "Paste a custom emoji or provide the emoji ID shown by `/assistant-emoji list`.", ephemeral: true });
    return;
  }

  await db.delete(assistantEmojiGuideTable).where(and(
    eq(assistantEmojiGuideTable.guildId, interaction.guildId!),
    eq(assistantEmojiGuideTable.emojiId, emojiId),
  ));
  await interaction.reply({ content: "Removed that assistant emoji guidance, if it existed.", ephemeral: true });
}

async function listEmojiGuides(interaction: ChatInputCommandInteraction): Promise<void> {
  const guides = await db.select().from(assistantEmojiGuideTable)
    .where(eq(assistantEmojiGuideTable.guildId, interaction.guildId!));
  if (guides.length === 0) {
    await interaction.reply({ content: "No assistant emoji guidance is configured for this server.", ephemeral: true });
    return;
  }

  const entries = guides
    .sort((left, right) => left.emojiId.localeCompare(right.emojiId))
    .map(guide => {
      const emoji = interaction.guild!.emojis.cache.get(guide.emojiId);
      return emoji
        ? `${emoji} - ${guide.description}`
        : `\`${guide.emojiId}\` (no longer available) - ${guide.description}`;
    });
  const chunks = splitDiscordMessage(entries.join("\n"));
  await interaction.reply({ content: chunks[0]!, ephemeral: true });
  for (const chunk of chunks.slice(1)) await interaction.followUp({ content: chunk, ephemeral: true });
}
