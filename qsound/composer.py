"""Turns measured bits into a piece of music. Nothing here rolls dice: if a choice isn't fixed by the
style or by music theory, a measured qubit made it. The same parameters and seeds give the same piece."""

import os
import subprocess
import time
from collections import Counter

from . import circuits as qc
from .styles import STYLES
from .theory import MODES, chord_name, degree_to_midi, midi_to_degree, stack, triad_quality, voice_chord

STEPS = qc.STEPS
RING = [0, 3, 6, 2, 5, 1, 4, 0]  # scale degrees around the circle of fifths; the tonic closes the ring


def _version():
    env = os.environ.get("RENDER_GIT_COMMIT")
    if env:
        return env[:7]
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=2,
            cwd=os.path.dirname(__file__),
        ).stdout.strip() or "dev"
    except Exception:
        return "dev"


VERSION = _version()


def _sections(bars):
    if bars <= 8:
        return [("Intro", 0, 1), ("Main", 1, bars)]
    if bars <= 16:
        return [("Intro", 0, 4), ("Build", 4, 8), ("Main", 8, bars)]
    return [("Intro", 0, 4), ("Build", 4, 8), ("Main", 8, 16), ("Break", 16, 20), ("Peak", 20, bars - 4), ("Outro", bars - 4, bars)]


def _section_at(sections, bar):
    for name, start, end in sections:
        if start <= bar < end:
            return name
    return sections[-1][0]


ACTIVE = {
    "Intro": {"chords", "hat", "arp"},
    "Build": {"chords", "hat", "arp", "kick", "bass"},
    "Main": {"chords", "hat", "arp", "kick", "bass", "snare", "lead"},
    "Break": {"chords", "lead", "arp"},
    "Peak": {"chords", "hat", "arp", "kick", "bass", "snare", "lead"},
    "Outro": {"chords", "hat", "kick", "bass"},
}


def _degree_on_ring(position, mode):
    """The chord for a ring position. A diminished chord is swapped for the next chord round the ring."""
    for i in range(len(RING)):
        degree = RING[(position + i) % len(RING)]
        if triad_quality(mode, degree) in ("maj", "min"):
            return degree
    return 0


def compose_harmony(key, mode, style, entanglement, noise, seed, bars):
    """Walks the ring for two four-bar progressions, used in turn. Each one starts on the home chord,
    and each later chord is the first measured outcome that moves away from the chord before it."""
    size = style["chord_size"]
    position = 0
    progression, records, steps = [], [], []
    voicing = None
    for i in range(8):
        walk_seed = seed + i
        if i in (0, 4):
            position, shot_used, counts = 0, None, None
        else:
            circuit, memory = qc.run_walk(i, position, entanglement, noise, walk_seed)
            records.append(circuit.describe(len(memory), "statevector", memory, walk_seed))
            tally = Counter(int(m, 2) for m in memory)
            counts = [tally.get(p, 0) for p in range(qc.WALK_POSITIONS)]
            previous = progression[-1]["degree"]
            shot_used = 0
            for k, m in enumerate(memory):
                if _degree_on_ring(int(m, 2), mode) != previous:
                    shot_used = k
                    break
            position = int(memory[shot_used], 2)
        degree = _degree_on_ring(position, mode)
        tones = stack(degree, size)
        voicing = voice_chord(tones, key, mode, voicing)
        name = chord_name(key, mode, degree, size)
        progression.append({"slot": i, "degree": degree, "position": position, "name": name, "tones": tones, "pitches": voicing})
        steps.append({"slot": i, "chord": name, "position": position, "shot": shot_used, "counts": counts,
                      "ring": [chord_name(key, mode, _degree_on_ring(p, mode), size) for p in range(qc.WALK_POSITIONS)]})
    chords = [{"bar": bar, **progression[bar % 8]} for bar in range(bars)]
    return chords, records, steps


