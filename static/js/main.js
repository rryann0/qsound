// Wires the app together: composer controls, server calls, transport, mixer and the views into the circuits.

import { Arrangement, CircuitView } from "./arrange.js";
import { TRACKS, Player, defaultMix, lengthSeconds, renderOffline } from "./engine.js";
import { saveMidi, saveQasm, saveRecord, saveWav } from "./export.js";

const $ = (id) => document.getElementById(id);
const player = new Player();
let piece = null;
let mix = null;
const muted = new Set();
const soloed = new Set();
let levels = {};
let busy = false;
let queued = false;
let currentCircuit = null;
let debounce = null;

// pieces you've made this session, so you can go back to one you liked
const past = [];
let pastIndex = -1;

const trackNames = { lead: "Lead", arp: "Arp", chords: "Chords", bass: "Bass", kick: "Kick", snare: "Snare", hat: "Hats" };

// ---- Arrangement and mixer

const arrangement = new Arrangement($("arrangement"), {
  onSeek: (step) => {
    player.seek(step);
    arrangement.frame(player.currentStep());
    updateLcd();
  },
  onSelect: (found) => showTrace(found),
  onSection: (section) => toggleSectionLoop(section),
});
const circuitView = new CircuitView($("circuit-scroll"), $("circuit-size"), $("circuit-canvas"), $("gate-info"));

function toggleSectionLoop(section) {
  const same = arrangement.loopSection?.name === section.name;
  const next = same ? null : section;
  player.setRegion(next ? [section.start * piece.stepsPerBar, section.end * piece.stepsPerBar] : null);
  arrangement.setLoopSection(next);
  $("trace").textContent = next ? `Looping ${section.name}. Click its label again to stop.` : "Playing the whole piece.";
  updateLcd();
}

function buildTracks() {
  const box = $("tracks");
  box.innerHTML = "";
  for (const t of TRACKS) {
    const row = document.createElement("div");
    row.className = "track";
    row.dataset.track = t;
    row.innerHTML = `
      <span class="track__name">${trackNames[t]}</span>
      <span class="track__btns">
        <button class="track__btn${muted.has(t) ? " is-on" : ""}" data-do="mute" aria-pressed="${muted.has(t)}" aria-label="Mute ${trackNames[t]}" title="Mute">M</button>
        <button class="track__btn${soloed.has(t) ? " is-on" : ""}" data-do="solo" aria-pressed="${soloed.has(t)}" aria-label="Solo ${trackNames[t]}" title="Solo">S</button>
      </span>
      <input type="range" min="0" max="100" value="${Math.round((levels[t] ?? 0) * 100)}" aria-label="${trackNames[t]} volume">
      <span class="track__meter"><i></i></span>`;
    row.querySelector("[data-do=mute]").addEventListener("click", (e) => toggle(muted, t, e.currentTarget));
    row.querySelector("[data-do=solo]").addEventListener("click", (e) => toggle(soloed, t, e.currentTarget));
    row.querySelector("input").addEventListener("input", (e) => {
      levels[t] = e.target.value / 100;
      applyMix();
    });
    box.append(row);
  }
}

function toggle(set, track, button) {
  if (set.has(track)) set.delete(track);
  else set.add(track);
  button.classList.toggle("is-on", set.has(track));
  button.setAttribute("aria-pressed", set.has(track));
  applyMix();
}

function audible(t) {
  if (soloed.size) return soloed.has(t);
  return !muted.has(t);
}

function applyMix() {
  for (const t of TRACKS) {
    const value = audible(t) ? levels[t] : 0;
    mix[t] = value;
    player.setGain(t, value);
    document.querySelector(`.track[data-track=${t}]`)?.classList.toggle("is-muted", !audible(t));
  }
}

// ---- Loading a piece

