const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');

/**
 * State per guild.
 * active        : apakah bot "seharusnya" tetap terhubung (AFK dan/atau musik).
 * channelId     : channel terakhir yang dituju, dipakai untuk reconnect.
 * isAfk         : apakah bot sedang dalam mode AFK (dipicu oleh /afk).
 * reconnectAttempts / reconnectTimer : dipakai untuk exponential backoff.
 */
const guildStates = new Map();

function getState(guildId) {
  if (!guildStates.has(guildId)) {
    guildStates.set(guildId, {
      active: false,
      channelId: null,
      isAfk: false,
      reconnectAttempts: 0,
      reconnectTimer: null,
    });
  }
  return guildStates.get(guildId);
}

function isConnected(guildId) {
  return Boolean(getVoiceConnection(guildId));
}

function getConnection(guildId) {
  return getVoiceConnection(guildId);
}

/**
 * Bergabung ke voice channel. Jika sudah ada koneksi aktif di guild ini,
 * koneksi yang sudah ada langsung dikembalikan (tidak membuat koneksi kedua).
 */
function joinChannel(channel, client) {
  const guildId = channel.guild.id;
  const existing = getVoiceConnection(guildId);
  if (existing) {
    return existing;
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfMute: true,
    selfDeaf: true,
  });

  const state = getState(guildId);
  state.active = true;
  state.channelId = channel.id;
  state.reconnectAttempts = 0;

  attachConnectionHandlers(connection, guildId, client);

  console.log(`[VOICE] Bergabung ke voice channel "${channel.name}" (guild: ${guildId})`);

  return connection;
}

function attachConnectionHandlers(connection, guildId, client) {
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      // Discord kadang memicu Disconnected sesaat sebelum reconnect otomatis
      // (misal saat pindah region voice). Beri kesempatan koneksi pulih sendiri.
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch (err) {
      // Benar-benar terputus -> lakukan reconnect manual.
      handleDisconnect(guildId, client);
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    console.log(`[VOICE] Koneksi voice dihancurkan (guild: ${guildId})`);
  });

  connection.on('error', (error) => {
    console.error(`[ERROR] Voice connection error (guild: ${guildId}):`, error.message);
  });
}

function handleDisconnect(guildId, client) {
  const state = getState(guildId);

  console.log(`[RECONNECT] Voice connection terputus di guild ${guildId}.`);

  const oldConnection = getVoiceConnection(guildId);
  if (oldConnection) {
    try {
      oldConnection.destroy();
    } catch (err) {
      // koneksi mungkin sudah destroyed, aman untuk diabaikan
    }
  }

  if (!state.active) {
    console.log(`[VOICE] Bot tidak dalam mode aktif di guild ${guildId}, tidak melakukan reconnect.`);
    return;
  }

  scheduleReconnect(guildId, client);
}

function scheduleReconnect(guildId, client) {
  const state = getState(guildId);

  if (state.reconnectTimer) {
    return; // reconnect sudah dijadwalkan, jangan duplikasi
  }

  const maxAttempts = 5;
  if (state.reconnectAttempts >= maxAttempts) {
    console.error(`[ERROR] Reconnect gagal setelah ${maxAttempts} percobaan di guild ${guildId}. Berhenti mencoba.`);
    state.active = false;
    return;
  }

  state.reconnectAttempts += 1;
  // Exponential backoff: 5s, 10s, 20s, 40s, dibatasi maksimal 60 detik
  const delay = Math.min(5_000 * 2 ** (state.reconnectAttempts - 1), 60_000);

  console.log(
    `[RECONNECT] Mencoba reconnect dalam ${delay / 1000} detik (percobaan ${state.reconnectAttempts}/${maxAttempts}, guild: ${guildId})...`
  );

  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null;
    try {
      const guild = await client.guilds.fetch(guildId);
      const channel = state.channelId
        ? await guild.channels.fetch(state.channelId).catch(() => null)
        : null;

      if (!channel) {
        console.error(`[ERROR] Channel voice tidak ditemukan lagi di guild ${guildId}. Membatalkan reconnect.`);
        state.active = false;
        return;
      }

      joinChannel(channel, client);
      state.reconnectAttempts = 0;
      console.log(`[RECONNECT] Berhasil reconnect ke "${channel.name}" (guild: ${guildId}).`);
    } catch (err) {
      console.error(`[ERROR] Reconnect gagal di guild ${guildId}:`, err.message);
      scheduleReconnect(guildId, client);
    }
  }, delay);
}

/**
 * Keluar dari voice channel dan bersihkan seluruh state (termasuk timer reconnect).
 * Mengembalikan true jika sebelumnya memang sedang terhubung.
 */
function leaveChannel(guildId) {
  const state = getState(guildId);
  state.active = false;
  state.isAfk = false;
  state.channelId = null;
  state.reconnectAttempts = 0;

  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  const connection = getVoiceConnection(guildId);
  if (connection) {
    connection.destroy();
    console.log(`[VOICE] Keluar dari voice channel (guild: ${guildId})`);
    return true;
  }
  return false;
}

function setAfkMode(guildId, isAfk) {
  getState(guildId).isAfk = isAfk;
}

function isAfkMode(guildId) {
  return getState(guildId).isAfk;
}

module.exports = {
  joinChannel,
  leaveChannel,
  isConnected,
  getConnection,
  setAfkMode,
  isAfkMode,
  getState,
};
