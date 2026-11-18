"""Real TTS -> Discord-format PCM -> STT, without Discord credentials."""
import io
import json
import subprocess
import time
import urllib.request
import wave

base = "http://127.0.0.1:8765"
started = time.perf_counter()
request = urllib.request.Request(base + "/synthesize", data=json.dumps({"text": "Hallo zusammen. Unser Server ist schon wieder abgestürzt."}).encode(), headers={"Content-Type": "application/json"})
with urllib.request.urlopen(request, timeout=60) as response:
    wav = response.read()
tts_seconds = time.perf_counter() - started
with wave.open(io.BytesIO(wav)) as audio:
    duration = audio.getnframes() / audio.getframerate()
pcm = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "2", "-ar", "48000", "pipe:1"], input=wav, capture_output=True, check=True).stdout
with urllib.request.urlopen(urllib.request.Request(base + "/transcribe", data=pcm), timeout=60) as response:
    result = json.load(response)
assert "server" in result["text"].lower(), result
print(json.dumps({"audio_seconds": round(duration, 2), "tts_seconds": round(tts_seconds, 2), "transcription": result}, ensure_ascii=False, indent=2))
with urllib.request.urlopen(urllib.request.Request(base + "/transcribe", data=bytes(48000 * 4)), timeout=60) as response:
    assert json.load(response)["text"] == ""
print("Silence test passed.")

# Exercise the exact raw-PCM path used for Discord playback.
request = urllib.request.Request(base + "/synthesize-pcm", data=json.dumps({"text":"Bruno ist bereit."}).encode(), headers={"Content-Type":"application/json"})
with urllib.request.urlopen(request, timeout=60) as response:
    raw = response.read()
assert len(raw) % 4 == 0 and 48000 < len(raw) < 48000 * 4 * 10
with urllib.request.urlopen(urllib.request.Request(base + "/transcribe", data=raw), timeout=60) as response:
    raw_result = json.load(response)
assert "bereit" in raw_result["text"].lower(), raw_result
print("Discord PCM synthesis and transcription passed.")
