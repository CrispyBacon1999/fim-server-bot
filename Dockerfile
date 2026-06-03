FROM oven/bun:latest

WORKDIR /app

COPY . .

RUN bun install

CMD ["sh", "-c", "bunx drizzle-kit push && bun deploy-commands && bun start"]
