const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const voiceManager = require('../voice/voiceManager');
const musicManager = require('../music/musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play_music')
    .setDescription('Memutar musik Lofi Chill di Voice Channel'),

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

    await interaction.deferReply();

    const guildId = interaction.guildId;
    const joinedJustNow = !voiceManager.isConnected(guildId);

    let connection;
    try {
      connection = voiceManager.joinChannel(voiceChannel, interaction.client);
    } catch (err) {
      console.error('[ERROR] Gagal join voice channel:', err.message);
      return interaction.editReply('❌ Terjadi kesalahan saat mencoba bergabung ke Voice Channel.');
    }

    try {
      await musicManager.playMusic(guildId, connection);
    } catch (err) {
      console.error('[ERROR] Gagal memutar musik:', err.message);

      // Jika bot baru saja join khusus untuk musik ini (bukan sedang mode AFK) lalu gagal,
      // keluar lagi supaya bot tidak "nyangkut" tanpa alasan di voice channel.
      if (joinedJustNow && !voiceManager.isAfkMode(guildId)) {
        voiceManager.leaveChannel(guildId);
      }

      return interaction.editReply(
        `❌ Gagal memutar musik. Stream sedang tidak tersedia atau terjadi error. (${err.message})`
      );
    }

    return interaction.editReply(`🎵 WAGURI sekarang memutar **Lofi Chill** di #${voiceChannel.name}.`);
  },
};
