"""Convert synthesized WAV to Discord's interleaved 48 kHz stereo signed PCM."""
import io
import av


def discord_pcm(wav_bytes):
    resampler = av.AudioResampler(format="s16", layout="stereo", rate=48000)
    chunks = []
    with av.open(io.BytesIO(wav_bytes), format="wav") as container:
        for frame in container.decode(audio=0):
            chunks.extend(out.to_ndarray().tobytes() for out in resampler.resample(frame))
    chunks.extend(out.to_ndarray().tobytes() for out in resampler.resample(None))
    return b"".join(chunks)
