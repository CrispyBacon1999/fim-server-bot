import {
  PermissionFlagsBits,
  type Attachment,
  type Client,
  type Message,
} from "discord.js";
import {
  generateAssistantResponse,
  getAssistantAttachmentKind,
  type AssistantAttachment,
  type AssistantContextMessage,
} from "../ai/openrouter";

const HISTORY_LIMIT = 8;
const MULTIMODAL_ATTACHMENT_LIMIT = 4;
const DISCORD_MESSAGE_LIMIT = 2_000;

const EMPTY_PROMPT_REPLY = "What do you want me to do?";
const MISSING_REFERENCE_REPLY = "I couldn’t read the message you replied to.";
const FAILURE_REPLY = "I hit a snag while working on that. Try again in a moment.";

/**
 * Handles staff mentions of the assistant. A true return value means the
 * message was an assistant invocation and should not be processed by other
 * mention/reply automations.
 */
export async function assistantHandler(client: Client, message: Message): Promise<boolean> {
  if (!message.guild || message.author.bot || !client.user) return false;
  if (!message.channel.isTextBased()) return false;
  if (!message.mentions.users.has(client.user.id)) return false;

  const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member?.permissions.has(PermissionFlagsBits.ManageChannels)) return false;

  const prompt = extractAssistantPrompt(message.content, client.user.id);
  if (!prompt) {
    await replyWithoutMentions(message, EMPTY_PROMPT_REPLY);
    return true;
  }

  try {
    await ((message.channel as { sendTyping?: () => Promise<void> }).sendTyping?.() ?? Promise.resolve()).catch(() => undefined);

    const referenceMessage = message.reference?.messageId
      ? await fetchMessage(message, message.reference.messageId)
      : null;

    if (message.reference?.messageId && !referenceMessage) {
      await replyWithoutMentions(message, MISSING_REFERENCE_REPLY);
      return true;
    }

    const contextMessages = referenceMessage
      ? [toAssistantContextMessage(referenceMessage)]
      : await fetchSurroundingContext(message);

    const currentAttachments = message.attachments.map(toAssistantAttachment);
    const contextAttachments = [...contextMessages]
      .reverse()
      .flatMap(context => context.attachments ?? []);
    const attachments = limitMultimodalAttachments([
      ...currentAttachments,
      ...contextAttachments,
    ]);

    const answer = await generateAssistantResponse({
      prompt,
      context: contextMessages,
      attachments,
    });

    await replyWithoutMentions(message, fitDiscordMessage(answer));
  } catch (error) {
    console.error("Assistant request failed", error);
    await replyWithoutMentions(message, FAILURE_REPLY);
  }

  return true;
}

export function extractAssistantPrompt(content: string, botUserId: string): string {
  const mentionPattern = new RegExp(`<@!?${escapeRegExp(botUserId)}>`, "g");
  return content.replace(mentionPattern, "").trim();
}

export function toAssistantAttachment(attachment: Attachment): AssistantAttachment {
  return {
    filename: attachment.name,
    url: attachment.url,
    contentType: attachment.contentType,
    kind: getAssistantAttachmentKind({
      filename: attachment.name,
      contentType: attachment.contentType,
    }),
  };
}

export function toAssistantContextMessage(message: Message): AssistantContextMessage {
  const embeds = message.embeds.flatMap(embed => [
    embed.title ? `Title: ${embed.title}` : null,
    embed.description ? `Description: ${embed.description}` : null,
    ...embed.fields.map(field => `${field.name}: ${field.value}`),
  ].filter((value): value is string => value !== null));

  return {
    author: message.member?.displayName ?? message.author.username,
    content: message.content,
    embeds,
    attachments: message.attachments.map(toAssistantAttachment),
  };
}

export function limitMultimodalAttachments(attachments: AssistantAttachment[]): AssistantAttachment[] {
  const usableAttachments = attachments.filter(attachment => {
    const kind = getAssistantAttachmentKind(attachment);
    return kind === "image" || kind === "pdf";
  });

  return usableAttachments.slice(0, MULTIMODAL_ATTACHMENT_LIMIT);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchMessage(message: Message, messageId: string): Promise<Message | null> {
  return message.channel.messages.fetch(messageId).catch(error => {
    console.warn(`Unable to fetch referenced message ${messageId}`, error);
    return null;
  });
}

async function fetchSurroundingContext(message: Message): Promise<AssistantContextMessage[]> {
  try {
    const recentMessages = await message.channel.messages.fetch({
      before: message.id,
      limit: HISTORY_LIMIT,
      cache: false,
    });

    return Array.from(recentMessages.values())
      .sort((left, right) => left.createdTimestamp - right.createdTimestamp)
      .map(toAssistantContextMessage);
  } catch (error) {
    console.warn(`Unable to fetch surrounding context for message ${message.id}`, error);
    return [];
  }
}

async function replyWithoutMentions(message: Message, content: string): Promise<void> {
  try {
    await message.reply({
      content,
      allowedMentions: {
        parse: [],
        repliedUser: false,
      },
    });
  } catch (error) {
    console.error(`Unable to send assistant reply for message ${message.id}`, error);
  }
}

function fitDiscordMessage(content: string): string {
  if (content.length <= DISCORD_MESSAGE_LIMIT) return content;

  const truncated = content.slice(0, DISCORD_MESSAGE_LIMIT - 1).trimEnd();
  const lastWhitespace = truncated.lastIndexOf(" ");
  return `${(lastWhitespace > 1 ? truncated.slice(0, lastWhitespace) : truncated)}…`;
}