function setPiece(next, { keepMix = false } = {}) {
  const wasPlaying = player.playing;
  const place = player.currentStep();
  const looped = arrangement.loopSection?.name;
  piece = next;
  if (!keepMix || levels.kick === undefined) levels = defaultMix(piece.params.style);
  mix = { ...levels };
  player.load(piece, mix);
  buildTracks();
  applyMix();
  arrangement.setPiece(piece);
  // a section you're looping stays looped, so you can loop it and move a slider
  const section = piece.sections.find((s) => s.name === looped);
  if (section) {
    player.setRegion([section.start * piece.stepsPerBar, section.end * piece.stepsPerBar]);
    arrangement.setLoopSection(section);
  }
  renderGrooveState();
  renderWalk();
  renderRecord();
  renderCircuitPicker();
  syncControls();
  $("trace").textContent = "Click any note to see which qubit decided it.";
  writeHash();
  updateHistoryButtons();
  const [from, to] = player.bounds();
  const resume = place >= from && place < to ? place : from;
  // the music keeps going from the same spot, so you can hear what changed
  if (wasPlaying) player.start(resume);
  else player.position = resume;
  setPlayingUi(player.playing || wasPlaying);
  arrangement.frame(player.position);
  updateLcd();
}

function remember(next) {
  past.splice(pastIndex + 1);
  past.push(next);
  if (past.length > 40) past.shift();
  pastIndex = past.length - 1;
}

function updateHistoryButtons() {
  $("back").disabled = pastIndex <= 0;
  $("forward").disabled = pastIndex >= past.length - 1;
}

function stepHistory(by) {
  clearTimeout(debounce);
  const i = pastIndex + by;
  if (i < 0 || i >= past.length) return;
  pastIndex = i;
  setPiece(past[i], { keepMix: true });
  setStatus(`Piece ${i + 1} of ${past.length} this session.`);
}

function showBlurb() {
  const checked = document.querySelector("input[name=style]:checked");
  $("style-blurb").textContent = checked.dataset.blurb;
}

function syncControls() {
  const p = piece.params;
  document.querySelector(`input[name=style][value=${p.style}]`).checked = true;
  showBlurb();
  $("key").value = p.key;
  $("mode").value = p.mode;
  $("bpm").value = p.bpm;
  $("bpm-out").textContent = p.bpm;
  document.querySelector(`input[name=bars][value="${p.bars}"]`).checked = true;
  for (const [id, value] of [["ent", p.entanglement], ["phase", p.interference ?? 0.5], ["noise", p.noise]]) {
    $(id).value = Math.round(value * 100);
    $(`${id}-out`).textContent = `${$(id).value}%`;
  }
  $("seed").value = p.seed;
}

function currentParams(extra = {}) {
  return {
    style: document.querySelector("input[name=style]:checked").value,
    key: $("key").value,
    mode: $("mode").value,
    bpm: Number($("bpm").value),
    bars: Number(document.querySelector("input[name=bars]:checked").value),
    entanglement: $("ent").value / 100,
    interference: $("phase").value / 100,
    noise: $("noise").value / 100,
    seed: Number($("seed").value) || 0,
    ...extra,
  };
}

function setStatus(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("is-error", error);
}

async function compose(extra = {}, { keepMix = true } = {}) {
  // this run covers anything a slider had queued up
  clearTimeout(debounce);
  if (busy) {
    queued = true;
    return;
  }
  busy = true;
  const button = $("compose");
  button.disabled = true;
  button.textContent = "Measuring…";
  const slow = setTimeout(() => setStatus("The server is waking up. This can take a minute, once."), 2500);
  try {
    const params = currentParams(extra);
    const response = await fetch("/api/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The server couldn't compose that.");
    setPiece(data, { keepMix });
    remember(data);
    updateHistoryButtons();
    const prov = data.provenance;
    setStatus(`${prov.totalQubits} qubits measured in ${prov.computeSeconds} s.`);
  } catch (e) {
    setStatus(e.message === "Failed to fetch" ? "Couldn't reach the server. Check your connection and try again." : e.message, true);
  } finally {
    clearTimeout(slow);
    busy = false;
    button.disabled = false;
    button.textContent = "Compose";
    if (queued) {
      queued = false;
      compose();
    }
  }
}

