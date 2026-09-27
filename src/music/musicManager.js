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
const play = require('play-dl');

const MAX_QUEUE_ADD = 25; // batas jumlah lagu yang diambil sekaligus dari satu playlist

// state per guild:
// { player, ffmpegProcess, httpRequest, currentResourceStream, isPlaying, mode: 'default'|'queue'|null, queue: [] }
const musicStates = new Map();

function getMusicState(guildId) {
  if (!musicStates.has(guildId)) {
    musicStates.set(guildId, {
      player: null,
      ffmpegProcess: null,
      httpRequest: null,
      currentResourceStream: null,
      isPlaying: false,
      mode: null,
      queue: [],
    });
  }
  return musicStates.get(guildId);
}

function isPlaying(guildId) {
  return getMusicState(guildId).isPlaying;
}

function getQueueLength(guildId) {
  return getMusicState(guildId).queue.length;
}

function getDefaultStreamUrl() {
  // Default: SomaFM Groove Salad - radio internet legal & gratis, cocok untuk lofi/chill.
  return process.env.LOFI_STREAM_URL || 'https://ice1.somafm.com/groovesalad-128-mp3';
}

/* -------------------------------------------------------------------------- */
/* Pembersihan resource player yang sedang aktif                              */
/* -------------------------------------------------------------------------- */

function stopCurrentPlayer(guildId) {
  const state = getMusicState(guildId);

  if (state.player) {
    state.player.removeAllListeners();
    state.player.stop(true);
    state.player = null;
  }

  if (state.ffmpegProcess) {
    try {
      state.ffmpegProcess.destroy();
    } catch (err) {
      // aman diabaikan
    }
    state.ffmpegProcess = null;
  }

  if (state.httpRequest) {
    try {
      state.httpRequest.destroy();
    } catch (err) {
      // aman diabaikan
    }
    state.httpRequest = null;
  }

  if (state.currentResourceStream && typeof state.currentResourceStream.destroy === 'function') {
    try {
      state.currentResourceStream.destroy();
    } catch (err) {
      // aman diabaikan
    }
  }
  state.currentResourceStream = null;

  state.isPlaying = false;
}

/**
 * Menghentikan musik sepenuhnya (player + antrian). Tidak memutuskan voice
 * connection - itu tanggung jawab voiceManager.
 */
function stopMusic(guildId) {
  stopCurrentPlayer(guildId);
  const state = getMusicState(guildId);
  state.queue = [];
  state.mode = null;
}

/* -------------------------------------------------------------------------- */
/* Mode "default": radio Lofi Chill lewat ffmpeg (fallback saat /play_music   */
/* dijalankan tanpa link)                                                     */
/* -------------------------------------------------------------------------- */

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

async function playDefaultLofi(guildId, connection, streamUrl = getDefaultStreamUrl()) {
  stopMusic(guildId); // hentikan apa pun yang sedang jalan + kosongkan antrian

  const state = getMusicState(guildId);
  state.mode = 'default';

  const { response: httpResponse, request: httpRequest } = await fetchHttpStream(streamUrl).catch((err) => {
    throw new Error(`Gagal mengambil stream: ${err.message}`);
  });

  return new Promise((resolve, reject) => {
    const transcoder = createTranscoder();

    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });

    const resource = createAudioResource(transcoder, { inputType: StreamType.Raw });

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

    httpResponse.pipe(transcoder);
    connection.subscribe(player);
    player.play(resource);
  });
}

/* -------------------------------------------------------------------------- */
/* Mode "queue": YouTube (video/playlist/pencarian) & Spotify (lagu tunggal)  */
/* -------------------------------------------------------------------------- */

