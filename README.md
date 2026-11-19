# Local Discord Mate

A local AI voice companion for a Swiss German Discord group. "Bruno" joins a voice channel, listens, and chimes in with jokes and comments. Speech recognition, the language model and the voice all run on your own PC; nothing goes to a cloud AI service.

## How it works

```
Discord voice ──► Whisper (speech → text) ──► Ollama LLM (decides whether/what to say) ──► Piper (text → speech) ──► Discord voice
```

- **Discord:** Node 22.12+, discord.js and @discordjs/voice (with DAVE encryption).
- **Language model:** Ollama with `gemma4:12b` (`OLLAMA_MODEL`).
- **Transcription:** faster-whisper `small` on the CPU (int8, 6 threads) with a German language hint (`WHISPER_MODEL`, `WHISPER_LANGUAGE`). `medium` or `large-v3-turbo` are more accurate but slower.
- **Voice:** Piper `de_DE-thorsten-medium`. Standard German voice, not real Swiss dialect, so replies use Standard German with Swiss vocabulary.

## Requirements

- Windows with PowerShell (the launcher script is PowerShell; the bot itself is plain Node + Python).
- [Node.js](https://nodejs.org) 22.12 or newer.
- [uv](https://docs.astral.sh/uv/) (installs Python 3.12 and the speech dependencies).
- [Ollama](https://ollama.com) with the model pulled: `ollama pull gemma4:12b`.
- A GPU that fits the model is strongly recommended (a 12B model is slow on CPU). Whisper runs on the CPU, so a decent multi-core CPU helps too.

## Setup (PowerShell)

```powershell
git clone <this repo>
cd local-discord-mate
npm ci
uv sync --frozen --python 3.12
New-Item -ItemType Directory -Force models
.venv\Scripts\python -m piper.download_voices de_DE-thorsten-medium --download-dir models
Copy-Item .env.example .env
```

### Create your Discord bot

Every person who runs this needs **their own** bot application. Never share or commit a bot token (see [Running more than one bot](#running-more-than-one-bot)).

1. Go to https://discord.com/developers/applications → **New Application** and give it a name.
2. **Bot** tab → **Reset Token** → copy the token into `DISCORD_TOKEN=` in your `.env`. No privileged intents are needed.
3. **Installation** tab → Guild Install scopes `bot` and `applications.commands`, permissions **View Channels**, **Connect**, **Speak**. Open the install link and add the bot to your server.
4. Optionally set `BOT_NAME` in `.env` to what people will call it (default `Bruno`). The bot reacts more readily when this name is said.

Never use a personal account token.

### Start

Start Ollama, then:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start.ps1
```

This starts the speech service (port 8765, localhost only) and then the bot. The first launch downloads the Whisper model; if that exceeds the startup timeout, run `.venv\Scripts\python speech/server.py` once to finish the download. The launcher reuses an already running speech service and only stops one it started itself.

If the speech service is already running you can start just the bot with `npm start`.

## Using it

Join a regular voice channel in your server and type:

| Command | Effect |
|---|---|
| `/join` | Bot joins your voice channel and starts listening. |
| `/quiet` | Toggle listen-only mode (stops current speech too). |
| `/leave` | Disconnect and forget the conversation. |

Set `AUTO_JOIN_CHANNEL_ID` in `.env` (right-click the voice channel → Copy Channel ID, with Developer Mode on) to join automatically on startup. The bot leaves when no humans remain in the channel. **Tell everyone in the channel that it is listening.**

## Conversation log

Everything heard and said is written to `logs/conversation-YYYY-MM-DD.txt` (and echoed to the console):

```
[01:20:43] heard     Toemmsen: Was? Wie geht's dir?
[01:20:48] SAID      Bruno: Mir geht's hervorragend ...  (unsolicited, 1 newer turns since)
[01:21:02] dropped   Bruno: ...   (written but not said: /quiet, left, or took too long)
[01:22:30] expired   Bruno: ...   (no pause came within PREPARED_MAX_AGE_MS)
```

This stores other people's speech as text on disk. Set `LOG_TRANSCRIPTS=false` to log only the bot's own lines. `CONVERSATION_LOG_DIR` changes the folder. `logs/` is git-ignored.

## Behaviour

- **Listening:** each speaker's audio is transcribed after `END_SILENCE_MS` (450 ms) of silence. Clips are capped at 20 seconds and at most three transcriptions run at once; overload can drop audio. This is turn-based, not streaming speech-to-speech.
- **Deciding:** the LLM sees the last 16 turns and decides itself whether to speak (`speak`, `score`, `text`). Its own lines are marked as its own and the turns it hasn't reacted to yet are marked new; older own lines are passed along so it can avoid repeating itself. Lines that mention `BOT_NAME` use a lower threshold.
- **Timing:** a comment is prepared as soon as new speech is transcribed, even while others keep talking, and played at the next pause (`QUIET_GAP_MS`, or `DIRECT_REPLY_GAP_MS` when addressed). Newer speech does not throw it away; one comment is held at a time (a direct reply can replace it) and expires after `PREPARED_MAX_AGE_MS` (default 90 s).
- **Turn-taking:** after speaking, the bot waits until someone says something new before preparing another line, so it doesn't answer the same thing twice or talk to itself. Exception: an unanswered line that says its name.
- **Playback:** once a reply starts it finishes; audio captured during playback is ignored to avoid feedback (headphones help). Use `/quiet` or `/leave` to cut it off.
- **Memory:** the conversation lives only in RAM. Restarting or `/leave` forgets it (the log files remain).

### The prompt

The personality and rules are in `src/brain.js`: a base prompt (who Bruno is, output format, 240-character limit), optional chatty and unhinged add-ons, the `VARIETY` rules (own lines, new turns, mishearings are fair game), and a hint when addressed by name. Edit there and restart.

## Configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `DISCORD_TOKEN` | – | Your bot token (required). |
| `BOT_NAME` | `Bruno` | Name the bot answers to and uses for itself. |
| `OLLAMA_URL` / `OLLAMA_MODEL` | `http://127.0.0.1:11434` / `gemma4:12b` | Language model. |
| `SPEECH_URL` | `http://127.0.0.1:8765` | Local speech service. Don't expose it to the network. |
| `WHISPER_MODEL` / `WHISPER_LANGUAGE` | `small` / `de` | Transcription model and language. |
| `PIPER_MODEL` | `models/de_DE-thorsten-medium.onnx` | Voice. |
| `REPLY_COOLDOWN_MS` | `45000` | Minimum time between contributions. |
| `QUIET_GAP_MS` / `DIRECT_REPLY_GAP_MS` | `1100` / `650` | Pause needed before speaking (unsolicited / addressed). |
| `END_SILENCE_MS` | `450` | Silence that ends a speaker's clip. |
| `MIN_RELEVANCE` | `0.70` | Minimum model confidence to speak. |
| `CHATTY_MODE` | `false` | Encourage casual comments instead of only strong jokes. |
| `UNHINGED_MODE` | `false` | Chaotic, sweary, roast-heavy comedy personality. |
| `PREPARED_MAX_AGE_MS` | `90000` | How long a prepared comment may wait for a pause. |
| `LOG_TRANSCRIPTS` | `true` | Also log what other people say. |
| `CONVERSATION_LOG_DIR` | `logs` | Log folder. |
| `AUTO_JOIN_CHANNEL_ID` | – | Voice channel to join on startup. |
| `VOICE_DEBUG` | – | `1` prints decision metrics and voice state. |

Restart after edits. Speech settings are read by `scripts/start.ps1` when it starts the speech service.

**Presets**

- Normal: `CHATTY_MODE=false`, `UNHINGED_MODE=false`, `MIN_RELEVANCE=0.70`, `REPLY_COOLDOWN_MS=45000`.
- Talkative: `CHATTY_MODE=true`, `MIN_RELEVANCE=0.05`, `REPLY_COOLDOWN_MS=3000`.
- Maximum chaos: `CHATTY_MODE=true`, `UNHINGED_MODE=true`, `MIN_RELEVANCE=0`, `REPLY_COOLDOWN_MS=0`.

## Running more than one bot

- A Discord bot account can be in **one voice channel per server**. To have bots in two channels of the same server, use **two bot applications** (two tokens), e.g. one on your PC and one on a friend's, each with its own `.env` and `BOT_NAME`. Both register `/join`; Discord shows the bot name next to each command so you pick which one to call.
- Bots ignore audio from other bots, so two bots in the same channel won't reply to each other.
- Don't run two copies with the **same** token: they fight over the same voice connection and both answer commands.
- This code keeps a single session, so one running bot is in one channel at a time, even across servers. Each active channel needs its own transcription and LLM work, so the PC is the real limit.
- Keep tokens out of git. `.env` is git-ignored; share only `.env.example`. A token pushed to a public repo is detected and reset by Discord automatically.

## When the bot is offline

If the process stops (closed window, crash, PC asleep or off), the bot shows as offline and drops out of voice within seconds. Its `/join` command still appears but answers "The application did not respond". Conversation memory is lost; logs remain. On the next start it logs in again and rejoins voice only if `AUTO_JOIN_CHANNEL_ID` is set. Short network drops reconnect automatically, but a voice connection that stays down for more than 5 seconds makes it leave the channel without rejoining.

## Verification

With the speech service and Ollama running:

```powershell
npm test
npm run doctor
.venv\Scripts\python scripts/smoke.py
```

The smoke test synthesizes German audio in memory, converts it to Discord PCM, transcribes it and checks silence handling. It doesn't validate dialect accuracy or live Discord receive; those need a real channel trial. Discord voice receive is not an officially documented API and can change.

## Licences and references

Piper is GPL-3.0; check its and the voice model's licences before redistributing. Dependency versions are locked in `package-lock.json` and `uv.lock`.

[Discord voice library](https://discord.js.org/docs/packages/voice/main) · [faster-whisper](https://github.com/SYSTRAN/faster-whisper) · [Piper Python API](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_PYTHON.md) · [Ollama](https://ollama.com)
