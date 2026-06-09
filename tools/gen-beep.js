// 生成一个简短的“嘀”提示音 WAV（扫码成功反馈用）。
// 运行：node tools/gen-beep.js
const fs = require("node:fs");
const path = require("node:path");

const sampleRate = 44100;
const durationSec = 0.12;
const freq = 1320; // Hz，清脆的“嘀”
const numSamples = Math.floor(sampleRate * durationSec);
const amplitude = 0.35 * 0x7fff;

const dataSize = numSamples * 2; // 16-bit mono
const buffer = Buffer.alloc(44 + dataSize);

// RIFF header
buffer.write("RIFF", 0);
buffer.writeUInt32LE(36 + dataSize, 4);
buffer.write("WAVE", 8);
// fmt chunk
buffer.write("fmt ", 12);
buffer.writeUInt32LE(16, 16); // PCM chunk size
buffer.writeUInt16LE(1, 20); // PCM
buffer.writeUInt16LE(1, 22); // mono
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
buffer.writeUInt16LE(2, 32); // block align
buffer.writeUInt16LE(16, 34); // bits per sample
// data chunk
buffer.write("data", 36);
buffer.writeUInt32LE(dataSize, 40);

const fadeSamples = Math.floor(numSamples * 0.15);
for (let i = 0; i < numSamples; i++) {
  let env = 1;
  if (i < fadeSamples) env = i / fadeSamples;
  else if (i > numSamples - fadeSamples) env = (numSamples - i) / fadeSamples;
  const sample = Math.sin((2 * Math.PI * freq * i) / sampleRate) * amplitude * env;
  buffer.writeInt16LE(Math.max(-0x8000, Math.min(0x7fff, sample | 0)), 44 + i * 2);
}

const outDir = path.join(__dirname, "..", "apps", "mobile", "assets");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "beep.wav");
fs.writeFileSync(outPath, buffer);
console.log(`wrote ${outPath} (${buffer.length} bytes)`);
