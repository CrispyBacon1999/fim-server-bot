import type { AssistantConversationSummary } from "../ai/openrouter";

export const ASSISTANT_SUMMARY_TTL_MS = 6 * 60 * 60 * 1_000;
export const MAX_ASSISTANT_SUMMARY_CHANNELS = 100;
export const MAX_ASSISTANT_SUMMARY_CACHE_BYTES = 2 * 1024 * 1024;
export const MAX_ASSISTANT_SUMMARY_ENTRY_BYTES = 64 * 1024;
export const MAX_ASSISTANT_SUMMARY_SOURCE_IDS = 500;
export const MAX_ASSISTANT_CONTINUATION_IDS = 32;

const BASE_ENTRY_BYTES = 1_024;
const ESTIMATED_ID_BYTES = 96;

export interface AssistantSummaryCacheEntry extends AssistantConversationSummary {
  channelId: string;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  lastConversationActivityAt: number;
  summarizedThroughMessageId: string;
  summarizedThroughTimestamp: number;
  sourceMessageIds: string[];
  continuationAnchorIds: string[];
  estimatedBytes: number;
}

export type AssistantSummaryCacheInput = Omit<AssistantSummaryCacheEntry, "estimatedBytes">;

function uniqueTail(values: string[], limit: number): string[] {
  return [...new Set(values)].slice(-limit);
}

export function estimateAssistantSummaryEntryBytes(
  entry: Omit<AssistantSummaryCacheEntry, "estimatedBytes">,
): number {
  const strings = [
    entry.channelId,
    entry.content,
    entry.model,
    entry.summarizedThroughMessageId,
  ];
  const stringBytes = strings.reduce(
    (total, value) => total + Math.max(Buffer.byteLength(value, "utf8"), value.length * 2) + 64,
    0,
  );
  const idBytes = (entry.sourceMessageIds.length + entry.continuationAnchorIds.length) * ESTIMATED_ID_BYTES;
  return BASE_ENTRY_BYTES + stringBytes + idBytes;
}

export class AssistantSummaryCache {
  private readonly entries = new Map<string, AssistantSummaryCacheEntry>();

  constructor(
    private readonly maxBytes = MAX_ASSISTANT_SUMMARY_CACHE_BYTES,
    private readonly maxChannels = MAX_ASSISTANT_SUMMARY_CHANNELS,
    private readonly maxEntryBytes = MAX_ASSISTANT_SUMMARY_ENTRY_BYTES,
    private readonly ttlMs = ASSISTANT_SUMMARY_TTL_MS,
  ) {}

  get(channelId: string, now = Date.now()): AssistantSummaryCacheEntry | undefined {
    this.removeExpired(now);
    const entry = this.entries.get(channelId);
    if (!entry) return undefined;

    entry.lastAccessedAt = now;
    return entry;
  }

  set(input: AssistantSummaryCacheInput, now = Date.now()): AssistantSummaryCacheEntry | undefined {
    this.removeExpired(now);

    const normalized = {
      ...input,
      sourceMessageIds: uniqueTail(input.sourceMessageIds, MAX_ASSISTANT_SUMMARY_SOURCE_IDS),
      continuationAnchorIds: uniqueTail(input.continuationAnchorIds, MAX_ASSISTANT_CONTINUATION_IDS),
    };
    let estimatedBytes = estimateAssistantSummaryEntryBytes(normalized);

    while (estimatedBytes > this.maxEntryBytes && normalized.sourceMessageIds.length > 0) {
      normalized.sourceMessageIds.shift();
      estimatedBytes = estimateAssistantSummaryEntryBytes(normalized);
    }
    while (estimatedBytes > this.maxEntryBytes && normalized.continuationAnchorIds.length > 0) {
      normalized.continuationAnchorIds.shift();
      estimatedBytes = estimateAssistantSummaryEntryBytes(normalized);
    }

    if (estimatedBytes > this.maxEntryBytes) {
      console.warn(`Assistant summary cache rejected oversized entry for channel ${input.channelId}`);
      this.entries.delete(input.channelId);
      return undefined;
    }

    const entry: AssistantSummaryCacheEntry = { ...normalized, estimatedBytes };
    this.entries.set(entry.channelId, entry);
    this.evictToLimits();
    return this.entries.get(entry.channelId);
  }

  addContinuation(
    channelId: string,
    messageIds: string[],
    lastConversationActivityAt: number,
    now = Date.now(),
  ): void {
    const entry = this.get(channelId, now);
    if (!entry) return;

    this.set({
      ...entry,
      continuationAnchorIds: [...entry.continuationAnchorIds, ...messageIds],
      lastConversationActivityAt,
      lastAccessedAt: now,
    }, now);
  }

  invalidateMessage(channelId: string, messageId: string): boolean {
    const entry = this.entries.get(channelId);
    if (!entry) return false;
    if (!entry.sourceMessageIds.includes(messageId) && !entry.continuationAnchorIds.includes(messageId)) {
      return false;
    }

    this.entries.delete(channelId);
    console.info(`Assistant summary cache invalidated for channel ${channelId} after message ${messageId} changed`);
    return true;
  }

  delete(channelId: string, reason = "disconnected conversation"): boolean {
    const deleted = this.entries.delete(channelId);
    if (deleted) console.info(`Assistant summary cache removed for channel ${channelId}: ${reason}`);
    return deleted;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  get totalEstimatedBytes(): number {
    return [...this.entries.values()].reduce((total, entry) => total + entry.estimatedBytes, 0);
  }

  private removeExpired(now: number): void {
    for (const [channelId, entry] of this.entries) {
      if (now - entry.updatedAt < this.ttlMs) continue;
      this.entries.delete(channelId);
      console.info(`Assistant summary cache expired for channel ${channelId}`);
    }
  }

  private evictToLimits(): void {
    while (this.entries.size > this.maxChannels || this.totalEstimatedBytes > this.maxBytes) {
      const oldest = [...this.entries.values()]
        .sort((left, right) => left.lastAccessedAt - right.lastAccessedAt)[0];
      if (!oldest) return;

      this.entries.delete(oldest.channelId);
      console.info(`Assistant summary cache evicted least-recently-used channel ${oldest.channelId}`);
    }
  }
}

export const assistantSummaryCache = new AssistantSummaryCache();
