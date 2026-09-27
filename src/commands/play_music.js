const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const voiceManager = require('../voice/voiceManager');
const musicManager = require('../music/musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play_music')
    .setDescription('Memutar musik: link YouTube/Spotify, atau kosongkan untuk Lofi Chill')
    .addStringOption((option) =>
      option
        .setName('link')
        .setDescription('Link video/playlist YouTube, link lagu Spotify, atau nama lagu untuk dicari')
        .setRequired(false)
    ),

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

    const link = interaction.options.getString('link');

    try {
      if (!link) {
        await musicManager.playDefaultLofi(guildId, connection);
        return interaction.editReply(`🎵 WAGURI sekarang memutar **Lofi Chill** di #${voiceChannel.name}.`);
      }

      const result = await musicManager.resolveAndQueue(guildId, connection, link);
      const label = result.firstTitle || 'lagu';

      if (result.started) {
        const extra = result.addedCount > 1 ? ` (+${result.addedCount - 1} lagu lain di antrian)` : '';
        return interaction.editReply(`🎵 WAGURI sekarang memutar **${label}**${extra} di #${voiceChannel.name}.`);
      }

      return interaction.editReply(
        `➕ Ditambahkan **${result.addedCount}** lagu ke antrian (mulai dari **${label}**).`
      );
    } catch (err) {
      console.error('[ERROR] Gagal memutar musik:', err.message);

      if (joinedJustNow && !voiceManager.isAfkMode(guildId)) {
        voiceManager.leaveChannel(guildId);
      }

      return interaction.editReply(`❌ Gagal memutar musik. ${err.message}`);
    }
  },
};
