require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, ActivityType } = require('discord.js');
const musicManager = require('./music/musicManager');

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error('[ERROR] DISCORD_TOKEN tidak ditemukan. Buat file .env berdasarkan .env.example lalu isi token bot kamu.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
  } else {
    console.warn(`[WARN] Command di file ${file} tidak memiliki "data" atau "execute", dilewati.`);
  }
}

function updatePresence() {
  let anyMusicPlaying = false;
  for (const guild of client.guilds.cache.values()) {
    if (musicManager.isPlaying(guild.id)) {
      anyMusicPlaying = true;
      break;
    }
  }

  const statusText = anyMusicPlaying ? 'WAGURI • Lofi Chill' : 'WAGURI • AFK';

  client.user.setPresence({
    activities: [
      {
        name: statusText,
        state: statusText,
        type: ActivityType.Custom,
      },
    ],
    status: 'online',
  });
}

client.once('ready', () => {
  console.log(`[READY] Login sebagai ${client.user.tag}`);
  updatePresence();
  setInterval(updatePresence, 30_000);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    console.warn(`[WARN] Command tidak dikenal: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`[ERROR] Error saat menjalankan command "${interaction.commandName}":`, error);

    const errorMessage = '❌ Terjadi kesalahan saat menjalankan command ini.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true }).catch(() => {});
    }
  }
});

client.on('error', (error) => {
  console.error('[ERROR] Client error:', error.message);
});

process.on('unhandledRejection', (error) => {
  console.error('[ERROR] Unhandled promise rejection:', error);
});

client.login(token).catch((error) => {
  if (error.code === 'TokenInvalid' || /token/i.test(error.message)) {
    console.error('[ERROR] DISCORD_TOKEN tidak valid. Periksa kembali token bot kamu di file .env.');
  } else {
    console.error('[ERROR] Gagal login ke Discord:', error.message);
  }
  process.exit(1);
});
