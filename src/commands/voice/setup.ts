import { ChannelType, type ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { voiceChannelConfigTable } from "../../db/schema";
import { db } from "../../db/db";

export const data = new SlashCommandBuilder()
  .setName("vcsetup")
  .setDescription("Set up automatic voice channel creation.")
  .addChannelOption(option =>
    option
      .setName("category")
      .setDescription("The category that the voice channel will be created in.")
      .setRequired(true)
      .addChannelTypes(ChannelType.GuildCategory))
  .addStringOption(option =>
    option.addChoices(
      { name: "Incremental", value: "incremental" },
      { name: "Username", value: "username" },
      { name: "Game", value: "game" }
    )
      .setName("configuration-mode")
      .setDescription("The mode in which the voice channel will be created.")
      .setRequired(true)
  )
  .addChannelOption(option =>
    option
      .setName("voice-channel")
      .setDescription("The voice channel that users will join to create a new voice channel.")
      .setRequired(false)
      .addChannelTypes(ChannelType.GuildVoice))
  .addBooleanOption(option => option.setName("editable").setDescription("Whether the creator can edit the voice channel configuration."))
  .addIntegerOption(option => option.setName("max-users").setDescription("The maximum number of users that can be in the voice channel."))
  .addStringOption(option => option.setName("name").setDescription("The default name of the voice channel."))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

export async function execute(interaction: ChatInputCommandInteraction) {
  let voiceChannel = interaction.options.getChannel("voice-channel");
  const configurationMode = interaction.options.getString("configuration-mode");
  const editable = interaction.options.getBoolean("editable") ?? true;
  const maxUsers = interaction.options.getInteger("max-users") ?? 10;
  const category = interaction.options.getChannel("category");
  const name = interaction.options.getString("name") ?? "VC";

  if (!category) {
    await interaction.reply({ content: "Please provide a category.", ephemeral: true });
    return;
  }

  if (!voiceChannel) {
    const channel = await interaction.guild?.channels.create({
      name: "Join to Create",
      type: ChannelType.GuildVoice,
      parent: category?.id,
    })
    if (!channel) {
      await interaction.reply({ content: "Failed to create voice channel.", ephemeral: true });
      return;
    }
    voiceChannel = channel;
  }

  // Configure voice settings in the channel
  const vc = interaction.guild?.channels.cache.get(voiceChannel.id);
  if (vc && vc.type === ChannelType.GuildVoice) {
    await vc.permissionOverwrites.create(interaction.guild?.roles.everyone!, {
      Speak: false,
      UseSoundboard: false,
    })
  }

  if (!configurationMode || !["incremental", "username", "game"].includes(configurationMode)) {
    await interaction.reply({ content: "Please provide a configuration mode.", ephemeral: true });
    return;
  }

  await db.insert(voiceChannelConfigTable).values({
    baseVoiceChannelId: voiceChannel.id,
    configurationMode: configurationMode as "incremental" | "username" | "game",
    editableByCreator: editable,
    defaultMaxUsers: maxUsers,
    categoryToCreateIn: category.id,
    guildId: interaction.guild?.id!,
    name: name
  })


  await interaction.reply({ content: "Voice channel setup complete.", ephemeral: true });
}