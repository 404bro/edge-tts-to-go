"use strict";

// Command-line check of the protocol layer: list voices, synthesize a
// sentence and write it to out.mp3.
//
//   node scripts/smoke.js [text] [voice]

const fs = require("fs");
const path = require("path");
const { listVoices } = require("../src/main/tts/voices");
const { synthesize } = require("../src/main/tts/communicate");
const { splitSegments } = require("../src/main/tts/segments");

async function main() {
  const text = process.argv[2] || "你好，这是一个测试。Hello & welcome to <edge-tts-to-go>!";
  const voice = process.argv[3] || "zh-CN-XiaoxiaoNeural";

  console.log("segments:", splitSegments("第一句。第二句！Pi is 3.14. Done.\n\n新段落"));

  const voices = await listVoices();
  console.log(`voices: ${voices.length}`);

  const parts = [];
  await synthesize(text, { voice, rate: "+0%", onAudio: (b) => parts.push(b) });
  const audio = Buffer.concat(parts);
  const out = path.join(__dirname, "..", "out.mp3");
  fs.writeFileSync(out, audio);
  console.log(`audio: ${audio.length} bytes, ${(audio.length * 8 / 48000).toFixed(2)} s -> ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
