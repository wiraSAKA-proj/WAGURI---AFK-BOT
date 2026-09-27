# WAGURI - AFK BOT

Discord Bot AFK Voice + Music (Lofi Chill) menggunakan **Node.js + discord.js v14** dan
**Discord Bot Account resmi** (bukan self-bot/user token). Menggunakan Slash Commands (`/`).

## Fitur

- `/afk` — Bot bergabung ke Voice Channel kamu, self-mute + self-deafen, dan bertahan di sana.
- `/leave_afk` — Bot berhenti main musik (jika ada) lalu keluar dari Voice Channel.
- `/play_music` — Bot memutar musik Lofi Chill (auto-join jika belum di VC).
- Auto-reconnect dengan exponential backoff jika koneksi voice terputus.
- Logging sederhana: `[READY]`, `[VOICE]`, `[MUSIC]`, `[ERROR]`, `[RECONNECT]`.

---

## 1. Cara Membuat Discord Bot

1. Buka https://discord.com/developers/applications
2. Klik **New Application**, beri nama (misalnya `WAGURI`).
3. Masuk ke tab **Bot** di sidebar kiri.
4. Klik **Reset Token** / **Add Bot** untuk membuat bot, lalu klik **Reset Token** untuk
   mendapatkan token. **Simpan token ini baik-baik, jangan dibagikan ke siapapun.**
5. Pastikan **Privileged Gateway Intents** tidak perlu diaktifkan untuk bot ini (bot hanya
   memakai intent `Guilds` dan `GuildVoiceStates`, keduanya bukan privileged intent).

## 2. Cara Mendapatkan CLIENT_ID

1. Masih di halaman aplikasi yang sama, buka tab **General Information**.
2. Salin nilai **Application ID** — itulah `CLIENT_ID` kamu.

## 3. Cara Mendapatkan GUILD_ID

1. Di Discord, buka **User Settings > Advanced** dan aktifkan **Developer Mode**.
2. Klik kanan pada nama server (guild) yang ingin dipakai untuk testing.
3. Klik **Copy Server ID** — itulah `GUILD_ID` kamu.
4. `GUILD_ID` bersifat opsional: isi ini saat development (command muncul instan),
   kosongkan saat production jika bot dipakai di banyak server (command global).

## 4. Cara Mengundang Bot ke Server

1. Di halaman aplikasi, buka tab **OAuth2 > URL Generator**.
2. Di **Scopes**, centang: `bot` dan `applications.commands`.
3. Di **Bot Permissions**, centang minimal:
   - `View Channel`
   - `Connect`
   - `Speak`
4. Salin URL yang dihasilkan di bagian bawah, buka di browser, pilih server, lalu **Authorize**.

### Permission yang Diperlukan

| Permission     | Kegunaan                                   |
|----------------|---------------------------------------------|
| View Channel   | Agar bot bisa melihat & masuk voice channel |
| Connect        | Agar bot bisa bergabung ke voice channel    |
| Speak          | Agar bot bisa mengirim audio (musik)        |

## 5. Cara Membuat `.env`

Salin `.env.example` menjadi `.env`, lalu isi nilainya:

```bash
cp .env.example .env
```

Isi `.env`:

```
DISCORD_TOKEN=YOUR_BOT_TOKEN
CLIENT_ID=YOUR_CLIENT_ID
GUILD_ID=YOUR_SERVER_ID
```

> ⚠️ **Jangan pernah** commit file `.env` ke Git atau membagikan token ke siapapun/AI.
> File `.env` sudah otomatis diabaikan lewat `.gitignore`.

## 6. Cara Install

```bash
npm install
```

## 7. Cara Register Slash Command

```bash
npm run deploy
```

- Jika `GUILD_ID` diisi → command didaftarkan sebagai **guild command** (muncul instan, cocok untuk development).
- Jika `GUILD_ID` kosong → command didaftarkan sebagai **global command** (bisa sampai ~1 jam untuk muncul di semua server).

## 8. Cara Menjalankan

```bash
npm start
```

## 9. Cara Menjalankan dengan Docker

```bash
docker build -t waguri-afk-bot .
docker run --env-file .env waguri-afk-bot
```

Image ini juga cocok dideploy langsung ke **Railway, Render, Koyeb, Oracle Cloud, atau VPS**
apa pun yang mendukung Docker/Node.js — cukup set environment variable yang sama di dashboard
platform tersebut (jangan pernah hardcode token di kode atau Dockerfile).

---

## Konfigurasi Musik (Lofi Chill)

Bot memakai environment variable `LOFI_STREAM_URL` sebagai sumber stream musik.
Jika tidak diisi, bot memakai default berikut:

```
LOFI_STREAM_URL=https://ice1.somafm.com/groovesalad-128-mp3
```

Default ini adalah **SomaFM Groove Salad**, stasiun radio internet gratis & legal bergenre
downtempo/chill yang cocok untuk suasana lofi. Kamu bebas mengganti `LOFI_STREAM_URL` ke
URL stream MP3/AAC legal lainnya (radio internet, stream musik berlisensi, dsb).

> Catatan: memutar radio internet di voice channel Discord umumnya sejalan dengan pemakaian
> personal/non-komersial. Jika bot dipakai untuk komunitas besar/komersial, pastikan kamu
> memeriksa dan mematuhi ketentuan layanan dari penyedia stream yang kamu pilih.

Bot **tidak** melakukan scraping YouTube atau metode ilegal lainnya — hanya memutar stream
audio langsung (HTTP/HTTPS) memakai `ffmpeg` (lewat paket `ffmpeg-static`, tidak perlu
instalasi ffmpeg terpisah di server) + `@discordjs/voice`.

---

## Perilaku AFK + Music

| Urutan                          | Hasil                                                          |
|----------------------------------|------------------------------------------------------------------|
| `/afk` → `/play_music`           | Bot tetap di VC dan memutar musik.                               |
| `/play_music` → `/leave_afk`     | Musik berhenti, bot keluar dari VC.                              |
| `/play_music` → musik selesai/error | Bot tetap di VC **jika** sebelumnya masuk lewat `/afk`.       |

---

## Struktur Project

```
waguri-afk-bot/
├── src/
│   ├── index.js
│   ├── deploy-commands.js
│   ├── commands/
│   │   ├── afk.js
│   │   ├── leave_afk.js
│   │   └── play_music.js
│   ├── voice/
│   │   └── voiceManager.js
│   └── music/
│       └── musicManager.js
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── Dockerfile
```

## Error Handling yang Ditangani

- Token bot tidak ada / tidak valid.
- Environment variable wajib (`DISCORD_TOKEN`, `CLIENT_ID` saat deploy) tidak diisi.
- User menjalankan command tanpa berada di Voice Channel.
- Bot tidak punya permission `Connect`/`Speak`.
- Channel voice tidak ditemukan lagi (misal dihapus) saat reconnect.
- Voice connection terputus → auto-reconnect dengan exponential backoff (maks. 5 percobaan, delay 5s–60s).
- Error pada audio player / stream musik (stream mati, URL tidak valid, timeout).
- Error umum dari Discord API saat menjalankan slash command (ditangkap dan direspons ke user).

## Keamanan

- Token **tidak** pernah di-hardcode — selalu dibaca dari `process.env.DISCORD_TOKEN`.
- Token **tidak** pernah dicetak ke console/log.
- Bot memakai **Discord Bot Account resmi**, bukan self-bot/user token.
- `.env` sudah masuk `.gitignore` agar tidak ter-commit ke repository.
