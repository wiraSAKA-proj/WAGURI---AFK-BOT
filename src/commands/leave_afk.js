const { SlashCommandBuilder } = require('discord.js');
const voiceManager = require('../voice/voiceManager');
const musicManager = require('../music/musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leave_afk')
    .setDescription('Mengeluarkan WAGURI dari Voice Channel'),

  async execute(interaction) {
    const guildId = interaction.guildId;

    if (!voiceManager.isConnected(guildId)) {
      return interaction.reply({
        content: '❌ Bot sedang tidak berada di Voice Channel.',
        ephemeral: true,
      });
    }

    // Hentikan musik dulu (jika ada) sebelum memutus koneksi voice.
    musicManager.stopMusic(guildId);
    voiceManager.leaveChannel(guildId);

    return interaction.reply({
      content: '👋 WAGURI keluar dari Voice Channel.',
    });
  },
};
