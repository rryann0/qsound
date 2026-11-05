// Downloads: WAV, MIDI, the circuits as OpenQASM, and the full record of how a piece was made.

import { TRACKS } from "./engine.js";

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pieceName(piece) {
  const p = piece.params;
  return `qsound-${p.style}-${p.key}-${p.mode}-${p.seed}`.replace(/#/g, "s");
}

export function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = 44 + frames * channels * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const text = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, bytes - 8, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * channels * 2, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([view], { type: "audio/wav" });
}

export function saveWav(buffer, piece) {
  save(encodeWav(buffer), `${pieceName(piece)}.wav`);
}

// ---- MIDI

const TICKS_PER_STEP = 120;
const CHANNEL = { lead: 0, arp: 1, chords: 2, bass: 3, kick: 9, snare: 9, hat: 9 };

function vlq(n) {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}

const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (id, body) => [...ascii(id), ...u32(body.length), ...body];

function trackChunk(name, events) {
  events.sort((a, b) => a.t - b.t || a.order - b.order);
  const body = [0, 0xff, 0x03, name.length, ...ascii(name)];
  let last = 0;
  for (const e of events) {
    body.push(...vlq(e.t - last), ...e.bytes);
    last = e.t;
  }
  body.push(0, 0xff, 0x2f, 0);
  return chunk("MTrk", body);
}

export function encodeMidi(piece) {
  const perBeat = TICKS_PER_STEP * 4;
  const micros = Math.round(60000000 / piece.bpm);
  const meta = chunk("MTrk", [0, 0xff, 0x51, 3, (micros >> 16) & 255, (micros >> 8) & 255, micros & 255, 0, 0xff, 0x58, 4, 4, 2, 24, 8, 0, 0xff, 0x2f, 0]);
  const tracks = TRACKS.filter((t) => piece.tracks[t]?.length).map((name) => {
    const ch = CHANNEL[name];
    const events = [];
    for (const n of piece.tracks[name]) {
      const velocity = Math.max(1, Math.min(127, Math.round(n.v * 127)));
      const start = Math.round(n.s * TICKS_PER_STEP);
      events.push({ t: start, order: 1, bytes: [0x90 | ch, n.m, velocity] });
      events.push({ t: start + Math.round(n.d * TICKS_PER_STEP) - 1, order: 0, bytes: [0x80 | ch, n.m, 0] });
    }
    return trackChunk(name, events);
  });
  const header = chunk("MThd", [0, 1, 0, tracks.length + 1, (perBeat >> 8) & 255, perBeat & 255]);
  return new Blob([new Uint8Array([...header, ...meta, ...tracks.flat()])], { type: "audio/midi" });
}

export function saveMidi(piece) {
  save(encodeMidi(piece), `${pieceName(piece)}.mid`);
}

export function saveQasm(piece) {
  const text = piece.circuits.map((c) => `// ${c.name}: ${c.qubits} qubits, ${c.shots} shots, seed ${c.seed}\n${c.qasm}`).join("\n");
  save(new Blob([text], { type: "text/plain" }), `${pieceName(piece)}.qasm`);
}

export function saveRecord(piece) {
  save(new Blob([JSON.stringify(piece, null, 1)], { type: "application/json" }), `${pieceName(piece)}.json`);
}
