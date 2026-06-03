import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Client,
  type Message,
  type TextChannel,
} from "discord.js";
import { eq } from "drizzle-orm";
import { db } from "../db/db";
import { honeypotConfigTable } from "../db/schema";

const TEN_MINUTES_IN_SECONDS = 10 * 60;
const MAX_FIELD_LENGTH = 1024;

export async function honeypotHandler(client: Client, message: Message): Promise<boolean> {
  if (!message.guild || message.author.bot) return false;

  const config = await db.query.honeypotConfigTable.findFirst({
    where: eq(honeypotConfigTable.guildId, message.guild.id),
  });

  if (!config || config.channelId !== message.channel.id) return false;

  const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return true;

  if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.BanMembers)) {
    return true;
  }

  const staffChannel = await getStaffChannel(client, config.staffChannelId);
  const reason = `Honeypot channel triggered by message ${message.id}`;

  try {
    await message.guild.members.ban(message.author.id, {
      deleteMessageSeconds: TEN_MINUTES_IN_SECONDS,
      reason,
    });
  } catch (error) {
    console.error("Failed to ban honeypot user", error);

    await sendStaffAlert(staffChannel, {
      message,
      title: "Honeypot Ban Failed",
      color: 0xF59E0B,
      description: `Failed to ban <@${message.author.id}> after a message in <#${message.channel.id}>.`,
    });

    return true;
  }

  await sendStaffAlert(staffChannel, {
    message,
    title: "Honeypot Ban",
    color: 0xE5484D,
    description: `Banned <@${message.author.id}> after a message in <#${message.channel.id}>.`,
  });

  return true;
}

async function sendStaffAlert(
  staffChannel: TextChannel | null,
  options: {
    message: Message;
    title: string;
    color: number;
    description: string;
  },
) {
  try {
    await staffChannel?.send({
      embeds: [
        buildAlertEmbed(options),
      ],
    });
  } catch (error) {
    console.error("Failed to send honeypot staff alert", error);
  }
}

async function getStaffChannel(client: Client, channelId: string): Promise<TextChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (!channel || channel.type !== ChannelType.GuildText) return null;

  return channel;
}

function buildAlertEmbed(options: {
  message: Message;
  title: string;
  color: number;
  description: string;
}) {
  const { message, title, color, description } = options;
  const attachmentUrls = message.attachments.map(attachment => attachment.url);

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .addFields(
      {
        name: "User",
        value: `${message.author.tag} (${message.author.id})`,
      },
      {
        name: "Message ID",
        value: message.id,
        inline: true,
      },
      {
        name: "Channel",
        value: `<#${message.channel.id}>`,
        inline: true,
      },
      {
        name: "Message",
        value: truncateForEmbed(message.content || "[no text content]"),
      },
    )
    .setTimestamp(message.createdAt);

  if (attachmentUrls.length > 0) {
    embed.addFields({
      name: "Attachments",
      value: truncateForEmbed(attachmentUrls.join("\n")),
    });
  }

  return embed;
}

function truncateForEmbed(value: string) {
  if (value.length <= MAX_FIELD_LENGTH) return value;

  return `${value.slice(0, MAX_FIELD_LENGTH - 3)}...`;
}
