import { describe, expect, test } from "bun:test";
import {
  DEEPSEEK_ASSISTANT_MODEL,
  MULTIMODAL_ASSISTANT_MODEL,
  buildAssistantContent,
  buildAssistantPrompt,
  generateAssistantResponse,
  getAssistantAttachmentKind,
  selectAssistantModel,
  shouldForceWebSearch,
  stripWebCitations,
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

    expect(prompt).toContain("<discord_context>");
    expect(prompt).toContain("Alex");
    expect(prompt).toContain("<current_request>\nSummarize that.");
  });

  test("forces search for current and event-specific requests", () => {
    expect(shouldForceWebSearch({ prompt: "What are the current Rainbow Rumble rules?", context: [] })).toBe(true);
    expect(shouldForceWebSearch({ prompt: "Rewrite this sentence", context: [] })).toBe(false);
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
});
