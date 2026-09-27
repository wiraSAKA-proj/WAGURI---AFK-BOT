const https = require('https');
const http = require('http');
const {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const prism = require('prism-media');
const ffmpegPath = require('ffmpeg-static');

// state per guild: { player, ffmpegProcess, httpRequest, isPlaying }
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
      httpRequest: null,
      isPlaying: false,
    });
  }
  return musicStates.get(guildId);
}

function isPlaying(guildId) {
  return getMusicState(guildId).isPlaying;
}

/**
 * Mengambil stream HTTP/HTTPS memakai modul bawaan Node (bukan ffmpeg), agar tidak
 * bergantung pada dukungan protokol https di binary ffmpeg-static (yang sering tidak
 * disertakan). Mengikuti redirect (umum terjadi pada URL radio internet).
 */
function fetchHttpStream(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const lib = url.startsWith('https') ? https : http;

    const request = lib.get(url, { headers: { 'User-Agent': 'WAGURI-AFK-BOT' } }, (res) => {
      const status = res.statusCode || 0;

      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        settled = true;
        resolve(fetchHttpStream(res.headers.location, redirectsLeft - 1));
        return;
      }

      if (status !== 200) {
        settled = true;
        res.resume();
        reject(new Error(`Stream merespons HTTP ${status}`));
        return;
      }

      settled = true;
      resolve({ response: res, request });
    });

    request.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    request.setTimeout(10_000, () => {
      if (!settled) {
        settled = true;
        request.destroy(new Error('Timeout saat menghubungi server stream.'));
      }
    });
  });
}

/**
 * Membuat transcoder ffmpeg yang membaca PCM dari stdin (bukan langsung dari URL),
 * lalu mengeluarkan PCM s16le 48kHz stereo yang siap dipakai @discordjs/voice.
 */
function createTranscoder() {
  const transcoder = new prism.FFmpeg({
    command: ffmpegPath,
    args: [
      '-analyzeduration', '0',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
    ],
  });

  transcoder.process.stderr?.on('data', (chunk) => {
    const message = chunk.toString().trim();
    if (message) {
      console.error(`[ERROR] ffmpeg: ${message}`);
    }
  });

  return transcoder;
}

/**
 * Memutar musik lofi chill pada voice connection yang diberikan.
 * Resolve saat player berhasil mulai playing, reject jika gagal/error.
 */
async function playMusic(guildId, connection, streamUrl = getDefaultStreamUrl()) {
  const state = getMusicState(guildId);

  // Hentikan player/stream lama jika masih ada, agar tidak dobel.
  stopMusic(guildId);

  let httpResult;
  try {
    httpResult = await fetchHttpStream(streamUrl);
  } catch (err) {
    throw new Error(`Gagal mengambil stream: ${err.message}`);
  }

  const { response: httpResponse, request: httpRequest } = httpResult;

  return new Promise((resolve, reject) => {
    const transcoder = createTranscoder();

    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });

    const resource = createAudioResource(transcoder, {
      inputType: StreamType.Raw,
    });

    state.player = player;
    state.ffmpegProcess = transcoder;
    state.httpRequest = httpRequest;
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

    transcoder.on('error', (error) => {
      console.error(`[ERROR] ffmpeg transcoder error di guild ${guildId}:`, error.message);
      state.isPlaying = false;
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        reject(error);
      }
    });

    httpResponse.on('error', (error) => {
      console.error(`[ERROR] HTTP stream error di guild ${guildId}:`, error.message);
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        reject(error);
      }
    });

    // Alirkan data mentah (mp3/aac) dari HTTP response ke ffmpeg untuk di-transcode.
    httpResponse.pipe(transcoder);

    connection.subscribe(player);
    player.play(resource);
  });
}

/**
 * Menghentikan musik dan membersihkan resource (player, proses ffmpeg, request HTTP).
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

  if (state.httpRequest) {
    try {
      state.httpRequest.destroy();
    } catch (err) {
      // aman untuk diabaikan jika request sudah selesai
    }
    state.httpRequest = null;
  }

  state.isPlaying = false;
}

module.exports = {
  playMusic,
  stopMusic,
  isPlaying,
  getDefaultStreamUrl,
};
