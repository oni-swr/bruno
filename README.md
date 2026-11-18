# Local Discord Mate

A local voice companion for a Swiss German Discord group. Bruno listens and occasionally adds a short relevant joke. The Swiss German experience still needs a live dialect test.

## Stack

- Discord: Node 22.12+, discord.js and @discordjs/voice with DAVE encryption.
- LLM: local Ollama, `gemma4:12b`, already installed on this PC.
- Transcription: faster-whisper `small`, CPU int8, German language hint. Try `medium` or `large-v3-turbo` via `WHISPER_MODEL` for higher accuracy, at increased CPU latency and download size.
- TTS: Piper `de_DE-thorsten-medium`. Standard German voice, not authentic Swiss dialect. Replies use Standard German with Swiss vocabulary for pronunciation.

Inference uses loopback services. Model installation and Discord need internet. Audio and the last 16 conversation entries stay in RAM and are cleared on disconnect. Transcripts are not logged. Models remain on disk.

## Setup (PowerShell)

```powershell
npm ci
uv sync --frozen --python 3.12
New-Item -ItemType Directory -Force models
.venv\Scripts\python -m piper.download_voices de_DE-thorsten-medium --download-dir models
Copy-Item .env.example .env
```

Create a bot at https://discord.com/developers/applications. Guild Install scopes: `bot` and `applications.commands`. Permissions: View Channels, Connect, Speak. Invite it to your server. No privileged intents needed. Put its bot token in the ignored `.env` file. Never use a personal account token.

Start Ollama, then:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start.ps1
```

First speech launch downloads Whisper. If this exceeds the startup timeout, run `.venv\Scripts\python speech/server.py` once to complete the download. The launcher reuses an existing healthy speech worker on port 8765 and only shuts down a worker it started itself.

Join a regular server voice channel and use `/join`. Commands register in your server when the bot connects. `/quiet` pauses replies while still listening; `/leave` disconnects and clears context. People in the same channel can control the bot. Tell everyone it is listening. It leaves when no humans remain. Supports one channel at a time.

## Behavior and tuning

- Transcribes after 450 ms of per-speaker silence. The room quiet gap overlaps transcription: 650 ms for direct address, 1.1 seconds for unsolicited comments, measured from the last audio packet.
- Model must choose to speak with confidence >= 0.70; prompted to stay silent most of the time.
- Minimum 45 seconds between contributions, at most 240 characters each.
- Direct address by name uses a lower confidence threshold and a 1.5-second cooldown, so the unsolicited-joke filter does not suppress requested replies.
- Prepares a comment as soon as new transcription is available, even while others speak, then plays it in the next room gap. Newer transcripts do not discard it: one comment is held until the next gap (only a direct reply replaces it), then the next comment is prepared from the latest conversation. Held comments expire after `PREPARED_MAX_AGE_MS` (default 90 s).
- Once a short reply starts, it finishes despite coughs, laughter, or other speaking events. Use `/quiet` or `/leave` to stop it explicitly. New captures during playback are ignored to limit speaker feedback; headphones work best.
- Clips capped at 20 seconds and three pending transcriptions. Long speech or overload can drop audio. This is turn-based processing, not full streaming speech-to-speech.

Tune `REPLY_COOLDOWN_MS`, `QUIET_GAP_MS`, `DIRECT_REPLY_GAP_MS`, `END_SILENCE_MS`, `MIN_RELEVANCE`, `BOT_NAME`, and models in `.env`. Restart after edits. Speech settings are loaded by `scripts/start.ps1`. Do not expose the localhost speech service to the network. Playback uses 48 kHz stereo PCM directly, avoiding a new FFmpeg process for each reply. Playback logs report milliseconds since the last received audio packet, without recording transcript text.

For troubleshooting only, `VOICE_DEBUG=1` prints recognized speech and decision metrics to the console; it is off by default. `AUTO_JOIN_CHANNEL_ID` optionally rejoins a known voice channel at startup.

For a deliberately talkative trial, set `CHATTY_MODE=true`, `MIN_RELEVANCE=0.05`, and `REPLY_COOLDOWN_MS=3000`. This encourages casual comments after new conversation instead of requiring a strong joke. It still waits for a gap and does not produce endless monologues without new input. Restore `CHATTY_MODE=false`, `MIN_RELEVANCE=0.70`, and `REPLY_COOLDOWN_MS=45000` for normal behavior.

For maximum chatter, set `CHATTY_MODE=true`, `UNHINGED_MODE=true`, `MIN_RELEVANCE=0`, and `REPLY_COOLDOWN_MS=0`. This removes the reply cooldown and encourages absurd, sweary, playful commentary after almost every understandable turn. Replies remain capped at 240 characters and wait for a room pause. Disable both mode flags to restore the normal personality.

## Verification

With speech and Ollama running:

```powershell
npm test
npm run doctor
.venv\Scripts\python scripts/smoke.py
```

Smoke test: synthesize German audio in memory, convert to Discord PCM, transcribe, check silence. This does not validate dialect accuracy or live Discord receive. Those need a channel trial. Discord receive is not an officially documented API and can change.

Piper is GPL-3.0; check its and the voice model's licenses before redistributing. Dependency versions are locked in `package-lock.json` and `uv.lock`.

Implementation references: [Discord voice library](https://discord.js.org/docs/packages/voice/main), [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [Piper Python API](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_PYTHON.md).
