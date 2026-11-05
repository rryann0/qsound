// The arrangement: every track drawn from the real note data, with a playhead.

import { TRACKS } from "./engine.js";

export const TOP = 56; // ruler + chord lane, matched by the track headers in CSS
const RULER = 26;
const COLORS = { lead: "#ffffff", arp: "#7cc4ee", chords: "#6f8fff", bass: "#a9c4ff", kick: "#ffffff", snare: "#7cc4ee", hat: "#8fa6c8" };
const PITCHED = new Set(["lead", "arp", "chords", "bass"]);

export class Arrangement {
  constructor(canvas, { onSeek, onSelect }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.staticLayer = document.createElement("canvas");
    this.piece = null;
    this.selected = null;
    this.onSeek = onSeek;
    this.onSelect = onSelect;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    canvas.addEventListener("pointerdown", (e) => this.pointer(e));
    canvas.addEventListener("keydown", (e) => this.key(e));
  }

  setPiece(piece) {
    this.piece = piece;
    this.selected = null;
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
      g.fillStyle = i % 2 ? "#0b1636" : "#091230";
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
    piece.sections.forEach((s) => {
      g.fillStyle = "#7cc4ee";
      const label = s.name;
      const x = this.x(s.end * stepsPerBar) - g.measureText(label).width - 6;
      if (x > this.x(s.start * stepsPerBar) + 28) g.fillText(label, x, RULER / 2 + 1);
    });

    // chords
    g.fillStyle = "#0a1433";
    g.fillRect(0, RULER, this.w, TOP - RULER);
    g.font = "12px 'Host Grotesk', sans-serif";
    piece.chords.forEach((c, i) => {
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
        if (n.s > step) break;
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

  pointer(e) {
    if (!this.piece) return;
    const r = this.canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
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
  }
}

export class CircuitView {
  constructor(scroller, sizer, canvas) {
    this.scroller = scroller;
    this.sizer = sizer;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.circuit = null;
    this.highlight = null;
    scroller.addEventListener("scroll", () => this.draw());
    new ResizeObserver(() => this.draw()).observe(scroller);
  }

  set(circuit, highlight = null) {
    this.circuit = circuit;
    this.highlight = highlight;
    const n = circuit.qubits;
    const last = new Array(n).fill(0);
    this.placed = [];
    for (const g of circuit.gates) {
      const lo = Math.min(...g.q);
      const hi = Math.max(...g.q);
      let col = 0;
      for (let q = lo; q <= hi; q++) col = Math.max(col, last[q]);
      this.placed.push({ ...g, col, lo, hi });
      for (let q = lo; q <= hi; q++) last[q] = col + 1;
    }
    this.cols = Math.max(...last, 1);
    this.ROW = 22;
    this.COL = 34;
    this.LEFT = 74;
    this.sizer.style.width = `${this.LEFT + (this.cols + 2) * this.COL}px`;
    this.sizer.style.height = `${n * this.ROW + 16}px`;
    if (highlight != null) {
      this.scroller.scrollTop = Math.max(0, highlight * this.ROW - this.scroller.clientHeight / 2);
      // jump to where this qubit gets entangled, not its first rotation
      const entangled = this.placed.find((p) => p.q.length > 1 && p.q.includes(highlight));
      this.scroller.scrollLeft = entangled ? Math.max(0, entangled.col * this.COL - this.scroller.clientWidth / 3) : 0;
    } else {
      this.scroller.scrollTop = 0;
      this.scroller.scrollLeft = 0;
    }
    this.draw();
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
    const sx = scroller.scrollLeft;
    const sy = scroller.scrollTop;
    const { ROW, COL, LEFT } = this;
    const yOf = (q) => 14 + q * ROW - sy;
    const xOf = (c) => LEFT + 16 + c * COL - sx;
    const n = this.circuit.qubits;
    const first = Math.max(0, Math.floor((sy - 20) / ROW));
    const lastQ = Math.min(n - 1, Math.ceil((sy + h) / ROW));

    // wires
    for (let q = first; q <= lastQ; q++) {
      const y = yOf(q);
      g.fillStyle = q === this.highlight ? "#ff4d55" : "#2a3f7d";
      g.fillRect(LEFT, y - (q === this.highlight ? 1 : 0.5), w, q === this.highlight ? 2 : 1);
    }

    // gates
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "11px 'Fragment Mono', monospace";
    for (const p of this.placed) {
      const x = xOf(p.col);
      if (x < LEFT - COL || x > w + COL || p.hi < first || p.lo > lastQ) continue;
      const box = (cx, cy, label, fill = "#1f4ae0", bw = 28, bh = 16) => {
        g.fillStyle = fill;
        g.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);
        g.fillStyle = "#fff";
        g.fillText(label, cx, cy + 0.5);
      };
      if (p.g === "cry") {
        const [c, t] = p.q;
        g.fillStyle = "#eaf1fa";
        g.fillRect(x - 0.5, yOf(Math.min(c, t)), 1, Math.abs(yOf(t) - yOf(c)));
        g.beginPath();
        g.arc(x, yOf(c), 3.5, 0, Math.PI * 2);
        g.fill();
        box(x, yOf(t), "Ry", p.p < 0 ? "#b0272f" : "#1f4ae0");
      } else if (p.g === "inc" || p.g === "dec") {
        const top = yOf(p.lo) - 8;
        const bottom = yOf(p.hi) + 8;
        g.fillStyle = p.g === "inc" ? "#1f4ae0" : "#3858b8";
        g.fillRect(x - 14, top, 28, bottom - top);
        g.fillStyle = "#fff";
        g.fillText(p.g === "inc" ? "+1" : "−1", x, (top + bottom) / 2);
      } else if (p.g === "measure") {
        for (const q of p.q) box(x, yOf(q), "M", "#eaf1fa");
        g.fillStyle = "#0b1634";
        for (const q of p.q) g.fillText("M", x, yOf(q) + 0.5);
      } else {
        box(x, yOf(p.q[0]), p.g === "ry" ? "Ry" : p.g.toUpperCase());
      }
    }

    // labels stay put while the gates scroll
    g.fillStyle = "#0a1433";
    g.fillRect(0, 0, LEFT, h);
    g.textAlign = "left";
    for (let q = first; q <= lastQ; q++) {
      g.fillStyle = q === this.highlight ? "#ff8a90" : "#b9cdf0";
      g.fillText((this.circuit.labels[q] ?? `q${q}`).slice(0, 10), 8, yOf(q));
    }
  }
}
