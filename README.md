# discord-bot

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

## Assistant conversations

Members with the `Manage Channels` permission can mention the bot to start a request. They can continue by replying directly to the bot without mentioning it again.

The assistant treats uninterrupted channel or thread activity as one conversation, stopping at a gap longer than 15 minutes. Discord reply ancestors are still followed across older gaps. The current request and its reply chain receive the highest priority, followed by the eight newest exact messages, other recent messages, and finally any older summary. This keeps recent corrections and topics from being displaced by older background.

Context is reconstructed from Discord and is not written to the database. Exceptionally large conversations are compacted into summaries held only in process memory. The cache expires summaries after six hours, invalidates tracked edited or deleted messages, and is limited to 100 channels, 64 KiB per entry, and 2 MiB total using least-recently-used eviction. Restarting the bot clears all summaries.

Summarization tries OpenRouter's `openrouter/free` router first. If that request fails for any reason, it retries once with the configured DeepSeek assistant model. If both attempts fail, the assistant keeps any prior valid summary and uses the newest exact context that fits.

Text requests use the configured OpenRouter DeepSeek model. Requests containing an image or PDF attachment use the configured multimodal fallback. The assistant can use OpenRouter's web search for current information, but normally keeps source links out of its short response.

The assistant can use the invoking server's custom emojis when they fit naturally. Members with `Manage Channels` can use `/assistant-emoji set` to add a short usage note for a server emoji, `/assistant-emoji list` to review notes, and `/assistant-emoji remove` to delete one. Emoji notes are per-server and are stored in the database.

The bot must have the Message Content intent enabled, along with `View Channel`, `Read Message History`, and `Send Messages` permissions. `OPENROUTER_API_KEY` must be set in the environment.

This project was created using `bun init` in bun v1.2.11. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
