import { readdir } from "fs/promises";
import { join } from "path";
import { Client, Collection, Events, GatewayIntentBits } from "discord.js";
import { voiceHandler } from "./modules/voice";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences
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


client.login(process.env.DISCORD_TOKEN);