import { describe, expect, test } from "bun:test";
import {
  AssistantSummaryCache,
  MAX_ASSISTANT_CONTINUATION_IDS,
  MAX_ASSISTANT_SUMMARY_SOURCE_IDS,
  type AssistantSummaryCacheInput,
} from "./assistant-summary-cache";

function entry(channelId: string, now: number, overrides: Partial<AssistantSummaryCacheInput> = {}): AssistantSummaryCacheInput {
  return {
    channelId,
    content: `Summary for ${channelId}`,
    sourceStartedAt: now - 100,
    sourceEndedAt: now - 50,
    generatedAt: now,
    model: "openrouter/free",
    usedFallback: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    lastConversationActivityAt: now,
    summarizedThroughMessageId: `${channelId}-last`,
    summarizedThroughTimestamp: now - 50,
    sourceMessageIds: [`${channelId}-source`],
    continuationAnchorIds: [`${channelId}-anchor`],
    ...overrides,
  };
}

describe("assistant summary cache", () => {
  test("expires on a non-sliding update TTL", () => {
    const cache = new AssistantSummaryCache(10_000, 10, 10_000, 100);
    cache.set(entry("one", 0), 0);

    expect(cache.get("one", 50)).toBeDefined();
    expect(cache.get("one", 100)).toBeUndefined();
  });

  test("evicts the least recently accessed channel", () => {
    const cache = new AssistantSummaryCache(100_000, 2, 10_000, 10_000);
    cache.set(entry("one", 0), 0);
    cache.set(entry("two", 1), 1);
    cache.get("one", 2);
    cache.set(entry("three", 3), 3);

    expect(cache.get("one", 4)).toBeDefined();
    expect(cache.get("two", 4)).toBeUndefined();
    expect(cache.get("three", 4)).toBeDefined();
  });

  test("invalidates only tracked source and continuation messages", () => {
    const cache = new AssistantSummaryCache();
    cache.set(entry("one", 1_000), 1_000);

    expect(cache.invalidateMessage("one", "unrelated")).toBe(false);
    expect(cache.invalidateMessage("one", "one-anchor")).toBe(true);
    expect(cache.get("one", 1_001)).toBeUndefined();
  });

  test("bounds tracked metadata and total estimated bytes", () => {
    const metadataCache = new AssistantSummaryCache(100_000, 100, 64 * 1024, 10_000);
    const sourceMessageIds = Array.from(
      { length: MAX_ASSISTANT_SUMMARY_SOURCE_IDS + 25 },
      (_, index) => `source-${index}`,
    );
    const continuationAnchorIds = Array.from(
      { length: MAX_ASSISTANT_CONTINUATION_IDS + 5 },
      (_, index) => `anchor-${index}`,
    );

    const stored = metadataCache.set(entry("one", 0, { sourceMessageIds, continuationAnchorIds }), 0);
    expect(stored?.sourceMessageIds).toHaveLength(MAX_ASSISTANT_SUMMARY_SOURCE_IDS);
    expect(stored?.continuationAnchorIds).toHaveLength(MAX_ASSISTANT_CONTINUATION_IDS);

    const cache = new AssistantSummaryCache(1_000, 100, 64 * 1024, 10_000);
    cache.set(entry("one", 0), 0);
    cache.set(entry("two", 1), 1);

    expect(cache.totalEstimatedBytes).toBeLessThanOrEqual(1_000);
    expect(cache.size).toBeLessThanOrEqual(1);
  });
});