def compose_groove(style, entanglement, noise, seed, chords, bars, sections, key, mode):
    circuit, memory = qc.run_groove(style, entanglement, noise, seed)
    voices = qc.VOICES
    tracks = {"kick": [], "snare": [], "hat": [], "bass": [], "chords": []}

    def bar_shot(bar):
        # the main pattern repeats; every fourth bar answers it, and every eighth bar is a fill
        if bar % 8 == 7:
            return 2
        if bar % 4 == 3:
            return 1
        return 0

    vel = {"kick": 1.0, "snare": 0.9, "hat": 0.55}
    for bar in range(bars):
        section = _section_at(sections, bar)
        active = ACTIVE[section]
        shot_index = bar_shot(bar)
        shot = qc.bits(memory[shot_index])
        chord = chords[bar]
        for step in range(STEPS):
            start = bar * STEPS + step

            def src(voice):
                return {"c": "groove", "q": step * len(voices) + voices.index(voice), "shot": shot_index}

            for voice in ("kick", "snare", "hat"):
                if voice in active and shot[step * len(voices) + voices.index(voice)]:
                    accent = 1.0 if step % 4 == 0 else (0.8 if step % 2 == 0 else 0.62)
                    tracks[voice].append({"s": start, "d": 1, "m": {"kick": 36, "snare": 38, "hat": 42}[voice], "v": round(vel[voice] * accent, 3), "src": src(voice)})
            if "bass" in active and shot[step * len(voices) + voices.index("bass")]:
                # the root, unless the stab qubit on this step is also 1: then the fifth
                degree = chord["degree"] + (4 if shot[step * len(voices) + voices.index("stab")] and step % 4 else 0)
                midi = degree_to_midi(key, mode, degree, 2)
                if midi > 52:
                    midi -= 12
                tracks["bass"].append({"s": start, "d": 2, "m": midi, "v": 0.9 if step % 4 == 0 else 0.72, "src": src("bass")})

        if "chords" not in active:
            continue
        if style["chord_style"] == "pad":
            for m in chord["pitches"]:
                tracks["chords"].append({"s": bar * STEPS, "d": STEPS, "m": m, "v": 0.55, "src": {"c": "harmony", "slot": chord["slot"]}})
        for step in range(STEPS):
            if shot[step * len(voices) + voices.index("stab")] and (style["chord_style"] != "pad" or step % 4 == 2):
                length = {"stab": 2, "gate": 1, "pad": 2}[style["chord_style"]]
                for m in chord["pitches"]:
                    tracks["chords"].append({
                        "s": bar * STEPS + step, "d": length, "m": m + (12 if style["chord_style"] == "pad" else 0),
                        "v": 0.7 if style["chord_style"] != "pad" else 0.3,
                        "src": {"c": "groove", "q": step * len(voices) + voices.index("stab"), "shot": shot_index},
                    })
    return tracks, circuit, memory


