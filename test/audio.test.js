import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import prism from 'prism-media';
import { createAudioResource, StreamType } from '@discordjs/voice';

test('installed Opus encoder and decoder can process Discord PCM', async () => {
  const pcm = Buffer.alloc(960 * 2 * 2);
  const encoder = new prism.opus.Encoder({rate:48000,channels:2,frameSize:960});
  const decoder = new prism.opus.Decoder({rate:48000,channels:2,frameSize:960});
  const output = [];
  decoder.on('data', data => output.push(data));
  const ended = once(decoder, 'end');
  Readable.from([pcm]).pipe(encoder).pipe(decoder);
  await ended;
  assert.equal(Buffer.concat(output).length, pcm.length);
});

test('raw Discord playback emits Opus packets without an FFmpeg stage', async () => {
  const resource = createAudioResource(Readable.from([Buffer.alloc(48000 * 4)]), {inputType:StreamType.Raw});
  assert.ok(resource.edges.every(edge => edge.type !== 'ffmpeg pcm' && edge.type !== 'ffmpeg ogg'));
  let packets = 0;
  for await (const packet of resource.playStream) { assert.ok(packet.length); packets++; }
  assert.equal(packets,50);
});

test('WAV playback goes through installed FFmpeg and reaches Opus output', async () => {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + 48000,4); header.write('WAVEfmt ',8);
  header.writeUInt32LE(16,16); header.writeUInt16LE(1,20); header.writeUInt16LE(1,22);
  header.writeUInt32LE(24000,24); header.writeUInt32LE(48000,28);
  header.writeUInt16LE(2,32); header.writeUInt16LE(16,34); header.write('data',36); header.writeUInt32LE(48000,40);
  const resource = createAudioResource(Readable.from([Buffer.concat([header, Buffer.alloc(48000)])]), {inputType:StreamType.Arbitrary});
  let packets = 0;
  for await (const packet of resource.playStream) { assert.ok(packet.length); packets++; }
  assert.ok(packets > 0);
});