function composeSoon() {
  clearTimeout(debounce);
  debounce = setTimeout(() => compose(), 260);
}

function writeHash() {
  const p = piece.params;
  const q = new URLSearchParams({
    style: p.style, key: p.key, mode: p.mode, bpm: p.bpm, bars: p.bars,
    e: p.entanglement, i: p.interference ?? 0.5, n: p.noise, seed: p.seed,
    sh: p.seeds.harmony, sg: p.seeds.groove, sm: p.seeds.melody,
  });
  history.replaceState(null, "", `#${q}`);
}

function readHash() {
  if (location.hash.length < 2) return null;
  const q = new URLSearchParams(location.hash.slice(1));
  if (!q.get("style")) return null;
  return {
    style: q.get("style"), key: q.get("key"), mode: q.get("mode"), bpm: Number(q.get("bpm")), bars: Number(q.get("bars")),
    entanglement: Number(q.get("e")), interference: Number(q.get("i") ?? 0.5), noise: Number(q.get("n")), seed: Number(q.get("seed")),
    seeds: { harmony: Number(q.get("sh")), groove: Number(q.get("sg")), melody: Number(q.get("sm")) },
  };
}

// ---- Transport

function setPlayingUi(on) {
  const b = $("play");
  b.classList.toggle("is-playing", on);
  b.setAttribute("aria-label", on ? "Pause" : "Play");
  b.querySelector("use").setAttribute("href", on ? "#i-pause" : "#i-play");
}

async function start() {
  await player.start();
  setPlayingUi(true);
}

function pause() {
  player.pause();
  setPlayingUi(false);
}

const togglePlay = () => (player.playing ? pause() : start());
const toggleLoop = () => {
  player.loop = !player.loop;
  $("loop").classList.toggle("is-on", player.loop);
  $("loop").setAttribute("aria-pressed", player.loop);
};

$("play").addEventListener("click", togglePlay);
$("stop").addEventListener("click", () => {
  player.stop();
  setPlayingUi(false);
  arrangement.frame(player.position);
  updateLcd();
});
$("loop").addEventListener("click", toggleLoop);
$("volume").addEventListener("input", (e) => player.setVolume(e.target.value / 100));
player.onEnd = () => {
  setPlayingUi(false);
  arrangement.frame(0);
  updateLcd();
};

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = e.target.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  if ($("guide").open && e.key !== "?") return;
  if (e.code === "Space") {
    if (tag === "BUTTON") return;
    e.preventDefault();
    togglePlay();
    return;
  }
  const bar = piece?.stepsPerBar ?? 16;
  const actions = {
    ArrowRight: () => player.seek(player.currentStep() + bar),
    ArrowLeft: () => player.seek(Math.max(0, player.currentStep() - bar)),
    c: () => compose(),
    l: toggleLoop,
    b: () => stepHistory(-1),
    n: () => stepHistory(1),
    g: openGuide,
    "?": openGuide,
  };
  const act = actions[e.key];
  if (act) {
    e.preventDefault();
    act();
    updateLcd();
  }
});

// ---- LCD and live meters

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function updateLcd() {
  if (!piece) return;
  const step = player.currentStep();
  const bar = Math.floor(step / piece.stepsPerBar);
  const beat = Math.floor(step / 4) % 4;
  const sixteenth = Math.floor(step) % 4;
  $("lcd-pos").textContent = `${String(bar + 1).padStart(3, "0")}.${beat + 1}.${sixteenth + 1}`;
  const total = lengthSeconds(piece);
  $("lcd-time").textContent = `${mmss((step / (piece.bars * piece.stepsPerBar)) * total)} / ${mmss(total)}`;
  $("lcd-chord").textContent = piece.chords[Math.min(bar, piece.bars - 1)]?.name ?? "–";
  $("lcd-section").textContent = piece.sections.find((s) => bar >= s.start && bar < s.end)?.name ?? "–";
  $("lcd-bpm").textContent = `${piece.bpm} BPM`;
}