function getSpotifyTrackTitle(spotifyUrl) {
  return new Promise((resolve, reject) => {
    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`;
    https
      .get(oembedUrl, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.title) {
              resolve(json.title);
            } else {
              reject(new Error('Tidak bisa membaca judul lagu dari Spotify.'));
            }
          } catch (err) {
            reject(new Error('Gagal membaca info lagu Spotify.'));
          }
        });
      })
      .on('error', (err) => reject(err));
  });
}

async function searchYoutube(query) {
  const results = await play.search(query, { limit: 1, source: { youtube: 'video' } });
  if (!results || results.length === 0) {
    throw new Error(`Tidak ditemukan hasil YouTube untuk "${query}".`);
  }
  const video = results[0];
  return [{ type: 'youtube', url: video.url, title: video.title }];
}

/**
 * Mengubah input dari /play_music (link atau kata kunci) menjadi daftar item
 * yang bisa diputar (semuanya bermuara ke URL YouTube untuk diputar).
 */
async function resolveInputToItems(link) {
  const trimmed = link.trim();
  const kind = await play.validate(trimmed);

  if (!kind || kind === 'search') {
    return searchYoutube(trimmed);
  }

  switch (kind) {
    case 'yt_video': {
      let title = trimmed;
      try {
        const info = await play.video_basic_info(trimmed);
        title = info.video_details.title;
      } catch (err) {
        // kalau gagal ambil judul, tetap lanjut pakai URL sebagai label
      }
      return [{ type: 'youtube', url: trimmed, title }];
    }

    case 'yt_playlist': {
      const pl = await play.playlist_info(trimmed, { incomplete: true });
      const videos = pl.videos.slice(0, MAX_QUEUE_ADD);
      if (videos.length === 0) {
        throw new Error('Playlist YouTube ini kosong atau tidak bisa diakses.');
      }
      return videos.map((v) => ({ type: 'youtube', url: v.url, title: v.title }));
    }

    case 'sp_track': {
      const title = await getSpotifyTrackTitle(trimmed);
      return searchYoutube(title);
    }

    case 'sp_playlist':
    case 'sp_album':
      throw new Error(
        'Playlist/album Spotify belum didukung. Coba paste link lagu Spotify satu per satu, atau gunakan link/playlist YouTube.'
      );

    default:
      throw new Error(`Jenis link ini belum didukung (${kind}).`);
  }
}

async function playNextInQueue(guildId, connection) {
  const state = getMusicState(guildId);
  stopCurrentPlayer(guildId);

  const item = state.queue.shift();
  if (!item) {
    state.isPlaying = false;
    state.mode = null;
    return;
  }

  let streamInfo;
  try {
    streamInfo = await play.stream(item.url);
  } catch (err) {
    console.error(`[ERROR] Gagal stream "${item.title || item.url}" di guild ${guildId}:`, err.message);
    return playNextInQueue(guildId, connection); // coba lagu berikutnya di antrian
  }

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play },
  });

  const resource = createAudioResource(streamInfo.stream, { inputType: streamInfo.type });

  state.player = player;
  state.currentResourceStream = streamInfo.stream;
  state.mode = 'queue';
  state.isPlaying = false;

  player.on(AudioPlayerStatus.Playing, () => {
    state.isPlaying = true;
    console.log(`[MUSIC] Memutar "${item.title || item.url}" di guild ${guildId}`);
  });

  player.on(AudioPlayerStatus.Idle, () => {
    state.isPlaying = false;
    console.log(`[MUSIC] Track selesai di guild ${guildId}, lanjut ke antrian berikutnya...`);
    playNextInQueue(guildId, connection).catch((err) => {
      console.error(`[ERROR] Gagal memutar track berikutnya di guild ${guildId}:`, err.message);
    });
  });

  player.on('error', (error) => {
    console.error(`[ERROR] Audio player error (queue) di guild ${guildId}:`, error.message);
    state.isPlaying = false;
    playNextInQueue(guildId, connection).catch(() => {});
  });

  connection.subscribe(player);
  player.play(resource);
}

/**
 * Menyelesaikan link/kata kunci dari /play_music, memasukkannya ke antrian,
 * dan langsung memutar jika sedang tidak ada yang diputar.
 */
async function resolveAndQueue(guildId, connection, link) {
  const items = await resolveInputToItems(link);
  const state = getMusicState(guildId);

  if (state.mode === 'default' && state.isPlaying) {
    stopCurrentPlayer(guildId);
  }

  const startedEmpty = state.queue.length === 0 && !state.isPlaying;
  state.queue.push(...items);
  state.mode = 'queue';

  if (startedEmpty) {
    await playNextInQueue(guildId, connection);
    return { started: true, addedCount: items.length, firstTitle: items[0].title || items[0].url };
  }

  return { started: false, addedCount: items.length, firstTitle: items[0].title || items[0].url };
}

module.exports = {
  playDefaultLofi,
  resolveAndQueue,
  stopMusic,
  isPlaying,
  getQueueLength,
  getDefaultStreamUrl,
};
