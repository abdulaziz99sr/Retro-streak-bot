
const {
  Client,
  GatewayIntentBits,
  Events
} = require('discord.js');

// =====================================
// SETTINGS
// =====================================

const TOKEN = process.env.TOKEN;

const GUILD_ID = '1554748054412992564';

const CHANNEL_IDS = [
  '1556370759578947664',
  '1556370810690740304'
];

const STICKY_TEXT = 'Posts Only | بوستات فقط';

// =====================================
// CLIENT
// =====================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// منع تداخل العمليات في نفس الروم
const channelQueues = new Map();

function enqueue(channelId, task) {
  const previous =
    channelQueues.get(channelId) || Promise.resolve();

  const current = previous
    .catch(() => {})
    .then(task);

  channelQueues.set(channelId, current);

  current
    .finally(() => {
      if (channelQueues.get(channelId) === current) {
        channelQueues.delete(channelId);
      }
    })
    .catch(() => {});

  return current;
}

// =====================================
// CHECK IMAGE OR VIDEO
// =====================================

function isAllowedPost(message) {
  const hasMediaFile = message.attachments.some(file => {
    const type = (file.contentType || '').toLowerCase();
    const name = (file.name || '').toLowerCase();

    if (type.startsWith('image/')) return true;
    if (type.startsWith('video/')) return true;

    return /\.(png|jpg|jpeg|gif|webp|heic|bmp|mp4|mov|webm|m4v|avi)$/i.test(name);
  });

  const hasDirectMediaLink =
    /https?:\/\/[^\s<>]+\.(png|jpg|jpeg|gif|webp|mp4|mov|webm)(?:\?[^\s<>]*)?/i
      .test(message.content);

  const hasVideoLink =
    /https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be|tiktok\.com|instagram\.com\/(?:reel|p)\/)[^\s<>]*/i
      .test(message.content);

  return hasMediaFile || hasDirectMediaLink || hasVideoLink;
}

// =====================================
// DELETE OLD STICKY MESSAGES
// =====================================

async function deleteOldStickies(channel) {
  let before;
  let checked = 0;

  while (checked < 100) {
    const options = {
      limit: Math.min(100, 100 - checked)
    };

    if (before) {
      options.before = before;
    }

    const messages = await channel.messages.fetch(options);

    if (messages.size === 0) break;

    checked += messages.size;

    const oldest = messages.last();

    const oldStickies = messages.filter(message =>
      message.author.id === client.user.id &&
      message.content === STICKY_TEXT
    );

    for (const message of oldStickies.values()) {
      try {
        await message.delete();
      } catch (error) {
        console.error(
          'FAILED TO DELETE OLD STICKY:',
          error.message
        );
      }
    }

    if (messages.size < options.limit) break;

    before = oldest.id;
  }
}

// =====================================
// REFRESH STICKY MESSAGE
// =====================================

async function refreshSticky(channel) {
  await deleteOldStickies(channel);

  await channel.send({
    content: STICKY_TEXT,
    allowedMentions: {
      parse: []
    }
  });

  console.log(`STICKY UPDATED: ${channel.id}`);
}

// =====================================
// BOT READY
// =====================================

client.once(Events.ClientReady, async () => {
  console.log(`STREAK BOT ONLINE: ${client.user.tag}`);

  for (const channelId of CHANNEL_IDS) {
    try {
      const channel = await client.channels.fetch(channelId);

      if (
        !channel ||
        channel.guildId !== GUILD_ID ||
        !channel.isTextBased() ||
        !channel.messages
      ) {
        console.log(`INVALID CHANNEL: ${channelId}`);
        continue;
      }

      await enqueue(channelId, async () => {
        await refreshSticky(channel);
      });

      console.log(`CHANNEL READY: ${channelId}`);

    } catch (error) {
      console.error(
        `STARTUP ERROR IN ${channelId}:`,
        error
      );
    }
  }
});

// =====================================
// NEW MESSAGE
// =====================================

client.on(Events.MessageCreate, async message => {
  if (!message.guild) return;

  if (message.guild.id !== GUILD_ID) return;

  if (!CHANNEL_IDS.includes(message.channelId)) return;

  // تجاهل رسائل البوتات
  if (message.author.bot) return;

  try {
    await enqueue(message.channelId, async () => {

      // =================================
      // TEXT ONLY = DELETE
      // =================================

      if (!isAllowedPost(message)) {
        try {
          await message.delete();

          console.log(
            `TEXT DELETED: ${message.author.username}`
          );

        } catch (error) {
          console.error(
            'FAILED TO DELETE TEXT:',
            error
          );
        }

        return;
      }

      // =================================
      // IMAGE / VIDEO = KEEP
      // =================================

      console.log(
        `POST ACCEPTED: ${message.author.username}`
      );

      // تحديث تنبيه Posts Only
      await refreshSticky(message.channel);

    });

  } catch (error) {
    console.error('MESSAGE ERROR:', error);
  }
});

// =====================================
// ERROR HANDLING
// =====================================

client.on(Events.Error, error => {
  console.error('DISCORD CLIENT ERROR:', error);
});

process.on('unhandledRejection', error => {
  console.error('UNHANDLED REJECTION:', error);
});

// =====================================
// LOGIN
// =====================================

if (!TOKEN) {
  console.error('ERROR: TOKEN IS MISSING');
  process.exit(1);
}

client.login(TOKEN).catch(error => {
  console.error('LOGIN FAILED:', error);
  process.exit(1);
});
