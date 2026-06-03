import { ChannelType, ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { eq } from "drizzle-orm";
import { db } from "../../db/db";
import { honeypotConfigTable } from "../../db/schema";

export const data = new SlashCommandBuilder()
  .setName("honeypot")
  .setDescription("Configure the honeypot channel.")
  .addSubcommand(subcommand =>
    subcommand
      .setName("setup")
      .setDescription("Set the honeypot channel and staff alert channel.")
      .addChannelOption(option =>
        option
          .setName("channel")
          .setDescription("The channel where any non-admin message triggers a ban.")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText))
      .addChannelOption(option =>
        option
          .setName("staff-channel")
          .setDescription("The staff channel that will receive honeypot ban alerts.")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText)))
  .addSubcommand(subcommand =>
    subcommand
      .setName("disable")
      .setDescription("Disable the honeypot channel for this server."))
  .addSubcommand(subcommand =>
    subcommand
      .setName("status")
      .setDescription("Show the current honeypot configuration."))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "setup") {
    await setupHoneypot(interaction);
    return;
  }

  if (subcommand === "disable") {
    await disableHoneypot(interaction);
    return;
  }

  if (subcommand === "status") {
    await showHoneypotStatus(interaction);
    return;
  }
}

async function setupHoneypot(interaction: ChatInputCommandInteraction) {
  const honeypotChannel = interaction.options.getChannel("channel", true);
  const staffChannel = interaction.options.getChannel("staff-channel", true);

  if (honeypotChannel.type !== ChannelType.GuildText || staffChannel.type !== ChannelType.GuildText) {
    await interaction.reply({ content: "Both channels must be server text channels.", ephemeral: true });
    return;
  }

  await db
    .insert(honeypotConfigTable)
    .values({
      guildId: interaction.guildId!,
      channelId: honeypotChannel.id,
      staffChannelId: staffChannel.id,
    })
    .onDuplicateKeyUpdate({
      set: {
        channelId: honeypotChannel.id,
        staffChannelId: staffChannel.id,
      },
    });

  await interaction.reply({
    content: `Honeypot channel set to <#${honeypotChannel.id}>. Staff alerts will be sent to <#${staffChannel.id}>.`,
    ephemeral: true,
  });
}

async function disableHoneypot(interaction: ChatInputCommandInteraction) {
  await db.delete(honeypotConfigTable).where(eq(honeypotConfigTable.guildId, interaction.guildId!));

  await interaction.reply({ content: "Honeypot channel disabled.", ephemeral: true });
}

async function showHoneypotStatus(interaction: ChatInputCommandInteraction) {
  const config = await db.query.honeypotConfigTable.findFirst({
    where: eq(honeypotConfigTable.guildId, interaction.guildId!),
  });

  if (!config) {
    await interaction.reply({ content: "No honeypot channel is configured for this server.", ephemeral: true });
    return;
  }

  await interaction.reply({
    content: `Honeypot channel: <#${config.channelId}>\nStaff alert channel: <#${config.staffChannelId}>`,
    ephemeral: true,
  });
}