const meterCanvas = $("meter");
const meterCtx = meterCanvas.getContext("2d");
const spectro = $("spectro");
const spectroCtx = spectro.getContext("2d");
const wave = $("wave");
const waveCtx = wave.getContext("2d");
let spectroReady = false;
let peak = 0;

function fitCanvas(c) {
  const r = c.getBoundingClientRect();
  const w = Math.round(r.width * Math.min(devicePixelRatio || 1, 2));
  const h = Math.round(r.height * Math.min(devicePixelRatio || 1, 2));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
    return true;
  }
  return false;
}

// navy, cobalt, ice, white
function heat(v) {
  const stops = [[6, 13, 36], [27, 63, 216], [124, 196, 238], [255, 255, 255]];
  const x = Math.min(0.999, v) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  return stops[i].map((c, k) => Math.round(c + (stops[i + 1][k] - c) * f));
}

function drawLive() {
  const analyser = player.engine?.analyser;
  fitCanvas(wave);
  if (fitCanvas(spectro) || !spectroReady) {
    spectroCtx.fillStyle = "#060d24";
    spectroCtx.fillRect(0, 0, spectro.width, spectro.height);
    spectroReady = true;
  }

  if (analyser && player.playing) {
    const bins = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(bins);
    // scroll the waterfall left by a column
    const W = spectro.width;
    const H = spectro.height;
    spectroCtx.drawImage(spectro, -2, 0);
    for (let y = 0; y < H; y++) {
      // log frequency, so the bass gets room
      const f = (1 - y / H) ** 2.6;
      const v = bins[Math.min(bins.length - 1, Math.floor(f * bins.length * 0.75))] / 255;
      const [r, g, b] = heat(v ** 1.5);
      spectroCtx.fillStyle = `rgb(${r},${g},${b})`;
      spectroCtx.fillRect(W - 2, y, 2, 1);
    }

    const time = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(time);
    waveCtx.fillStyle = "#060d24";
    waveCtx.fillRect(0, 0, wave.width, wave.height);
    waveCtx.strokeStyle = "#a9e4ff";
    waveCtx.lineWidth = 1.5;
    waveCtx.beginPath();
    let level = 0;
    for (let i = 0; i < time.length; i++) {
      const s = (time[i] - 128) / 128;
      level = Math.max(level, Math.abs(s));
      const x = (i / time.length) * wave.width;
      const y = (0.5 - s * 0.46) * wave.height;
      if (i) waveCtx.lineTo(x, y);
      else waveCtx.moveTo(x, y);
    }
    waveCtx.stroke();
    peak = Math.max(level, peak * 0.93);

    for (const t of TRACKS) {
      const a = player.engine.buses[t].analyser;
      const d = new Uint8Array(a.fftSize);
      a.getByteTimeDomainData(d);
      let m = 0;
      for (const b of d) m = Math.max(m, Math.abs(b - 128) / 128);
      const bar = document.querySelector(`.track[data-track=${t}] .track__meter i`);
      if (bar) bar.style.transform = `scaleX(${Math.min(1, m * 1.6)})`;
    }
  } else {
    peak *= 0.9;
    waveCtx.fillStyle = "#060d24";
    waveCtx.fillRect(0, 0, wave.width, wave.height);
    waveCtx.fillStyle = "#2a3f7d";
    waveCtx.fillRect(0, wave.height / 2, wave.width, 1);
    document.querySelectorAll(".track__meter i").forEach((b) => (b.style.transform = "scaleX(0)"));
  }

  // the master meter, as LCD segments
  const W = meterCanvas.width;
  const H = meterCanvas.height;
  meterCtx.clearRect(0, 0, W, H);
  const n = 20;
  for (let i = 0; i < n; i++) {
    const on = i / n < peak;
    meterCtx.fillStyle = on ? (i > n - 3 ? "#ff4d55" : "#a9e4ff") : "#16254f";
    meterCtx.fillRect(i * (W / n), H * 0.3, W / n - 2, H * 0.4);
  }
}

