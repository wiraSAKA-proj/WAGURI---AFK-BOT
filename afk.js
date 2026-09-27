const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const voiceManager = require('../voice/voiceManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('WAGURI bergabung dan AFK di Voice Channel kamu'),

  async execute(interaction) {
    const member = interaction.member;
    const voiceChannel = member.voice?.channel;

    if (!voiceChannel) {
      return interaction.reply({
        content: 'Kamu harus berada di Voice Channel terlebih dahulu.',
        ephemeral: true,
      });
    }

    const permissions = voiceChannel.permissionsFor(interaction.client.user);
    if (
      !permissions?.has(PermissionsBitField.Flags.Connect) ||
      !permissions?.has(PermissionsBitField.Flags.Speak)
    ) {
      return interaction.reply({
        content: '❌ Bot tidak memiliki izin **Connect**/**Speak** di voice channel tersebut.',
        ephemeral: true,
      });
    }

    const guildId = interaction.guildId;
    const alreadyConnected = voiceManager.isConnected(guildId);

    try {
      voiceManager.joinChannel(voiceChannel, interaction.client);
      voiceManager.setAfkMode(guildId, true);
    } catch (err) {
      console.error('[ERROR] Gagal join voice channel:', err.message);
      return interaction.reply({
        content: '❌ Terjadi kesalahan saat mencoba bergabung ke Voice Channel.',
        ephemeral: true,
      });
    }

    if (alreadyConnected) {
      return interaction.reply({
        content: `✅ WAGURI sudah aktif di <#${voiceChannel.id}> dan sekarang dalam mode AFK.`,
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: `✅ WAGURI sekarang AFK di #${voiceChannel.name}.`,
    });
  },
};
