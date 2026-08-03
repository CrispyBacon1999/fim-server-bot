CREATE TABLE `assistant_emoji_guides` (
  `guildId` varchar(32) NOT NULL,
  `emojiId` varchar(32) NOT NULL,
  `description` varchar(500) NOT NULL,
  CONSTRAINT `assistant_emoji_guides_guildId_emojiId_pk` PRIMARY KEY (`guildId`, `emojiId`)
);
