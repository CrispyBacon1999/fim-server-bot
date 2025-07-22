import { ActivityType, ChannelType, GuildMember, VoiceChannel, type Client, type VoiceState } from "discord.js";
import { db } from "../db/db";
import { voiceChannelConfigTable, voiceChannelTable } from "../db/schema";
import { eq } from "drizzle-orm";

export async function voiceHandler(client: Client, oldState: VoiceState, newState: VoiceState) {
  // Make sure the user changed channels
  if (newState.channel?.id === oldState.channel?.id) return;
  if (newState.channel?.id) {
    await userJoinedVoiceChannel(client, newState);
  }

  if (oldState.channel?.id) {
    await userLeftVoiceChannel(client, oldState);

  }
}

async function userJoinedVoiceChannel(client: Client, voiceState: VoiceState) {
  const config = await db.query.voiceChannelConfigTable.findFirst({
    where: eq(voiceChannelConfigTable.baseVoiceChannelId, voiceState.channel?.id!),
  })
  if (!config) return;

  console.log(config);

  let newChannel: VoiceChannel | undefined;

  if (config.configurationMode === "incremental") {

    const incrementalResponse = await createNewVoiceChannelIncremental(client, config);
    newChannel = incrementalResponse[0];
    const index = incrementalResponse[1];

    if (newChannel && index) {
      await db.insert(voiceChannelTable).values({
        id: newChannel.id,
        createdBy: voiceState.member?.id!,
        index,
        baseVoiceChannelId: config.baseVoiceChannelId,
      })
    }
  } else if (config.configurationMode === "username") {
    newChannel = await createNewVoiceChannelUsername(client, voiceState.member!, config);
    if (newChannel) {
      await db.insert(voiceChannelTable).values({
        id: newChannel.id,
        createdBy: voiceState.member?.id!,
        index: 1,
        baseVoiceChannelId: config.baseVoiceChannelId,
      })
    }
  } else if (config.configurationMode === "game") {
    newChannel = await createNewVoiceChannelGame(client, voiceState.member!, config);
    if (newChannel) {
      await db.insert(voiceChannelTable).values({
        id: newChannel.id,
        createdBy: voiceState.member?.id!,
        index: 1,
        baseVoiceChannelId: config.baseVoiceChannelId,
      })
    }
  }

  if (newChannel) {
    await voiceState.member?.voice.setChannel(newChannel.id);

    await newChannel.permissionOverwrites.create(voiceState.member?.user.id!, {
      ManageChannels: true
    })
  }
}

async function userLeftVoiceChannel(client: Client, voiceState: VoiceState) {
  const dbChannel = await db.query.voiceChannelTable.findFirst({
    where: eq(voiceChannelTable.id, voiceState.channel?.id!)
  })
  if (!dbChannel) return;

  // Get discord channel
  const discordChannel = client.channels.cache.get(voiceState.channel?.id!);
  if (!discordChannel || discordChannel.type !== ChannelType.GuildVoice) return;

  // Get all users in the channel
  const users = discordChannel.members.map(member => member.id);

  // If there are no users in the channel, delete the channel
  if (users.length === 0) {
    await deleteVoiceChannel(client, dbChannel);
  }
}

async function deleteVoiceChannel(client: Client, dbChannel: typeof voiceChannelTable.$inferSelect) {
  const config = await db.query.voiceChannelConfigTable.findFirst({
    where: eq(voiceChannelConfigTable.baseVoiceChannelId, dbChannel.baseVoiceChannelId)
  })
  if (!config) return;

  await client.channels.cache.get(dbChannel.id)?.delete();
  await db.delete(voiceChannelTable).where(eq(voiceChannelTable.id, dbChannel.id));
}

async function createNewVoiceChannelIncremental(client: Client, config: typeof voiceChannelConfigTable.$inferSelect): Promise<[VoiceChannel | undefined, number | undefined]> {
  const { categoryToCreateIn, defaultMaxUsers, name } = config;

  if (categoryToCreateIn) {
    const category = client.channels.cache.get(categoryToCreateIn);
    if (!category) return [undefined, undefined];

    const voiceChannels = await db.query.voiceChannelTable.findMany({
      where: eq(voiceChannelTable.baseVoiceChannelId, config.baseVoiceChannelId),
    })

    let index = 1;
    for (const vc of voiceChannels) {
      if (vc.index !== index) {
        break;
      }
      index++;
    }

    const newChannel = await client.guilds.cache.get(config.guildId)?.channels.create({
      name: `${name} ${index}`,
      type: ChannelType.GuildVoice,
      parent: category.id,
      userLimit: defaultMaxUsers,
    })

    return [newChannel, index];
  }

  return [undefined, undefined];
}

async function createNewVoiceChannelUsername(client: Client, user: GuildMember, config: typeof voiceChannelConfigTable.$inferSelect): Promise<VoiceChannel | undefined> {
  const { categoryToCreateIn, defaultMaxUsers, name } = config;

  if (categoryToCreateIn) {
    const category = client.channels.cache.get(categoryToCreateIn);
    if (!category) return undefined;

    const newChannel = await client.guilds.cache.get(config.guildId)?.channels.create({
      name: `${user.user.username}'s VC`,
      type: ChannelType.GuildVoice,
      parent: category.id,
      userLimit: defaultMaxUsers,
    });

    return newChannel;
  }

  return undefined;
}

async function createNewVoiceChannelGame(client: Client, user: GuildMember, config: typeof voiceChannelConfigTable.$inferSelect): Promise<VoiceChannel | undefined> {
  const { categoryToCreateIn, defaultMaxUsers, name } = config;

  if (categoryToCreateIn) {
    const category = client.channels.cache.get(categoryToCreateIn);
    if (!category) return undefined;

    const game = user.presence?.activities.find(activity => activity.type === ActivityType.Playing);

    if (game) {
      const newChannel = await client.guilds.cache.get(config.guildId)?.channels.create({
        name: `${game.name}`,
        type: ChannelType.GuildVoice,
        parent: category.id,
        userLimit: defaultMaxUsers,
      });

      return newChannel;
    }

    const newChannel = await client.guilds.cache.get(config.guildId)?.channels.create({
      name: `${user.user.username}'s VC`,
      type: ChannelType.GuildVoice,
      parent: category.id,
      userLimit: defaultMaxUsers,
    });

    return newChannel;
  }

  return undefined;
}
