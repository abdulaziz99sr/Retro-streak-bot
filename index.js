const {
  Client,
  GatewayIntentBits,
  Events,
  PermissionFlagsBits
} = require('discord.js');

const TOKEN = process.env.TOKEN;

const GUILD_ID = '1554748054412992564';

const CHANNEL_IDS = [
  '1556370759578947664',
  '1556370810690740304'
];

const STICKY_TEXT = 'Posts Only | بوستات فقط';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Prevent simultaneous updates in the same channel
const channelQueues = new Map();

// Remember the last sticky message
const stickyIds = new Map();

function runInQueue(channelId, task) {
  const previous =
    channelQueues.get(channelId) || Promise.resolve();

  const current = previous
    .catch(() => {})
    .then(task);

  channelQueues.set(channelId, current);

  current.finally(() => {
    if (channelQueues.get(channelId) === current) {
      channelQueues.delete(channelId);
    }
  }).catch(() => {});

  return current;
}

// Check whether a message contains a photo or video
function hasMedia(message) {
  const attachments = [...message.attachments.values()];

  const validAttachment = attachments.some(file => {
    const type = file.contentType || '';
    const name = file.name || '';

    return (
      type.startsWith('image/') ||
      type.startsWith('video/') ||
      /\.(png|jpg|jpeg|gif|webp|bmp|heic|mp4|mov|webm|m4v|avi)$/i.test(name)
    );
  });

  if (validAttachment) return true;

  // GIFs, videos, images and linked media
  const validEmbed = message.embeds.some(embed => {
    return (
      embed.image ||
      embed.video ||
      embed.thumbnail ||
      embed.type === 'gifv' ||
      embed.type === 'image' ||
      embed.type === 'video'
    );
  });

  return validEmbed;
}

async function fetchRecentMessages(channel) {
  return channel.messages.fetch({
    limit: 100
  });
}

async function refreshSticky(channel, forceNew = false) {
  const messages = await fetchRecentMessages(channel);

  const stickyMessages = messages.filter(message =>
    message.author.id === client.user.id &&
    message.content === STICKY_TEXT
  );

  const newestSticky = stickyMessages.first();

  // If the last message is already the only sticky,
  // do not send another one.
  const lastMessage = messages.first();

  if (
    !forceNew &&
    newestSticky &&
    lastMessage?.id === newestSticky.id &&
    stickyMessages.size === 1
  ) {
    stickyIds.set(channel.id, newestSticky.id);
    return;
  }

  // Delete previous sticky messages
  for (const message of stickyMessages.values()) {
    await message.delete().catch(error => {
      console.error(
        `Could not delete old sticky in ${channel.id}:`,
        error.message
      );
    });
  }

  // Also delete the remembered sticky if not in last 100
  const rememberedId = stickyIds.get(channel.id);

  if (
    rememberedId &&
    !stickyMessages.has(rememberedId)
  ) {
    const oldMessage = await channel.messages
      .fetch(rememberedId)
      .catch(() => null);

    if (
      oldMessage &&
      oldMessage.author.id === client.user.id &&
      oldMessage.content === STICKY_TEXT
    ) {
      await oldMessage.delete().catch(() => {});
    }
  }

  const newSticky = await channel.send({
    content: STICKY_TEXT,
    allowedMentions: {
      parse: []
    }
  });

  stickyIds.set(channel.id, newSticky.id);
}

client.once(Events.ClientReady, async () => {
  console.log(`STREAK BOT ONLINE: ${client.user.tag}`);

  for (const channelId of CHANNEL_IDS) {
    try {
      const channel = await client.channels.fetch(channelId);

      if (!channel || !channel.isTextBased()) {
        console.log(`Channel not found: ${channelId}`);
        continue;
      }

      if (channel.guild?.id !== GUILD_ID) continue;

      await runInQueue(channel.id, () =>
        refreshSticky(channel)
      );

      console.log(`Streak channel ready: ${channelId}`);
    } catch (error) {
      console.error(
        `Startup error in ${channelId}:`,
        error
      );
    }
  }
});

client.on(Events.MessageCreate, async message => {
  if (!message.guild) return;
  if (message.guild.id !== GUILD_ID) return;
  if (!CHANNEL_IDS.includes(message.channel.id)) return;
  if (message.author.bot) return;

  await runInQueue(message.channel.id, async () => {
    try {
      // Re-fetch to allow embeds to resolve
      let currentMessage = await message.fetch()
        .catch(() => message);

      if (!hasMedia(currentMessage)) {
        // Give linked media embeds a moment to load
        if (
          /https?:\/\/\S+/i.test(currentMessage.content)
        ) {
          await new Promise(resolve =>
            setTimeout(resolve, 1500)
          );

          currentMessage = await message.fetch()
            .catch(() => currentMessage);
        }
      }

      if (!hasMedia(currentMessage)) {
        await message.delete().catch(error => {
          console.error(
            'Could not delete text message:',
            error.message
          );
        });

        return;
      }

      // Valid photo/video: move sticky to bottom
      await refreshSticky(message.channel, true);