function loop() {
  if (piece) {
    arrangement.frame(player.currentStep());
    if (player.playing) updateLcd();
  }
  drawLive();
  requestAnimationFrame(loop);
}

// ---- Tracing a note back to its qubit

function showTrace(found) {
  const box = $("trace");
  if (!found) {
    box.textContent = "Click any note to see which qubit decided it.";
    return;
  }
  const { track, note } = found;
  const bar = Math.floor(note.s / piece.stepsPerBar) + 1;
  const step = Math.floor(note.s % piece.stepsPerBar) + 1;
  const where = `${trackNames[track]}, bar ${bar} step ${step}.`;
  const src = note.src;
  box.textContent = "";
  if (!src) {
    box.textContent = `${where} Set by the style.`;
    return;
  }
  if (src.c === "harmony") {
    const w = piece.walk[src.slot];
    box.textContent = w.counts
      ? `${where} ${w.chord}: the chord walk landed on position ${w.position} in shot ${w.shot}.`
      : `${where} ${w.chord}: every progression starts on the home chord.`;
    return;
  }
  const circuit = piece.circuits.find((c) => c.id === src.c);
  const label = circuit.labels[src.q];
  const stats = circuit.prepared
    ? `The style asks for ${Math.round(circuit.prepared[src.q] * 100)}%. It measured 1 in ${Math.round(circuit.measured[src.q] * 100)}% of ${circuit.shots} shots.`
    : `It measured 1 in ${Math.round(circuit.measured[src.q] * 100)}% of ${circuit.shots} shots.`;
  box.append(`${where} Qubit ${src.q} (${label}) measured 1 in shot ${src.shot}. ${stats} `);
  const link = document.createElement("button");
  link.textContent = "Show in circuit";
  link.addEventListener("click", () => {
    selectTab("circuit");
    showCircuit(circuit.id, src.q);
  });
  box.append(link);
}

// ---- The views

function selectTab(name) {
  document.querySelectorAll(".tab").forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle("is-on", on);
    t.setAttribute("aria-selected", on);
  });
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("is-on", v.dataset.view === name));
  $("circuit-tools").hidden = name !== "circuit";
  if (name === "circuit") showCircuit(currentCircuit ?? piece.circuits[0].id);
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => selectTab(t.dataset.tab)));

function renderCircuitPicker() {
  const pick = $("circuit-pick");
  pick.innerHTML = piece.circuits.map((c) => `<option value="${c.id}">${c.name}: ${c.qubits} qubits</option>`).join("");
  currentCircuit = piece.circuits[0].id;
  pick.onchange = () => showCircuit(pick.value);
  if ($("view-circuit").classList.contains("is-on")) showCircuit(currentCircuit);
}

function showCircuit(id, highlight = null) {
  currentCircuit = id;
  $("circuit-pick").value = id;
  circuitView.set(piece.circuits.find((c) => c.id === id), highlight);
}

$("circuit-fit").addEventListener("click", (e) => {
  const on = !circuitView.fit;
  e.currentTarget.classList.toggle("is-on", on);
  e.currentTarget.setAttribute("aria-pressed", on);
  e.currentTarget.textContent = on ? "Zoom in" : "See it all";
  circuitView.setFit(on);
});

