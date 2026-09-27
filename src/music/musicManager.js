const {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const prism = require('prism-media');
const ffmpegPath = require('ffmpeg-static');

// state per guild: { player, ffmpegProcess, isPlaying }
const musicStates = new Map();

function getDefaultStreamUrl() {
  // Default: SomaFM Groove Salad - radio internet legal & gratis, cocok untuk lofi/chill.
  // Bisa diganti lewat environment variable LOFI_STREAM_URL ke URL stream legal lainnya.
  return process.env.LOFI_STREAM_URL || 'https://ice1.somafm.com/groovesalad-128-mp3';
}

function getMusicState(guildId) {
  if (!musicStates.has(guildId)) {
    musicStates.set(guildId, {
      player: null,
      ffmpegProcess: null,
      isPlaying: false,
    });
  }
  return musicStates.get(guildId);
}

function isPlaying(guildId) {
  return getMusicState(guildId).isPlaying;
}

/**
 * Membuat stream PCM (s16le, 48kHz, stereo) dari URL stream radio menggunakan ffmpeg,
 * sehingga bisa langsung dikonsumsi oleh @discordjs/voice.
 */
function createPcmStream(streamUrl) {
  return new prism.FFmpeg({
    command: ffmpegPath,
    args: [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', streamUrl,
      '-analyzeduration', '0',
      '-loglevel', '0',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
    ],
  });
}

/**
 * Memutar musik lofi chill pada voice connection yang diberikan.
 * Resolve saat player berhasil mulai playing, reject jika gagal/error.
 */
function playMusic(guildId, connection, streamUrl = getDefaultStreamUrl()) {
  return new Promise((resolve, reject) => {
    const state = getMusicState(guildId);

    // Hentikan player/stream lama jika masih ada, agar tidak dobel.
    stopMusic(guildId);

    let pcmStream;
    try {
      pcmStream = createPcmStream(streamUrl);
    } catch (err) {
      return reject(new Error(`Gagal membuat stream audio: ${err.message}`));
    }

    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });

    const resource = createAudioResource(pcmStream, {
      inputType: StreamType.Raw,
    });

    state.player = player;
    state.ffmpegProcess = pcmStream;
    state.isPlaying = false;

    let settled = false;

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Timeout: stream musik tidak merespons dalam 15 detik.'));
      }
    }, 15_000);

    player.on(AudioPlayerStatus.Playing, () => {
      state.isPlaying = true;
      console.log(`[MUSIC] Mulai memutar musik di guild ${guildId}: ${streamUrl}`);
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        resolve();
      }
    });

    player.on(AudioPlayerStatus.Idle, () => {
      state.isPlaying = false;
      console.log(`[MUSIC] Playback selesai/idle di guild ${guildId}`);
    });

    player.on('error', (error) => {
      console.error(`[ERROR] Audio player error di guild ${guildId}:`, error.message);
      state.isPlaying = false;
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        reject(error);
      }
    });

    pcmStream.on('error', (error) => {
      console.error(`[ERROR] Stream error di guild ${guildId}:`, error.message);
      state.isPlaying = false;
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        reject(error);
      }
    });

    connection.subscribe(player);
    player.play(resource);
  });
}

/**
 * Menghentikan musik dan membersihkan resource (player + proses ffmpeg).
 * Tidak memutuskan voice connection - itu tanggung jawab voiceManager.
 */
function stopMusic(guildId) {
  const state = getMusicState(guildId);

  if (state.player) {
    state.player.stop(true);
    state.player.removeAllListeners();
    state.player = null;
  }

  if (state.ffmpegProcess) {
    try {
      state.ffmpegProcess.destroy();
    } catch (err) {
      // aman untuk diabaikan jika proses sudah berhenti
    }
    state.ffmpegProcess = null;
  }

  state.isPlaying = false;
}

module.exports = {
  playMusic,
  stopMusic,
  isPlaying,
  getDefaultStreamUrl,
};
