const { SlashCommandBuilder } = require('discord.js');
const voiceManager = require('../voice/voiceManager');
const musicManager = require('../music/musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop_music')
    .setDescription('Menghentikan musik yang sedang diputar (bot tetap di Voice Channel)'),

  async execute(interaction) {
    const guildId = interaction.guildId;

    if (!voiceManager.isConnected(guildId)) {
      return interaction.reply({
        content: '❌ Bot sedang tidak berada di Voice Channel.',
        ephemeral: true,
      });
    }

    const wasPlaying = musicManager.isPlaying(guildId) || musicManager.getQueueLength(guildId) > 0;
    musicManager.stopMusic(guildId);

    if (!wasPlaying) {
      return interaction.reply({
        content: 'ℹ️ Tidak ada musik yang sedang diputar.',
        ephemeral: true,
      });
    }

    return interaction.reply('⏹️ Musik dihentikan. WAGURI tetap berada di Voice Channel.');
  },
};
