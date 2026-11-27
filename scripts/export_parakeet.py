"""One-time export of a NeMo Parakeet TDT checkpoint (.nemo) to ONNX for onnx-asr.

Needs NeMo, which the bot itself does not. Run it from a separate environment:

    uv venv .venv-export --python 3.12
    uv pip install --python .venv-export/Scripts/python.exe torch --index-url https://download.pytorch.org/whl/cpu
    uv pip install --python .venv-export/Scripts/python.exe "nemo_toolkit[asr]==2.7.3" onnx onnxruntime
    .venv-export/Scripts/python scripts/export_parakeet.py models/parakeet-sg/parakeet-tdt-0.6b-v3-swiss-german.nemo models/parakeet-sg

Writes encoder-model.onnx, decoder_joint-model.onnx, vocab.txt and int8-quantized copies.
config.json and nemo128.onnx (the preprocessor) come from istupakov/parakeet-tdt-0.6b-v3-onnx.
"""
import sys
from pathlib import Path

import nemo.collections.asr as nemo_asr
import onnx
from onnxruntime.quantization import QuantType, quantize_dynamic

src, out = sys.argv[1], Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

model = nemo_asr.models.ASRModel.restore_from(src, map_location="cpu")
model.eval()
model.export(str(out / "model.onnx"))  # TDT models export as encoder-model.onnx + decoder_joint-model.onnx

# The >2 GB encoder is exported with hundreds of loose weight files; gather them into encoder-model.onnx.data.
loose = {p.name for p in out.iterdir()}
encoder = onnx.load(str(out / "encoder-model.onnx"))
onnx.save_model(encoder, str(out / "encoder-model.onnx"), save_as_external_data=True, all_tensors_to_one_file=True,
                location="encoder-model.onnx.data")
for tensor in encoder.graph.initializer:
    for entry in tensor.external_data:
        if entry.key == "location" and entry.value != "encoder-model.onnx.data":
            raise RuntimeError("external data not consolidated")
for name in loose:
    path = out / name
    if path.is_file() and not name.endswith((".nemo", ".wav", ".onnx", ".json", ".txt", ".data")):
        path.unlink()

with (out / "vocab.txt").open("w", encoding="utf-8") as f:
    for i, token in enumerate([*model.tokenizer.vocab, "<blk>"]):
        f.write(f"{token} {i}\n")

for name in ("encoder-model", "decoder_joint-model"):
    quantize_dynamic(str(out / f"{name}.onnx"), str(out / f"{name}.int8.onnx"), weight_type=QuantType.QUInt8,
                     use_external_data_format=False)

print("Exported to", out, sorted(p.name for p in out.iterdir()))
