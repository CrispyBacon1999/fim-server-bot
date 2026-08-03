export interface ParsedCustomEmoji {
  id: string;
  name: string;
  animated: boolean;
}

const CUSTOM_EMOJI_PATTERN = /^<(a?):([A-Za-z0-9_]+):(\d{17,20})>$/;
const EMOJI_ID_PATTERN = /^\d{17,20}$/;

export function parseCustomEmoji(value: string): ParsedCustomEmoji | null {
  const match = value.trim().match(CUSTOM_EMOJI_PATTERN);
  if (!match) return null;

  return { animated: match[1] === "a", name: match[2]!, id: match[3]! };
}

export function parseCustomEmojiId(value: string): string | null {
  return parseCustomEmoji(value)?.id ?? (EMOJI_ID_PATTERN.test(value.trim()) ? value.trim() : null);
}

export function splitDiscordMessage(content: string, limit = 1_900): string[] {
  if (content.length <= limit) return [content];

  const chunks: string[] = [];
  let remaining = content;
  while (remaining.length > limit) {
    const newline = remaining.lastIndexOf("\n", limit);
    const end = newline > 0 ? newline : limit;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end).replace(/^\n/, "");
  }
  chunks.push(remaining);
  return chunks;
}
