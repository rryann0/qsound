// The arrangement: every track drawn from the real note data, with a playhead.
// The circuit view: the real gates of each circuit, drawn from what the server ran.

import { TRACKS } from "./engine.js";

export const TOP = 56; // ruler + chord lane, matched by the track headers in CSS
const RULER = 26;
const COLORS = { lead: "#ffffff", arp: "#7cc4ee", chords: "#6f8fff", bass: "#a9c4ff", kick: "#ffffff", snare: "#7cc4ee", hat: "#8fa6c8" };
const PITCHED = new Set(["lead", "arp", "chords", "bass"]);

export class Arrangement {
  constructor(canvas, { onSeek, onSelect, onSection }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.staticLayer = document.createElement("canvas");
    this.piece = null;
    this.selected = null;
    this.hovered = null;
    this.loopSection = null;
    this.onSeek = onSeek;
    this.onSelect = onSelect;
    this.onSection = onSection;
    this.chips = [];
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    canvas.addEventListener("pointerdown", (e) => this.pointer(e));
    canvas.addEventListener("pointermove", (e) => this.hover(e));
    canvas.addEventListener("pointerleave", () => {
      this.hovered = null;
    });
    canvas.addEventListener("keydown", (e) => this.key(e));
  }

  setPiece(piece) {
    this.piece = piece;
    this.selected = null;
    this.hovered = null;
    this.loopSection = null;
    this.total = piece.bars * piece.stepsPerBar;
    this.ranges = {};
    for (const t of PITCHED) {
      const pitches = (piece.tracks[t] ?? []).map((n) => n.m);
      const lo = pitches.length ? Math.min(...pitches) : 60;
      const hi = pitches.length ? Math.max(...pitches) : 72;
      this.ranges[t] = [lo - 1, Math.max(hi + 1, lo + 6)];
    }
    this.resize();
  }

  setLoopSection(section) {
    this.loopSection = section;
    this.drawStatic();
    this.frame(this.lastStep ?? 0);
  }

