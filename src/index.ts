import { readdir } from "fs/promises";
import { join } from "path";
import { ChannelType, Client, Collection, Events, GatewayIntentBits } from "discord.js";
import { voiceHandler } from "./modules/voice";
import { reputationHandler } from "./modules/rep";
import { Cron } from "croner";
import { db } from "./db/db";
import { reputationMessageConfigTable, reputationMessageTable } from "./db/schema";
import { eq, sql } from "drizzle-orm";

const client = new Client({
  intents: [
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
  ]
});

client.once(Events.ClientReady, readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

// Register commands automatically
client.commands = new Collection();

const commandFolders = await readdir(join(__dirname, "commands"));
for (const folder of commandFolders) {
  const commandsPath = join(__dirname, "commands", folder);
  const commandFiles = await readdir(commandsPath);
  for (const file of commandFiles) {
    const filePath = join(commandsPath, file);
    const command = await import(filePath);
    if ("data" in command && "execute" in command) {
      client.commands.set(command.data.name, command);
    } else {
      console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
  }
}

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    await interaction.reply({ content: "There was an error while executing this command!", ephemeral: true });
  }
})

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  voiceHandler(client, oldState, newState);
})

client.on(Events.MessageCreate, (message) => {
  reputationHandler(client, message);
});

client.login(process.env.DISCORD_TOKEN);

// Send the leaderboard message every month and reset the database
const repReset = new Cron("0 12 1 * *", async () => {
  console.log("Resetting reputation leaderboards");
  const guildsWithRep = await db.selectDistinct({ guildId: reputationMessageTable.guildId }).from(reputationMessageTable);

  for (const guild of guildsWithRep) {
    const leaderboard = await db
      .select({
        authorId: reputationMessageTable.authorId,
        authorUsername: reputationMessageTable.authorUsername,
        count: sql<number>`COUNT(${reputationMessageTable.messageId})`,
      })
      .from(reputationMessageTable)
      .where(eq(reputationMessageTable.guildId, guild.guildId))
      .groupBy(reputationMessageTable.authorId, reputationMessageTable.authorUsername)
      .orderBy(sql`COUNT(*) DESC`);

    const config = await db.query.reputationMessageConfigTable.findFirst({
      where: eq(reputationMessageConfigTable.guildId, guild.guildId),
    })

    const channel = await client.guilds.cache.get(guild.guildId)?.channels.cache.get(config?.leaderboardChannelId!);

    if (channel && channel.type === ChannelType.GuildText) {
      await channel.send({ content: `Leaderboard for ${guild.guildId}: ${leaderboard.map(l => `<@${l.authorId}> (${l.count})`).join("\n")}` });
    }

    console.log(`Resetting reputation leaderboard for ${guild.guildId}`);
    await db.delete(reputationMessageTable).where(eq(reputationMessageTable.guildId, guild.guildId));
  }

});