function renderGrooveState() {
  const c = piece.circuits.find((x) => x.id === "groove");
  const voices = ["bass", "kick", "snare", "hat", "stab"];
  const names = { kick: "Kick", bass: "Bass", snare: "Snare", hat: "Hats", stab: "Stabs" };
  const order = ["kick", "snare", "hat", "bass", "stab"];
  let html = `<p class="grid-note">Each cell is a qubit. Brightness: how often it measured 1. White line: the chance the style asks for. The difference is entanglement and interference.</p><div class="state"><span></span>`;
  for (let s = 0; s < 16; s++) html += `<span class="state__num">${s + 1}</span>`;
  for (const v of order) {
    html += `<span class="state__label">${names[v]}</span>`;
    for (let s = 0; s < 16; s++) {
      const q = s * voices.length + voices.indexOf(v);
      const m = c.measured[q];
      const pr = c.prepared[q];
      html += `<button class="state__cell" data-q="${q}" title="${c.labels[q]}: the style asks for ${Math.round(pr * 100)}%, measured ${Math.round(m * 100)}%" aria-label="${c.labels[q]}: the style asks for ${Math.round(pr * 100)} percent, measured ${Math.round(m * 100)} percent"><i style="opacity:${m.toFixed(3)}"></i><b style="transform:scaleX(${pr.toFixed(3)})"></b></button>`;
    }
  }
  html += "</div>";
  const view = $("view-groove");
  view.innerHTML = html;
  view.querySelectorAll(".state__cell").forEach((cell) => {
    cell.addEventListener("click", () => {
      selectTab("circuit");
      showCircuit("groove", Number(cell.dataset.q));
    });
  });
}

function renderWalk() {
  const cols = piece.walk.map((w) => {
    if (!w.counts) {
      return `<div class="walk__col"><span class="walk__chord">${w.chord}</span><span class="walk__home">Home chord</span><span class="walk__foot">start</span></div>`;
    }
    const top = Math.max(...w.counts, 1);
    const bars = w.counts
      .map((n, p) => `<i class="${p === w.position ? "is-picked" : ""}" style="height:${(n / top) * 100}%" title="${w.ring[p]}: ${n} shots"></i>`)
      .join("");
    return `<div class="walk__col"><span class="walk__chord">${w.chord}</span><div class="walk__bars">${bars}</div><span class="walk__foot">pos ${w.position}</span></div>`;
  });
  $("view-walk").innerHTML = `<p class="grid-note">Each chart is one quantum walk: where its shots landed on the ring of chords. White: the chord it picked.</p><div class="walk">${cols.join("")}</div>`;
}

function renderRecord() {
  const p = piece.provenance;
  const params = piece.params;
  const rows = [
    ["Backend", p.backend],
    ["Qubits", p.totalQubits],
    ["Circuits", p.circuits],
    ["Groove shots", p.shots.groove],
    ["Melody shots", p.shots.melody],
    ["Walk shots", piece.circuits[2]?.shots ?? "–"],
    ["Entanglement", `${Math.round(p.entanglement * 100)}%`],
    ["Interference", `${Math.round((p.interference ?? 0) * 100)}%`],
    ["Decoherence", `${Math.round(p.noise * 100)}%`],
    ["Seeds", `${p.seeds.harmony} · ${p.seeds.groove} · ${p.seeds.melody}`],
    ["Style", `${piece.styleName}, ${params.key} ${params.mode}`],
    ["QSound version", p.qsoundVersion],
  ];
  $("view-record").innerHTML =
    `<dl class="record">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>` +
    `<p class="record__note">${p.note} The same settings and seeds always give this exact piece, so anyone can check it.</p>`;
}

// ---- Controls

document.querySelectorAll("input[name=style]").forEach((r) => {
  r.addEventListener("change", () => {
    $("bpm").value = r.dataset.bpm;
    $("bpm-out").textContent = r.dataset.bpm;
    $("mode").value = r.dataset.mode;
    showBlurb();
    compose({}, { keepMix: false });
  });
});
for (const [id, unit] of [["bpm", ""], ["ent", "%"], ["phase", "%"], ["noise", "%"]]) {
  $(id).addEventListener("input", (e) => {
    $(`${id}-out`).textContent = `${e.target.value}${unit}`;
    composeSoon();
  });
}
for (const id of ["key", "mode", "seed"]) $(id).addEventListener("change", composeSoon);
document.querySelectorAll("input[name=bars]").forEach((r) => r.addEventListener("change", composeSoon));

