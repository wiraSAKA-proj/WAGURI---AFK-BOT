require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token) {
  console.error('[ERROR] DISCORD_TOKEN tidak ditemukan di environment variable. Cek file .env kamu.');
  process.exit(1);
}

if (!clientId) {
  console.error('[ERROR] CLIENT_ID tidak ditemukan di environment variable. CLIENT_ID wajib diisi untuk registrasi command.');
  process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if ('data' in command && 'execute' in command) {
    commands.push(command.data.toJSON());
  } else {
    console.warn(`[WARN] Command di file ${file} tidak memiliki "data" atau "execute", dilewati.`);
  }
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`[READY] Mendaftarkan ${commands.length} slash command: ${commands.map((c) => c.name).join(', ')}`);

    let data;
    if (guildId) {
      data = await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log(`[READY] Berhasil mendaftarkan ${data.length} guild command untuk guild ${guildId} (muncul instan).`);
    } else {
      data = await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log(`[READY] Berhasil mendaftarkan ${data.length} global command. (Bisa memakan waktu hingga 1 jam untuk muncul di semua server)`);
    }
  } catch (error) {
    console.error('[ERROR] Gagal mendaftarkan slash command:', error);
    process.exit(1);
  }
})();
