FROM oven/bun:latest

WORKDIR /app

COPY . .

RUN bun install

# RUN bun deploy-commands

CMD ["bun", "start"]