$("compose").addEventListener("click", () => compose());
$("back").addEventListener("click", () => stepHistory(-1));
$("forward").addEventListener("click", () => stepHistory(1));
$("dice").addEventListener("click", () => {
  // a browser-side seed: it only says which run to do. The notes still come from the circuits.
  $("seed").value = Math.floor(Math.random() * 2147483646);
  compose();
});
document.querySelectorAll("[data-layer]").forEach((b) => {
  b.addEventListener("click", () => {
    if (!piece) return;
    const seeds = { ...piece.params.seeds };
    seeds[b.dataset.layer] = seeds[b.dataset.layer] + 7919;
    compose({ seeds });
  });
});

async function withButton(button, work) {
  const label = button.textContent;
  button.textContent = "Rendering…";
  try {
    await work();
  } catch (e) {
    setStatus(`Export failed: ${e.message}`, true);
  } finally {
    button.textContent = label;
  }
}

$("x-wav").addEventListener("click", async () => {
  const summary = $("export-menu").querySelector("summary");
  $("export-menu").open = false;
  await withButton(summary, async () => saveWav(await renderOffline(piece, { ...mix }), piece));
});
for (const [id, save] of [["x-midi", saveMidi], ["x-qasm", saveQasm], ["x-json", saveRecord]]) {
  $(id).addEventListener("click", () => {
    $("export-menu").open = false;
    save(piece);
  });
}
document.addEventListener("click", (e) => {
  if (!$("export-menu").contains(e.target)) $("export-menu").open = false;
});
$("share").addEventListener("click", async () => {
  try {
    writeHash();
    await navigator.clipboard.writeText(location.href);
    setStatus("Link copied. It opens this exact piece.");
  } catch {
    setStatus("Copy the page address to share this exact piece.");
  }
});

// ---- Guide

function openGuide() {
  if (!$("guide").open) $("guide").showModal();
}
$("open-guide").addEventListener("click", openGuide);
$("close-guide").addEventListener("click", () => $("guide").close());
$("guide").addEventListener("click", (e) => {
  if (e.target === $("guide")) $("guide").close();
  // the page address names the piece, so the guide's contents links scroll without touching it
  const link = e.target.closest('a[href^="#"]');
  if (link) {
    e.preventDefault();
    $("guide").querySelector(link.getAttribute("href"))?.scrollIntoView();
  }
});
document.querySelectorAll("[data-show]").forEach((b) => {
  b.addEventListener("click", () => {
    $("guide").close();
    if (b.dataset.tab) selectTab(b.dataset.tab);
    const target = document.querySelector(b.dataset.show);
    target?.scrollIntoView({ block: "nearest" });
    target?.classList.remove("is-pointed");
    void target?.offsetWidth;
    target?.classList.add("is-pointed");
    setTimeout(() => target?.classList.remove("is-pointed"), 2400);
  });
});

// ---- Start: a real piece, already composed, so the app works before the server wakes up.

async function boot() {
  const shared = readHash();
  try {
    const demo = await (await fetch("/static/demo.json")).json();
    setPiece(demo);
    remember(demo);
    updateHistoryButtons();
    setStatus("Already composed. Press Play.");
  } catch {
    setStatus("Press Compose to run the circuits.");
  }
  if (shared) {
    // a shared link names the exact piece
    await compose({ ...shared }, { keepMix: false });
  }
  fetch("/health").catch(() => {});
  requestAnimationFrame(loop);
}

// exposed for automated checks and for anyone curious in the console
window.qsound = {
  get piece() { return piece; },
  get mix() { return mix; },
  player,
  renderOffline,
};

boot();
