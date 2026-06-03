FROM oven/bun:latest

WORKDIR /app

COPY . .

RUN bun install

CMD ["sh", "-c", "bun deploy-commands && bun start"]