def compose_melody(style, entanglement, noise, seed, chords, bars, sections, key, mode):
    circuit, memory = qc.run_melody(style, entanglement, noise, seed)
    octave = style["lead_octave"]
    max_len = style["lead_max"]
    low = midi_to_degree(key, mode, degree_to_midi(key, mode, 0, octave) - 7, octave)
    high = low + 10
    lead, arp = [], []

    # A B A C, so the ear gets something to return to
    form = [0, 1, 0, 2]
    degree = 2
    last = None
    for phrase_start in range(0, bars, 2):
        shot_index = form[(phrase_start // 2) % len(form)]
        shot = qc.bits(memory[shot_index])
        section = _section_at(sections, phrase_start)
        for slot in range(qc.MOTIF_SLOTS):
            bar = phrase_start + slot // STEPS
            if bar >= bars:
                break
            chord = chords[bar]
            n, d, z = shot[qc.note_q(slot)], shot[qc.dir_q(slot)], shot[qc.leap_q(slot)]
            if not n:
                continue
            degree += (1 if d else -1) * (3 if z else 1)
            while degree > high:
                degree -= 7
            while degree < low:
                degree += 7
            step_in_bar = slot % STEPS
            if step_in_bar % 8 == 0:
                # strong beats land on a chord tone
                tones = [t + 7 * o for t in chord["tones"][:4] for o in range(-3, 4)]
                degree = min(tones, key=lambda t: abs(t - degree))
            start = bar * STEPS + step_in_bar
            if last is not None:
                last["d"] = max(1, min(max_len, start - last["s"]))
            note = {
                "s": start, "d": max_len, "m": degree_to_midi(key, mode, degree, octave),
                "v": 0.85 if step_in_bar % 4 == 0 else 0.66,
                "src": {"c": "melody", "q": qc.note_q(slot), "shot": shot_index},
            }
            if "lead" in ACTIVE[_section_at(sections, bar)]:
                lead.append(note)
                last = note
            else:
                last = None
    if lead:
        # end at rest on a chord tone
        final = lead[-1]
        chord = chords[min(bars - 1, final["s"] // STEPS)]
        final["m"] = degree_to_midi(key, mode, chord["tones"][0], octave)
        final["d"] = max(final["d"], min(8, bars * STEPS - final["s"]))

    if style.get("arp"):
        shot = qc.bits(memory[3])
        for bar in range(bars):
            if "arp" not in ACTIVE[_section_at(sections, bar)]:
                continue
            chord = chords[bar]
            tones = sorted(chord["pitches"])
            for slot in range(0, STEPS, 2):
                i = (bar % 2) * STEPS + slot
                if shot[qc.note_q(i)]:
                    index = (shot[qc.dir_q(i)] * 2 + shot[qc.leap_q(i)]) % len(tones)
                    arp.append({
                        "s": bar * STEPS + slot, "d": 2, "m": tones[index] + 12, "v": 0.5 if slot % 4 else 0.62,
                        "src": {"c": "melody", "q": qc.note_q(i), "shot": 3},
                    })
    return lead, arp, circuit, memory


def _marginals(memory, n):
    """How often each qubit measured 1 across every shot."""
    totals = [0] * n
    for m in memory:
        for i, b in enumerate(qc.bits(m)):
            totals[i] += b
    return [round(t / len(memory), 3) for t in totals]


def compose(style="softclub", key="A", mode=None, bpm=None, bars=16, entanglement=0.8, noise=0.0, seed=1197, seeds=None):
    """Compose a piece. Seeds for each layer can be given separately, so one layer can be re-measured alone."""
    if style not in STYLES:
        raise ValueError(f"Unknown style: {style}")
    spec = STYLES[style]
    mode = mode or spec["mode"]
    if mode not in MODES:
        raise ValueError(f"Unknown mode: {mode}")
    bpm = int(bpm or spec["bpm"])
    bars = int(bars)
    entanglement = max(0.0, min(1.0, float(entanglement)))
    noise = max(0.0, min(1.0, float(noise)))
    seed = int(seed)
    seeds = {"harmony": seed, "groove": seed + 1000, "melody": seed + 2000, **(seeds or {})}

    started = time.perf_counter()
    sections = _sections(bars)
    chords, walk_records, walk_steps = compose_harmony(key, mode, spec, entanglement, noise, int(seeds["harmony"]), bars)
    tracks, groove_c, groove_m = compose_groove(spec, entanglement, noise, int(seeds["groove"]), chords, bars, sections, key, mode)
    lead, arp, melody_c, melody_m = compose_melody(spec, entanglement, noise, int(seeds["melody"]), chords, bars, sections, key, mode)
    tracks["lead"] = lead
    tracks["arp"] = arp

    groove_record = groove_c.describe(len(groove_m), "matrix_product_state", groove_m, int(seeds["groove"]))
    groove_record["measured"] = _marginals(groove_m, groove_c.qc.num_qubits)
    groove_record["prepared"] = [spec[v][s] for s in range(STEPS) for v in qc.VOICES]
    melody_record = melody_c.describe(len(melody_m), "matrix_product_state", melody_m, int(seeds["melody"]))
    melody_record["measured"] = _marginals(melody_m, melody_c.qc.num_qubits)

    circuit_list = [groove_record, melody_record, *walk_records]
    elapsed = round(time.perf_counter() - started, 3)
    return {
        "version": 2,
        "params": {"style": style, "key": key, "mode": mode, "bpm": bpm, "bars": bars,
                   "entanglement": entanglement, "noise": noise, "seed": seed, "seeds": seeds},
        "styleName": spec["name"],
        "bpm": bpm,
        "swing": spec["swing"],
        "bars": bars,
        "stepsPerBar": STEPS,
        "sections": [{"name": n, "start": s, "end": e} for n, s, e in sections],
        "chords": [{k: c[k] for k in ("bar", "slot", "name", "degree", "position", "pitches")} for c in chords],
        "tracks": tracks,
        "circuits": circuit_list,
        "walk": walk_steps,
        "provenance": {
            "backend": "Qiskit Aer simulator",
            "methods": {"groove": "matrix_product_state", "melody": "matrix_product_state", "harmony": "statevector"},
            "noise": noise,
            "entanglement": entanglement,
            "seeds": seeds,
            "totalQubits": sum(c["qubits"] for c in circuit_list),
            "circuits": len(circuit_list),
            "shots": {c["id"]: c["shots"] for c in circuit_list},
            "qsoundVersion": VERSION,
            "madeAt": time.strftime("%Y-%m-%d", time.gmtime()),
            "computeSeconds": elapsed,
            "note": "Simulated qubits, not quantum hardware.",
        },
    }