  resize() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = box.width;
    this.h = box.height;
    this.canvas.width = this.staticLayer.width = Math.round(box.width * this.dpr);
    this.canvas.height = this.staticLayer.height = Math.round(box.height * this.dpr);
    this.laneH = (this.h - TOP) / TRACKS.length;
    this.drawStatic();
    this.frame(this.lastStep ?? 0);
  }

  x(step) {
    return (step / this.total) * this.w;
  }

  y(track) {
    return TOP + TRACKS.indexOf(track) * this.laneH;
  }

  noteBox(track, note) {
    const x = this.x(note.s);
    const w = Math.max(this.x(note.s + note.d) - x - 1, 1.5);
    const top = this.y(track);
    if (PITCHED.has(track)) {
      const [lo, hi] = this.ranges[track];
      const pad = 5;
      const usable = this.laneH - pad * 2;
      const rowH = usable / (hi - lo + 1);
      const y = top + pad + (hi - note.m) * rowH;
      return { x, y, w, h: Math.max(rowH - 0.5, 2) };
    }
    const h = this.laneH * (0.3 + 0.55 * note.v);
    return { x, y: top + (this.laneH - h) / 2, w: Math.max(w * 0.7, 2), h };
  }

  drawStatic() {
    const g = this.staticLayer.getContext("2d");
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = "#060d24";
    g.fillRect(0, 0, this.w, this.h);
    if (!this.piece) return;
    const { piece } = this;
    const stepsPerBar = piece.stepsPerBar;

    // sections
    piece.sections.forEach((s, i) => {
      const x0 = this.x(s.start * stepsPerBar);
      const x1 = this.x(s.end * stepsPerBar);
      g.fillStyle = s === this.loopSection || s.name === this.loopSection?.name ? "#14306f" : i % 2 ? "#0b1636" : "#091230";
      g.fillRect(x0, TOP, x1 - x0, this.h - TOP);
    });

    // lanes
    TRACKS.forEach((t, i) => {
      g.fillStyle = "#1c2d5c";
      g.fillRect(0, TOP + i * this.laneH, this.w, 1);
    });

    // grid
    for (let bar = 0; bar <= piece.bars; bar++) {
      const x = this.x(bar * stepsPerBar);
      g.fillStyle = bar % 4 === 0 ? "#2a3f7d" : "#16254f";
      g.fillRect(x, RULER, 1, this.h - RULER);
    }

    // ruler
    g.fillStyle = "#0f1c44";
    g.fillRect(0, 0, this.w, RULER);
    g.font = "12px 'Fragment Mono', monospace";
    g.textBaseline = "middle";
    const every = piece.bars > 16 ? 4 : piece.bars > 8 ? 2 : 1;
    for (let bar = 0; bar < piece.bars; bar += every) {
      g.fillStyle = "#b9cdf0";
      g.fillText(String(bar + 1), this.x(bar * stepsPerBar) + 4, RULER / 2 + 1);
    }

    // section chips: click one to loop that section
    this.chips = [];
    piece.sections.forEach((s) => {
      const width = g.measureText(s.name).width + 12;
      const x = this.x(s.start * stepsPerBar) + 24;
      if (x + width > this.x(s.end * stepsPerBar)) return;
      const looping = s.name === this.loopSection?.name;
      g.fillStyle = looping ? "#d9141e" : "#1f3a97";
      g.fillRect(x, 4, width, RULER - 8);
      g.fillStyle = "#fff";
      g.fillText(s.name, x + 6, RULER / 2 + 1);
      this.chips.push({ section: s, x, w: width });
    });

    // chords
    g.fillStyle = "#0a1433";
    g.fillRect(0, RULER, this.w, TOP - RULER);
    g.font = "12px 'Host Grotesk', sans-serif";
    piece.chords.forEach((c) => {
      const x = this.x(c.bar * stepsPerBar);
      const w = this.x(stepsPerBar);
      g.fillStyle = c.slot % 2 ? "#17296a" : "#1f3a97";
      g.fillRect(x + 1, RULER + 4, w - 2, TOP - RULER - 8);
      if (w > 26) {
        g.fillStyle = "#fff";
        g.save();
        g.beginPath();
        g.rect(x + 1, RULER + 4, w - 3, TOP - RULER - 8);
        g.clip();
        g.fillText(c.name, x + 5, (RULER + TOP) / 2 + 1);
        g.restore();
      }
    });

    // notes
    for (const t of TRACKS) {
      g.fillStyle = COLORS[t];
      for (const n of piece.tracks[t] ?? []) {
        const b = this.noteBox(t, n);
        g.globalAlpha = t === "chords" && n.d >= 8 ? 0.38 : 0.45 + 0.55 * n.v;
        g.fillRect(b.x, b.y, b.w, b.h);
      }
    }
    g.globalAlpha = 1;
  }

  frame(step) {
    this.lastStep = step;
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.drawImage(this.staticLayer, 0, 0, this.w, this.h);
    if (!this.piece) return;

    // what's sounding right now, lit up
    for (const t of TRACKS) {
      for (const n of this.piece.tracks[t] ?? []) {
        if (n.s > step) continue;
        if (step < n.s + n.d) {
          const b = this.noteBox(t, n);
          g.fillStyle = "#fff";
          g.shadowColor = "#7cc4ee";
          g.shadowBlur = 8;
          g.fillRect(b.x, b.y, b.w, b.h);
          g.shadowBlur = 0;
        }
      }
    }

    if (this.hovered) {
      const b = this.noteBox(this.hovered.track, this.hovered.note);
      g.strokeStyle = "#ffffff";
      g.lineWidth = 1;
      g.strokeRect(b.x - 1.5, b.y - 1.5, b.w + 3, b.h + 3);
    }
    if (this.selected) {
      const b = this.noteBox(this.selected.track, this.selected.note);
      g.strokeStyle = "#ff4d55";
      g.lineWidth = 2;
      g.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
    }

    const x = this.x(step);
    g.fillStyle = "#d9141e";
    g.fillRect(x - 0.75, 0, 1.5, this.h);
    g.beginPath();
    g.moveTo(x - 6, 0);
    g.lineTo(x + 6, 0);
    g.lineTo(x, 9);
    g.closePath();
    g.fill();
  }

  hit(px, py) {
    if (py < TOP) return null;
    const track = TRACKS[Math.floor((py - TOP) / this.laneH)];
    if (!track) return null;
    let best = null;
    for (const n of this.piece.tracks[track] ?? []) {
      const b = this.noteBox(track, n);
      if (px >= b.x - 2 && px <= b.x + b.w + 2 && py >= b.y - 3 && py <= b.y + b.h + 3) {
        // prefer the shortest note under the pointer, so stabs can be picked over a pad
        if (!best || n.d < best.d) best = n;
      }
    }
    return best ? { track, note: best } : null;
  }

  chipAt(px, py) {
    if (py > RULER) return null;
    return this.chips.find((c) => px >= c.x && px <= c.x + c.w) ?? null;
  }

  place(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  hover(e) {
    if (!this.piece) return;
    const [px, py] = this.place(e);
    const chip = this.chipAt(px, py);
    this.hovered = chip ? null : this.hit(px, py);
    this.canvas.style.cursor = chip || this.hovered ? "pointer" : "crosshair";
  }

  pointer(e) {
    if (!this.piece) return;
    const [px, py] = this.place(e);
    const chip = this.chipAt(px, py);
    if (chip) {
      this.onSection(chip.section);
      return;
    }
    const found = this.hit(px, py);
    if (found) {
      this.selected = found;
      this.onSelect(found);
    } else {
      this.selected = null;
      this.onSelect(null);
      this.onSeek((px / this.w) * this.total);
    }
    this.frame(this.lastStep ?? 0);
  }

  key(e) {
    if (!this.piece) return;
    const bar = this.piece.stepsPerBar;
    if (e.key === "ArrowRight") this.onSeek((this.lastStep ?? 0) + bar);
    else if (e.key === "ArrowLeft") this.onSeek(Math.max(0, (this.lastStep ?? 0) - bar));
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
}

// ---- Circuit view

const GATE_COLOR = { ry: "#1f4ae0", cry: "#1f4ae0", rz: "#0d8fb3", p: "#0d8fb3", z: "#5a6b94", s: "#5a6b94", x: "#5a6b94", inc: "#1f4ae0", dec: "#3858b8", measure: "#eaf1fa" };
const HEAD = 20;
const IDLE = "Read left to right, one line per qubit. Hover over a gate to see what it does.";

const turns = (radians) => {
  const v = Math.round((radians / Math.PI) * 100) / 100;
  return `${v}π`;
};

export class CircuitView {
  constructor(scroller, sizer, canvas, info) {
    this.scroller = scroller;
    this.sizer = sizer;
    this.canvas = canvas;
    this.info = info;
    this.ctx = canvas.getContext("2d");
    this.circuit = null;
    this.highlight = null;
    this.fit = false;
    scroller.addEventListener("scroll", () => this.draw());
    scroller.addEventListener("pointermove", (e) => this.hover(e));
    scroller.addEventListener("pointerleave", () => this.say(null));
    new ResizeObserver(() => this.layout()).observe(scroller);
  }

  setFit(fit) {
    this.fit = fit;
    this.layout();
  }

  set(circuit, highlight = null) {
    this.circuit = circuit;
    this.highlight = highlight;
    const n = circuit.qubits;
    let last = new Array(n).fill(0);
    this.placed = [];
    this.layers = [];
    let current = null;
    for (const g of circuit.gates) {
      if (g.l !== current?.name) {
        // each layer starts in its own column, so the structure is easy to see
        const start = Math.max(...last, current ? current.from + 2 : 0);
        last = new Array(n).fill(start);
        if (current) current.to = start;
        current = { name: g.l, from: start, to: start };
        this.layers.push(current);
      }
      const lo = Math.min(...g.q);
      const hi = Math.max(...g.q);
      let col = 0;
      for (let q = lo; q <= hi; q++) col = Math.max(col, last[q]);
      this.placed.push({ ...g, col, lo, hi });
      for (let q = lo; q <= hi; q++) last[q] = col + 1;
    }
    this.cols = Math.max(...last, current ? current.from + 2 : 1);
    if (current) current.to = this.cols;
    this.layout();
    if (highlight != null && !this.fit) {
      this.scroller.scrollTop = Math.max(0, highlight * this.ROW - this.scroller.clientHeight / 2);
      // jump to where this qubit gets entangled, not its first rotation
      const entangled = this.placed.find((p) => p.q.length > 1 && p.g !== "measure" && p.q.includes(highlight));
      this.scroller.scrollLeft = entangled ? Math.max(0, entangled.col * this.COL - this.scroller.clientWidth / 3) : 0;
    } else {
      this.scroller.scrollTop = 0;
      this.scroller.scrollLeft = 0;
    }
    this.draw();
  }

  layout() {
    if (!this.circuit) return;
    const w = this.scroller.clientWidth;
    const h = this.scroller.clientHeight;
    const n = this.circuit.qubits;
    this.LEFT = this.fit ? 8 : 74;
    if (this.fit) {
      this.ROW = Math.max(1, (h - HEAD - 6) / n);
      this.COL = Math.max(0.5, (w - this.LEFT - 8) / this.cols);
      this.sizer.style.width = "0";
      this.sizer.style.height = "0";
    } else {
      this.ROW = 22;
      this.COL = 34;
      this.sizer.style.width = `${this.LEFT + (this.cols + 2) * this.COL}px`;
      this.sizer.style.height = `${HEAD + n * this.ROW + 16}px`;
    }
    this.draw();
  }

  xOf(col) {
    return this.LEFT + (this.fit ? 0 : 16) + col * this.COL - this.scroller.scrollLeft;
  }

  yOf(q) {
    return HEAD + (this.fit ? this.ROW / 2 + 2 : 14) + q * this.ROW - this.scroller.scrollTop;
  }

  draw() {
    const { canvas, scroller, ctx: g } = this;
    const w = scroller.clientWidth;
    const h = scroller.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!this.circuit) return;
    const { ROW, COL, LEFT, fit } = this;
    const n = this.circuit.qubits;
    const sy = scroller.scrollTop;
    const first = Math.max(0, Math.floor((sy - 20) / ROW));
    const lastQ = Math.min(n - 1, Math.ceil((sy + h) / ROW));

    // wires
    if (!fit) {
      for (let q = first; q <= lastQ; q++) {
        const y = this.yOf(q);
        g.fillStyle = q === this.highlight ? "#ff4d55" : "#2a3f7d";
        g.fillRect(LEFT, y - (q === this.highlight ? 1 : 0.5), w, q === this.highlight ? 2 : 1);
      }
    }

    // gates
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "11px 'Fragment Mono', monospace";
    for (const p of this.placed) {
      const x = this.xOf(p.col);
      if (x < LEFT - COL || x > w + COL || p.hi < first || p.lo > lastQ) continue;
      const color = p.g === "cry" && p.p < 0 ? "#c22e36" : GATE_COLOR[p.g] ?? "#5a6b94";
      if (fit) {
        g.fillStyle = color;
        const bw = Math.max(1, COL * 0.9);
        const y0 = this.yOf(p.lo);
        g.fillRect(x, y0 - Math.max(0.5, ROW * 0.4), bw, this.yOf(p.hi) - y0 + Math.max(1, ROW * 0.8));
        continue;
      }
      const box = (cx, cy, label, fill = color, ink = "#fff") => {
        g.fillStyle = fill;
        g.fillRect(cx - 14, cy - 8, 28, 16);
        g.fillStyle = ink;
        g.fillText(label, cx, cy + 0.5);
      };
      if (p.g === "cry") {
        const [c, t] = p.q;
        g.fillStyle = "#eaf1fa";
        g.fillRect(x - 0.5, this.yOf(Math.min(c, t)), 1, Math.abs(this.yOf(t) - this.yOf(c)));
        g.beginPath();
        g.arc(x, this.yOf(c), 3.5, 0, Math.PI * 2);
        g.fill();
        box(x, this.yOf(t), "Ry");
      } else if (p.g === "inc" || p.g === "dec") {
        const top = this.yOf(p.lo) - 8;
        const bottom = this.yOf(p.hi) + 8;
        g.fillStyle = color;
        g.fillRect(x - 14, top, 28, bottom - top);
        g.fillStyle = "#fff";
        g.fillText(p.g === "inc" ? "+1" : "−1", x, (top + bottom) / 2);
      } else if (p.g === "measure") {
        for (const q of p.q) box(x, this.yOf(q), "M", "#eaf1fa", "#0b1634");
      } else {
        box(x, this.yOf(p.q[0]), p.g === "ry" ? "Ry" : p.g === "rz" ? "Rz" : p.g.toUpperCase());
      }
    }

    // layer names ride along the top
    g.fillStyle = "#0a1433";
    g.fillRect(0, 0, w, HEAD);
    g.textAlign = "left";
    this.layers.forEach((l, i) => {
      const x0 = this.xOf(l.from);
      const x1 = this.xOf(l.to);
      g.fillStyle = i % 2 ? "#1f3a97" : "#17296a";
      g.fillRect(x0 - (fit ? 0 : 14), 2, Math.max(1, x1 - x0), HEAD - 4);
      g.fillStyle = "#fff";
      const label = l.name;
      if (x1 - x0 > g.measureText(label).width + 8) {
        const textX = Math.max(LEFT + 4, x0 - (fit ? 0 : 10));
        if (textX + g.measureText(label).width < x1 - 14) g.fillText(label, textX, HEAD / 2 + 1);
      }
    });

    // labels stay put while the gates scroll
    if (!fit) {
      g.fillStyle = "#0a1433";
      g.fillRect(0, 0, LEFT, h);
      for (let q = first; q <= lastQ; q++) {
        const y = this.yOf(q);
        if (y < HEAD) continue;
        g.fillStyle = q === this.highlight ? "#ff8a90" : "#b9cdf0";
        g.fillText((this.circuit.labels[q] ?? `q${q}`).slice(0, 10), 8, y);
      }
    }
  }

  hover(e) {
    if (!this.circuit) return;
    const r = this.scroller.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const near = this.placed.filter((p) => {
      const x = this.xOf(p.col);
      return this.fit ? px >= x - 1 && px <= x + Math.max(this.COL, 2) : Math.abs(px - x) <= this.COL / 2;
    });
    const row = (py - HEAD - (this.fit ? this.ROW / 2 + 2 : 14) + this.scroller.scrollTop) / this.ROW;
    const gate = near.find((p) => row >= p.lo - 0.5 && row <= p.hi + 0.5);
    this.say(gate);
  }

  say(p) {
    if (!this.info) return;
    if (!p) {
      this.info.textContent = IDLE;
      return;
    }
    const L = this.circuit.labels;
    const name = (q) => L[q] ?? `qubit ${q}`;
    const text = {
      ry: () => `Ry on ${name(p.q[0])}: rotates it by ${turns(p.p)}, which sets its chance of measuring 1.`,
      cry: () => `Controlled Ry: only if ${name(p.q[0])} is 1, rotate ${name(p.q[1])} by ${turns(p.p)}. ${p.p < 0 ? "Red: it lowers the chance." : "Blue: it raises the chance."} This is what entangles them.`,
      rz: () => `Rz on ${name(p.q[0])}: adds a phase of ${turns(p.p)}. On its own this changes nothing you could measure. The next rotation turns it into interference.`,
      p: () => `Phase on ${name(p.q[0])}: ${turns(p.p)}. A phase that grows around the ring pushes the walker one way.`,
      z: () => "Z on the coin: part of the coin flip. Together with the Ry after it, this is a Hadamard at full strength.",
      s: () => "S on the coin: gives the coin its balanced start, so the walk spreads both ways.",
      x: () => `X on ${name(p.q[0])}: sets the walker's starting chord.`,
      inc: () => "Moves the walker one chord forward round the ring, if the coin is 1.",
      dec: () => "Moves the walker one chord back round the ring, if the coin is 0.",
      measure: () => "Measure: each qubit collapses to 0 or 1. These bits are what the music is made from.",
    }[p.g];
    this.info.textContent = text ? text() : p.g;
  }
}
