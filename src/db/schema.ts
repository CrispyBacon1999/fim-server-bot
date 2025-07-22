import { relations } from "drizzle-orm";
import { mysqlTable, varchar, int, boolean } from "drizzle-orm/mysql-core";

export const voiceChannelTable = mysqlTable("voice_channels", {
  id: varchar({ length: 32 }).primaryKey(),
  createdBy: varchar({ length: 32 }).notNull(),
  index: int().notNull().default(1),
  baseVoiceChannelId: varchar({ length: 32 }).notNull(),
})

export const voiceChannelRelations = relations(voiceChannelTable, ({ one }) => ({
  baseVoiceChannel: one(voiceChannelConfigTable, {
    fields: [voiceChannelTable.baseVoiceChannelId],
    references: [voiceChannelConfigTable.baseVoiceChannelId],
  })
}))

export const voiceChannelConfigTable = mysqlTable("voice_channel_configs", {
  baseVoiceChannelId: varchar({ length: 32 }).primaryKey(),
  guildId: varchar({ length: 32 }).notNull(),
  categoryToCreateIn: varchar({ length: 32 }),
  configurationMode: varchar({ enum: ["incremental", "username", "game"], length: 16 }).notNull(),
  defaultMaxUsers: int().notNull().default(10),
  editableByCreator: boolean().notNull().default(true),
  name: varchar({ length: 20 }).default("VC")
})