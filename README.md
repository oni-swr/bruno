# Local Discord Mate

A local AI voice companion for a Swiss German Discord group. "Bruno" joins a voice channel, listens, and chimes in with chaotic, sweary, dry Swiss jokes and roasts. Speech recognition, the language model and the voice all run on your own PC; nothing goes to a cloud AI service.

## How it works

```
Discord voice ──► Whisper (speech → text) ──► Ollama LLM (decides whether/what to say) ──► Piper (text → speech) ──► Discord voice
```

- **Discord:** Node 22.12+, discord.js and @discordjs/voice (with DAVE encryption).
- **Language model:** Ollama with `gemma4:12b` (`OLLAMA_MODEL`). For pure chaos, try [Alpesteibock](https://huggingface.co/kaizuberbuehler/Alpesteibock-Llama-3-8B-Alpha) (`hf.co/mradermacher/Alpesteibock-Llama-3-8B-Alpha-GGUF:Q6_K`), an experimental Swiss German Llama 3 8B fine-tune: real Swiss German, very funny, mostly incoherent.
- **Transcription:** either faster-whisper `small` on the CPU (int8, up to 6 threads, `WHISPER_THREADS`) with a German language hint (`WHISPER_MODEL`, `WHISPER_LANGUAGE`). `medium` or `large-v3-turbo` are more accurate but slower.
  Or, recommended for Swiss German, [Flurin17/parakeet-tdt-0.6b-v3-swiss-german](https://huggingface.co/Flurin17/parakeet-tdt-0.6b-v3-swiss-german) (`STT_ENGINE=parakeet`): Swiss German speech in, Standard German text out, ~0.2 s per clip on the CPU, with Silero voice detection so noise is ignored. Licence CC BY-NC 4.0 (non-commercial). See [Swiss German transcription (Parakeet)](#swiss-german-transcription-parakeet).
- **Voice:** Piper `de_DE-thorsten-medium`. Standard German voice, not real Swiss dialect, so replies use Standard German with Swiss vocabulary.

## Requirements

- Windows with PowerShell, or 64-bit Linux on x86-64 or ARM (aarch64, e.g. Raspberry Pi 5 with 64-bit Raspberry Pi OS). See [Linux and ARM](#linux-and-arm).
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

### Linux and ARM

Works on 64-bit Linux, including ARM64 (aarch64) with glibc 2.28+ (Debian 11+, Ubuntu 20.04+, Raspberry Pi OS Bookworm 64-bit). 32-bit ARM (armv7) is not supported: the speech libraries have no wheels for it.

```bash
sudo apt install -y curl ffmpeg build-essential python3   # ffmpeg is only used by the smoke test
curl -LsSf https://astral.sh/uv/install.sh | sh
# Node 22.12+ from nodejs.org, nvm or NodeSource (distro packages are often too old)
git clone <this repo> && cd local-discord-mate
npm ci
uv sync --frozen --python 3.12
mkdir -p models
.venv/bin/python -m piper.download_voices de_DE-thorsten-medium --download-dir models
cp .env.example .env
```

Then start Ollama and run `bash scripts/start.sh`. It does the same as `start.ps1`; the speech service's output goes to `logs/speech.log`.

- **Opus:** `@discordjs/opus` is optional. It ships prebuilt ARM64 binaries only for Node 22 on some glibc versions; otherwise npm compiles it (that's what `build-essential` and `python3` are for). If that fails too, the install still succeeds and voice falls back to the slower pure-JS `opusscript`. `npm run doctor` shows which one is in use.
- **Speed:** a Raspberry Pi has no GPU that Ollama can use, so an 8–12B model takes many seconds per reply. Run Ollama on another machine and point `OLLAMA_URL` at it, or use a much smaller model. Whisper `base` (`WHISPER_MODEL=base`) keeps transcription quick on 4 cores.
- **Install Ollama:** `curl -fsSL https://ollama.com/install.sh | sh` (supports ARM64).

## Using it

Join a regular voice channel in your server and type:

| Command | Effect |
|---|---|
| `/join` | Bot joins your voice channel and starts listening. |
| `/quiet` | Toggle listen-only mode (stops current speech too). |
| `/leave` | Disconnect and forget the conversation. |

Set `AUTO_JOIN_CHANNEL_ID` in `.env` (right-click the voice channel → Copy Channel ID, with Developer Mode on) to join automatically: on startup if someone is in the channel, otherwise as soon as the first person enters. The bot leaves when no humans remain and comes back when someone returns. `/leave` stops this until the next `/join`. **Tell everyone in the channel that it is listening.**

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

Bruno's personality is the `personality` prompt in `src/brain.js`: a chaotic goblin friend with a dry Swiss sense of humor, absurd comparisons, playful roasts and swearing, reacting to almost every turn in up to two punchy sentences (240 characters). A short extra hint is added when someone addresses him by name. Edit there and restart.

## Configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `DISCORD_TOKEN` | – | Your bot token (required). |
| `BOT_NAME` | `Bruno` | Name the bot answers to and uses for itself. |
| `OLLAMA_URL` / `OLLAMA_MODEL` | `http://127.0.0.1:11434` / `gemma4:12b` | Language model. |
| `MAX_REPLY_TOKENS` / `MAX_REPLY_CHARS` | `180` / `240` | Reply length limits. Longer or cut-off output ends at the last full sentence. Raise both (and edit the prompt) to let him ramble. |
| `SPEECH_URL` | `http://127.0.0.1:8765` | Local speech service. Don't expose it to the network. |
| `STT_ENGINE` | `whisper` | `whisper` or `parakeet` (Swiss German, see below). |
| `WHISPER_MODEL` / `WHISPER_LANGUAGE` | `small` / `de` | Whisper model and language. |
| `PARAKEET_DIR` / `PARAKEET_QUANTIZATION` | `models/parakeet-sg` / `int8` | Exported Parakeet model folder and variant (`int8` or empty for full precision). |
| `WHISPER_THREADS` | CPU cores, max 6 | CPU threads for transcription. |
| `PIPER_MODEL` | `models/de_DE-thorsten-medium.onnx` | Voice. |
| `REPLY_COOLDOWN_MS` | `0` | Minimum time between contributions. |
| `QUIET_GAP_MS` / `DIRECT_REPLY_GAP_MS` | `1100` / `650` | Pause needed before speaking (unsolicited / addressed). |
| `END_SILENCE_MS` | `450` | Silence that ends a speaker's clip. |
| `MIN_RELEVANCE` | `0` | Minimum model score to speak (raise, e.g. `0.7`, to make him pickier). |
| `PREPARED_MAX_AGE_MS` | `90000` | How long a prepared comment may wait for a pause. |
| `LOG_TRANSCRIPTS` | `true` | Also log what other people say. |
| `CONVERSATION_LOG_DIR` | `logs` | Log folder. |
| `AUTO_JOIN_CHANNEL_ID` | – | Voice channel to join on startup or when someone enters it. |
| `VOICE_DEBUG` | – | `1` prints decision metrics and voice state. |

Restart after edits. Speech settings are read by `scripts/start.ps1` / `scripts/start.sh` when it starts the speech service.

To calm him down, raise `REPLY_COOLDOWN_MS` (e.g. `30000`) and `MIN_RELEVANCE` (e.g. `0.7`).

## Swiss German transcription (Parakeet)

[Flurin17/parakeet-tdt-0.6b-v3-swiss-german](https://huggingface.co/Flurin17/parakeet-tdt-0.6b-v3-swiss-german) is a Parakeet model fine-tuned on Swiss German. It writes Standard German, which suits the bot (22% WER on Swiss German dialect tests, vs 36% for the base model). It is published only as a NeMo checkpoint, so it is exported to ONNX once and then runs through `onnx-asr`, with no NeMo or GPU needed at runtime. NeMo goes into a separate throwaway environment so the bot's environment stays small.

```powershell
New-Item -ItemType Directory -Force models/parakeet-sg
$base = 'https://huggingface.co'
curl.exe -L -C - -o models/parakeet-sg/parakeet-tdt-0.6b-v3-swiss-german.nemo "$base/Flurin17/parakeet-tdt-0.6b-v3-swiss-german/resolve/main/parakeet-tdt-0.6b-v3-swiss-german.nemo"   # 2.5 GB
curl.exe -L -o models/parakeet-sg/config.json  "$base/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/config.json"
curl.exe -L -o models/parakeet-sg/nemo128.onnx "$base/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/nemo128.onnx"

uv venv .venv-export --python 3.12
uv pip install --python .venv-export/Scripts/python.exe torch --index-url https://download.pytorch.org/whl/cpu
uv pip install --python .venv-export/Scripts/python.exe "nemo_toolkit[asr]==2.7.3" onnx onnxruntime
.venv-export\Scripts\python scripts/export_parakeet.py models/parakeet-sg/parakeet-tdt-0.6b-v3-swiss-german.nemo models/parakeet-sg
```

Then set `STT_ENGINE=parakeet` in `.env` and restart. Afterwards `.venv-export` and the `.nemo` file can be deleted. The Silero voice-detection model downloads automatically on first start.

## Running more than one bot

- A Discord bot account can be in **one voice channel per server**. To have bots in two channels of the same server, use **two bot applications** (two tokens), e.g. one on your PC and one on a friend's, each with its own `.env` and `BOT_NAME`. Both register `/join`; Discord shows the bot name next to each command so you pick which one to call.
- Bots ignore audio from other bots, so two bots in the same channel won't reply to each other.
- Don't run two copies with the **same** token: they fight over the same voice connection and both answer commands.
- This code keeps a single session, so one running bot is in one channel at a time, even across servers. Each active channel needs its own transcription and LLM work, so the PC is the real limit.
- Keep tokens out of git. `.env` is git-ignored; share only `.env.example`. A token pushed to a public repo is detected and reset by Discord automatically.

## When the bot is offline

If the process stops (closed window, crash, PC asleep or off), the bot shows as offline and drops out of voice within seconds. Its `/join` command still appears but answers "The application did not respond". Conversation memory is lost; logs remain. On the next start it logs in again and rejoins voice only if `AUTO_JOIN_CHANNEL_ID` is set (immediately if someone is there, otherwise when someone enters). Short network drops reconnect automatically, but a voice connection that stays down for more than 5 seconds makes it leave the channel without rejoining.

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
