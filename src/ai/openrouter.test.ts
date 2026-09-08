import { describe, expect, test } from "bun:test";
import {
  DEEPSEEK_ASSISTANT_MODEL,
  FREE_SUMMARY_MODEL,
  MULTIMODAL_ASSISTANT_MODEL,
  buildAssistantContent,
  buildAssistantPrompt,
  generateAssistantResponse,
  getAssistantAttachmentKind,
  selectAssistantModel,
  shouldForceWebSearch,
  stripWebCitations,
  summarizeAssistantConversation,
} from "./openrouter";

describe("assistant OpenRouter request helpers", () => {
  test("routes plain text to DeepSeek", () => {
    expect(selectAssistantModel()).toBe(DEEPSEEK_ASSISTANT_MODEL);
    expect(selectAssistantModel([
      { filename: "notes.txt", url: "https://cdn.example/notes.txt", contentType: "text/plain" },
    ])).toBe(DEEPSEEK_ASSISTANT_MODEL);
  });

  test("routes images and PDFs to the multimodal fallback", () => {
    expect(getAssistantAttachmentKind({
      filename: "photo.png",
      contentType: "image/png",
    })).toBe("image");
    expect(getAssistantAttachmentKind({
      filename: "rules.pdf",
    })).toBe("pdf");
    expect(selectAssistantModel([
      { filename: "rules.pdf", url: "https://cdn.example/rules.pdf" },
    ])).toBe(MULTIMODAL_ASSISTANT_MODEL);
  });

  test("builds text first and appends multimodal parts", () => {
    const content = buildAssistantContent({
      prompt: "What does this show?",
      context: [{ author: "Alex", content: "Look at this." }],
      attachments: [
        { filename: "robot.png", url: "https://cdn.example/robot.png", contentType: "image/png" },
        { filename: "rules.pdf", url: "https://cdn.example/rules.pdf", contentType: "application/pdf" },
      ],
    });

    expect(content[0]).toMatchObject({ type: "text" });
    expect(content[1]).toMatchObject({ type: "image_url", image_url: { url: "https://cdn.example/robot.png" } });
    expect(content[2]).toMatchObject({ type: "file", file: { filename: "rules.pdf", file_data: "https://cdn.example/rules.pdf" } });
  });

  test("keeps context and current request clearly separated", () => {
    const prompt = buildAssistantPrompt({
      prompt: "Summarize that.",
      context: [{ author: "Alex", content: "The match starts at 9." }],
    });

    expect(prompt).toContain("<recent_focus>");
    expect(prompt).toContain("Alex");
    expect(prompt).toContain("<current_request>\nSummarize that.");
  });

  test("orders exact relevance ahead of timestamped older summaries", () => {
    const prompt = buildAssistantPrompt({
      prompt: "What about that one?",
      directReplyFocus: [{ id: "reply", author: "Sam", content: "The blue robot.", createdTimestamp: 3 }],
      recentFocus: [{ id: "recent", author: "Alex", content: "It passed inspection.", createdTimestamp: 4 }],
      supportingRecentContext: [{ id: "support", author: "Jo", content: "Earlier exact context.", createdTimestamp: 2 }],
      summary: {
        content: "A much older red robot was discussed.",
        sourceStartedAt: 0,
        sourceEndedAt: 1,
        generatedAt: 5,
        model: "openrouter/free",
        usedFallback: false,
      },
    });

    expect(prompt.indexOf("<current_request>")).toBeLessThan(prompt.indexOf("<direct_reply_focus>"));
    expect(prompt.indexOf("<direct_reply_focus>")).toBeLessThan(prompt.indexOf("<recent_focus>"));
    expect(prompt.indexOf("<recent_focus>")).toBeLessThan(prompt.indexOf("<supporting_recent_context>"));
    expect(prompt.indexOf("<supporting_recent_context>")).toBeLessThan(prompt.indexOf("<older_conversation_summary>"));
    expect(prompt).toContain("Source range: 1970-01-01T00:00:00.000Z through 1970-01-01T00:00:00.001Z");
  });

  test("includes available server emojis and staff usage notes", () => {
    const prompt = buildAssistantPrompt({
      prompt: "React to that.",
      context: [],
      emojis: [{
        id: "123",
        name: "COPIUM",
        token: "<:COPIUM:123>",
        description: "Playful denial or wishful thinking, not serious disappointment.",
      }],
    });

    expect(prompt).toContain("<available_server_emojis>");
    expect(prompt).toContain("<:COPIUM:123> (COPIUM) - Staff usage note:");
  });

  test("makes an empty emoji catalog explicit", () => {
    expect(buildAssistantPrompt({ prompt: "Hi", context: [] })).toContain("[No custom server emojis are available.]");
  });

  test("forces search for current and event-specific requests", () => {
    expect(shouldForceWebSearch({ prompt: "What are the current Rainbow Rumble rules?", context: [] })).toBe(true);
    expect(shouldForceWebSearch({ prompt: "Rewrite this sentence", context: [] })).toBe(false);
  });

  test("does not let supporting context or an old summary force web search", () => {
    expect(shouldForceWebSearch({
      prompt: "Tell me more.",
      directReplyFocus: [],
      recentFocus: [],
      supportingRecentContext: [{ author: "Alex", content: "Check the current event schedule." }],
      summary: {
        content: "They discussed today's weather.",
        sourceStartedAt: 0,
        sourceEndedAt: 1,
        generatedAt: 2,
        model: "openrouter/free",
        usedFallback: false,
      },
    })).toBe(false);
  });

  test("removes web citation links while retaining answer text", () => {
    const answer = "The event is Saturday [source](https://example.com/event).";
    const cleaned = stripWebCitations(answer, [{
      type: "url_citation",
      url_citation: { url: "https://example.com/event" },
    }]);

    expect(cleaned).toBe("The event is Saturday source.");
    expect(cleaned).not.toContain("https://example.com/event");

    expect(stripWebCitations("The answer starts correctly.", [{
      type: "url_citation",
      url_citation: {
        url: "https://example.com/other",
        start_index: 0,
        end_index: 10,
      },
    }])).toBe("The answer starts correctly.");
  });

  test("offers OpenRouter's server web search tool", async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | undefined;

    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{ message: { content: "The answer is 42." } }],
        usage: { server_tool_use: { web_search_requests: 1 } },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await expect(generateAssistantResponse({
        prompt: "What is the current answer?",
        context: [],
      })).resolves.toBe("The answer is 42.");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requestBody?.tools).toEqual([{
      type: "openrouter:web_search",
      parameters: {
        engine: "exa",
        max_results: 5,
        max_total_results: 5,
        search_context_size: "low",
      },
    }]);
    expect(requestBody?.tool_choice).toBe("required");
    expect(requestBody?.max_tool_calls).toBe(1);
  });

  test("falls back to always-on search when the forced tool reports no search", async () => {
    const originalFetch = globalThis.fetch;
    const requestBodies: Record<string, unknown>[] = [];

    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const searched = requestBodies.length > 1;
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Verified answer." } }],
        usage: { server_tool_use: { web_search_requests: searched ? 1 : 0 } },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await expect(generateAssistantResponse({
        prompt: "What are the current event rules?",
        context: [],
      })).resolves.toBe("Verified answer.");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]?.tool_choice).toBe("required");
    expect(requestBodies[1]?.plugins).toEqual([{
      id: "web",
      engine: "exa",
      max_results: 5,
    }]);
  });

  test("summarizes with the free router without assistant web tools", async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        model: "google/gemma-4-31b-it:free",
        choices: [{ message: { content: "Compact summary." } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    try {
      await expect(summarizeAssistantConversation({ transcript: "Older messages." })).resolves.toEqual({
        content: "Compact summary.",
        model: "google/gemma-4-31b-it:free",
        usedFallback: false,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requestBody?.model).toBe(FREE_SUMMARY_MODEL);
    expect(requestBody?.tools).toBeUndefined();
    expect(requestBody?.plugins).toBeUndefined();
    expect(requestBody?.max_tokens).toBe(1_200);
  });

  test("retries any failed free summary once with DeepSeek", async () => {
    const originalFetch = globalThis.fetch;
    const requestBodies: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (requestBodies.length === 1) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        model: "deepseek/deepseek-v4-flash",
        choices: [{ message: { content: "Fallback summary." } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    try {
      await expect(summarizeAssistantConversation({ transcript: "Older messages." })).resolves.toEqual({
        content: "Fallback summary.",
        model: "deepseek/deepseek-v4-flash",
        usedFallback: true,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requestBodies.map(body => body.model)).toEqual([FREE_SUMMARY_MODEL, DEEPSEEK_ASSISTANT_MODEL]);
  });

  test("surfaces an error when both summary models fail", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("unavailable", { status: 503 })) as unknown as typeof fetch;

    try {
      await expect(summarizeAssistantConversation({ transcript: "Older messages." })).rejects.toThrow(
        "Both OpenRouter conversation summarizers failed",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
