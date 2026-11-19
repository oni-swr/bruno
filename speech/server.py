"""Local-only speech worker. Audio is processed in RAM and never saved."""
import io
import json
import os
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from faster_whisper import WhisperModel
from piper import PiperVoice
from audio import discord_pcm

stt_lock = threading.Lock()
tts_lock = threading.Lock()
whisper = WhisperModel(os.getenv("WHISPER_MODEL", "small"), device="cpu", compute_type="int8", cpu_threads=int(os.getenv("WHISPER_THREADS") or min(6, os.cpu_count() or 4)), download_root="models/whisper")
voice = PiperVoice.load(os.getenv("PIPER_MODEL", "models/de_DE-thorsten-medium.onnx"))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send(self, status, body, kind="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.send(200 if self.path == "/health" else 404, b'{"ready":true,"service":"local-discord-mate-speech"}' if self.path == "/health" else b'{}')

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 6_000_000:
                self.send(413, b'{"error":"invalid body size"}')
                return
            body = self.rfile.read(length)
            started = time.perf_counter()
            if self.path == "/transcribe":
                # Discord: signed 16-bit PCM, stereo, 48 kHz. Downmix/decimate to 16 kHz.
                if len(body) % 4:
                    raise ValueError("PCM must contain complete stereo frames")
                pcm = np.frombuffer(body, dtype="<i2").reshape(-1, 2).astype(np.float32).mean(axis=1)[::3] / 32768
                with stt_lock:
                    segments, _ = whisper.transcribe(pcm, language=os.getenv("WHISPER_LANGUAGE", "de"), beam_size=1, vad_filter=True, condition_on_previous_text=False)
                    text = " ".join(s.text.strip() for s in segments if s.no_speech_prob < 0.6).strip()
                self.send(200, json.dumps({"text": text, "seconds": time.perf_counter() - started}).encode())
            elif self.path in ("/synthesize", "/synthesize-pcm"):
                text = json.loads(body).get("text", "")
                if not isinstance(text, str) or not 0 < len(text) <= 500:
                    raise ValueError("text must be 1–500 characters")
                output = io.BytesIO()
                with tts_lock, wave.open(output, "wb") as wav:
                    voice.synthesize_wav(text, wav)
                if self.path == "/synthesize-pcm":
                    self.send(200, discord_pcm(output.getvalue()), "application/octet-stream")
                else:
                    self.send(200, output.getvalue(), "audio/wav")
            else:
                self.send(404, b'{}')
        except (BrokenPipeError, ConnectionResetError):
            pass  # The bot disconnected or cancelled a request.
        except Exception as exc:
            print(f"Speech request failed: {type(exc).__name__}: {exc}", flush=True)
            try:
                self.send(500, b'{"error":"speech processing failed"}')
            except (BrokenPipeError, ConnectionResetError):
                pass


if __name__ == "__main__":
    print("Speech models ready at http://127.0.0.1:8765", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
