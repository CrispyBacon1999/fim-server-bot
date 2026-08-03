# discord-bot

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

## Assistant mentions

Members with the `Manage Channels` permission can mention the bot in a message to ask it a question or ask it to do something. Replying to a message gives the assistant that message as context; a mention without a reply uses up to the eight preceding messages from the same channel. Context is fetched on demand and is not stored.

Text requests use the configured OpenRouter DeepSeek model. Requests containing an image or PDF attachment use the configured multimodal fallback. The assistant can use OpenRouter's web search for current information, but normally keeps source links out of its short response.

The bot must have the Message Content intent enabled, along with `View Channel`, `Read Message History`, and `Send Messages` permissions. `OPENROUTER_API_KEY` must be set in the environment.

This project was created using `bun init` in bun v1.2.11. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
