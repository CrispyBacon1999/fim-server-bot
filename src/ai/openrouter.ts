import OpenAI from "openai";

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
})

/**
 * Checks if the given message content expresses gratitude (thanks) to the person being replied to.
 * @param {string} messageContent - The content of the message to analyze.
 * @returns {Promise<boolean>} - Resolves to true if the message is thanking the person, false otherwise.
 */
export async function isThankingReply(messageContent: string): Promise<boolean> {
  const prompt = `
You are an AI assistant. Your task is to determine if the following message is expressing thanks or gratitude to the person being replied to.

Message: """${messageContent}"""

Respond with only "yes" if the message is thanking the person being replied to, or "no" if it is not. Do not include any other text.
`;

  const response = await openrouter.chat.completions.create({
    model: "google/gemini-2.0-flash-lite-001",
    messages: [
      { role: "system", content: "You are a helpful assistant that detects gratitude in replies." },
      { role: "user", content: prompt }
    ],
    max_tokens: 3,
    temperature: 0,
  });

  const answer = response.choices[0]?.message?.content?.trim().toLowerCase();
  return answer === "yes";
}
