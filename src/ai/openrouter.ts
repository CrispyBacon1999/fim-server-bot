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
  const prompt = `Determine if this Discord reply message is DIRECTLY thanking the person being replied to for something they personally did (like helping, answering a question, providing advice, sharing something useful, etc).

ONLY answer "yes" if the message:
- Contains explicit thanks/gratitude words (thanks, thank you, ty, thx, appreciated, etc.) directed at the person
- OR clearly implies gratitude for something the PERSON did to help

Answer "no" if the message:
- Praises or compliments something OTHER than the person (a product, bot, tool, game, etc.)
- Is general positive commentary not directed at the person's actions
- Is agreeing with or supporting what someone said without thanking them
- Is just a compliment about someone's skill/trait without thanking for help

Examples:
"thanks for the help!" → yes
"ty that fixed it" → yes  
"you're a lifesaver" → yes
"appreciate it man" → yes
"Best FTC bot ever tbh" → no (praising a bot, not thanking the person)
"that's awesome!" → no (general positive reaction)
"yeah I agree" → no (agreement, not thanks)
"you're so good at this game" → no (compliment, not thanks for help)
"this is really cool" → no (praising something, not thanking)

Message: """${messageContent}"""

Answer only "yes" or "no":`;

  const response = await openrouter.chat.completions.create({
    model: "openai/gpt-4o-mini",
    messages: [
      { role: "user", content: prompt }
    ],
    max_tokens: 3,
    temperature: 0,
  });

  const answer = response.choices[0]?.message?.content?.trim().toLowerCase();
  return answer === "yes";
}
