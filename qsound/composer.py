"""Turns measured bits into a piece of music. Nothing here rolls dice: if a choice isn't fixed by the
style or by music theory, a measured qubit made it. The same parameters and seeds give the same piece."""

import os
import subprocess
import time
from collections import Counter

from . import circuits as qc
from .styles import DEFAULT_STYLE, STYLES
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


def _sections(bars, style):
    plan = style.get("arrangement")
    if plan:
        size = min((k for k in plan if k >= bars), default=max(plan))
        fitted = [(n, a, min(b, bars)) for n, a, b in plan[size] if a < bars]
        fitted[-1] = (fitted[-1][0], fitted[-1][1], bars)
        return fitted
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


def _active(style, section):
    return style.get("active", ACTIVE)[section]


def _bass_midi(style, key, mode, degree):
    octave = style.get("bass_octave", 2)
    midi = degree_to_midi(key, mode, degree, octave)
    if midi > 52 - 12 * (2 - octave):
        midi -= 12
    return midi


def _power_chord(chord, key, mode):
    """Root, fifth and octave, low down, for a distorted guitar. Ring chords always have a perfect fifth."""
    root = degree_to_midi(key, mode, chord["degree"], 2)
    while root > 52:
        root -= 12
    while root < 40:
        root += 12
    fifth = root + (degree_to_midi(key, mode, chord["degree"] + 4, 2) - degree_to_midi(key, mode, chord["degree"], 2))
    return [root, fifth, root + 12]


def _snap(style, mode, degree, up):
    """Moves a scale degree to the nearest pentatonic note in the direction it was going."""
    if style.get("scale") != "pentatonic":
        return degree
    allowed = {0, 2, 3, 4, 6} if triad_quality(mode, 0) == "min" else {0, 1, 2, 4, 5}
    while degree % 7 not in allowed:
        degree += 1 if up else -1
    return degree


def _degree_on_ring(position, mode):
    """The chord for a ring position. A diminished chord is swapped for the next chord round the ring."""
    for i in range(len(RING)):
        degree = RING[(position + i) % len(RING)]
        if triad_quality(mode, degree) in ("maj", "min"):
            return degree
    return 0


def compose_harmony(key, mode, style, entanglement, interference, noise, seed, bars):
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
            circuit, memory = qc.run_walk(i, position, entanglement, interference, noise, walk_seed)
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


def compose_groove(style, entanglement, interference, noise, seed, chords, bars, sections, key, mode):
    circuit, memory = qc.run_groove(style, entanglement, interference, noise, seed)
    crash = None
    if style.get("crash"):
        crash = qc.run_groove(style["crash"], entanglement, interference, noise, seed + 1, "crash", "Crash groove")
    voices = qc.VOICES
    tracks = {"kick": [], "snare": [], "hat": [], "bass": [], "chords": []}

    def q(step, voice):
        return step * len(voices) + voices.index(voice)

    def bar_shot(bar):
        # the main pattern repeats; every fourth bar answers it, and every eighth bar is a fill
        if bar % 8 == 7:
            return 2
        if bar % 4 == 3:
            return 1
        return 0

    vel = {"kick": 1.0, "snare": 0.9, "hat": 0.55}
    pushed = False  # a chord that came in early, on the end of the bar before
    for bar in range(bars):
        section = _section_at(sections, bar)
        active = _active(style, section)
        shot_index = bar_shot(bar)
        in_crash = crash is not None and section == "Crash"
        circuit_id = "crash" if in_crash else "groove"
        shot = qc.bits((crash[1] if in_crash else memory)[shot_index])
        chord = chords[bar]
        next_chord = chords[bar + 1] if bar + 1 < bars else chords[0]
        for step in range(STEPS):
            start = bar * STEPS + step

            def src(voice):
                return {"c": circuit_id, "q": q(step, voice), "shot": shot_index}

            for voice in ("kick", "snare", "hat"):
                if voice in active and shot[q(step, voice)]:
                    accent = 1.0 if step % 4 == 0 else (0.8 if step % 2 == 0 else 0.62)
                    hit = {"s": start, "d": 1, "m": {"kick": 36, "snare": 38, "hat": 42}[voice], "v": round(vel[voice] * accent, 3), "src": src(voice)}
                    # when this step's stab qubit is also 1, the hat opens up, or rolls
                    stab_on = shot[q(step, "stab")]
                    if voice == "hat" and style.get("open_hats") and stab_on and step in (6, 14):
                        hit["o"] = 1
                    tracks[voice].append(hit)
                    if voice == "hat" and style.get("rolls") and stab_on and step % 2 == 1 and accent * style["rolls"] > 0.15:
                        for i, offset in enumerate((0.25, 0.5, 0.75)):
                            tracks["hat"].append({"s": start + offset, "d": 0.25, "m": 42, "v": round(vel["hat"] * (0.55 + 0.12 * i), 3), "src": src("stab")})
            if "bass" in active and shot[q(step, "bass")]:
                stab_on = shot[q(step, "stab")]
                if style.get("bass_moves"):
                    root = _bass_midi(style, key, mode, chord["degree"])
                    if step >= 14 and next_chord["degree"] != chord["degree"]:
                        # walk into the next chord from the scale step below it
                        midi = _bass_midi(style, key, mode, next_chord["degree"] - 1)
                    elif step % 4 == 0 or not stab_on:
                        midi = root
                    elif shot[q(step, "kick")]:
                        midi = root + 12
                    else:
                        midi = _bass_midi(style, key, mode, chord["degree"] + 4)
                else:
                    # the root, unless the stab qubit on this step is also 1: then the fifth
                    midi = _bass_midi(style, key, mode, chord["degree"] + (4 if stab_on and step % 4 else 0))
                tracks["bass"].append({"s": start, "d": 2, "m": midi, "v": 0.9 if step % 4 == 0 else 0.72, "src": src("bass")})

        if "chords" not in active:
            pushed = False
            continue
        record = lambda step: {"c": circuit_id, "q": q(step, "stab"), "shot": shot_index}
        hits = [step for step in range(STEPS) if shot[q(step, "stab")]]
        kind = style["chord_style"]
        if kind == "comp":
            # A held chord underneath, and the rhythm on top. The keys stay on a chord until the next hit,
            # and a hit at the very end of the bar pushes the next chord in early.
            if section in style.get("pad_sections", ()):
                for m in chord["pitches"]:
                    tracks["chords"].append({"s": bar * STEPS, "d": STEPS, "m": m, "v": 0.24, "src": {"c": "harmony", "slot": chord["slot"]}})
            if pushed and 0 in hits:
                hits.remove(0)
            pushed = False
            for i, step in enumerate(hits):
                gap = (hits[i + 1] if i + 1 < len(hits) else STEPS) - step
                push = step >= 14 and bar + 1 < bars and "chords" in _active(style, _section_at(sections, bar + 1))
                pushed = pushed or push
                for m in (next_chord if push else chord)["pitches"]:
                    tracks["chords"].append({"s": bar * STEPS + step, "d": 4 if push else max(1, min(gap, 6)), "m": m,
                                             "v": 0.62 if step % 4 == 0 else 0.52, "src": record(step)})
            continue
        if kind == "hyper":
            for i, step in enumerate(hits):
                gap = (hits[i + 1] if i + 1 < len(hits) else STEPS) - step
                start = bar * STEPS + step
                if section == "Crash":
                    # palm-muted chugs that ring out where there's room
                    for m in _power_chord(chord, key, mode):
                        tracks["chords"].append({"s": start, "d": max(1, min(gap, 3)), "m": m, "v": 0.95 if step % 4 == 0 else 0.78, "x": "gtr", "src": record(step)})
                elif section == "Verse":
                    # just metal: a clang off the top of the chord
                    for m in chord["pitches"][-2:]:
                        tracks["chords"].append({"s": start, "d": 1, "m": m + 12, "v": 0.6 if step % 4 == 0 else 0.46, "x": "metal", "src": record(step)})
                else:
                    # a glitch edit: in a fill bar, the chord stutters in 32nd notes
                    offsets = [o for o in (0, 0.5, 1.0, 1.5) if step + o < STEPS] if shot_index > 0 and step >= 12 else [0]
                    for offset in offsets:
                        for m in chord["pitches"]:
                            tracks["chords"].append({"s": start + offset, "d": 0.5 if len(offsets) > 1 else max(1, min(gap, 3)), "m": m,
                                                     "v": 0.72, "src": record(step)})
            continue
        if kind in ("pad", "keys"):
            for m in chord["pitches"]:
                tracks["chords"].append({"s": bar * STEPS, "d": STEPS, "m": m, "v": 0.55 if kind == "pad" else 0.5, "src": {"c": "harmony", "slot": chord["slot"]}})
        for step in hits:
            if kind == "pad" and step % 4 != 2:
                continue
            length = {"stab": 2, "gate": 1, "pad": 2, "keys": 2}[kind]
            for m in chord["pitches"]:
                tracks["chords"].append({"s": bar * STEPS + step, "d": length, "m": m + (12 if kind == "pad" else 0),
                                         "v": 0.3 if kind in ("pad", "keys") else 0.7, "src": record(step)})

    # each bass note rings until the next one, up to the style's limit, and can slide into it
    limit = style.get("bass_len", 2)
    bass = tracks["bass"]
    for i, note in enumerate(bass):
        following = bass[i + 1]["s"] - note["s"] if i + 1 < len(bass) else limit
        note["d"] = max(1, min(limit, following))
        if style.get("bass_tight") and note["s"] % 2:
            note["d"] = min(note["d"], 2)  # off-beat notes get out of the way, which is most of the pocket
        if style.get("glide") and i and bass[i - 1]["s"] + bass[i - 1]["d"] >= note["s"] and bass[i - 1]["m"] != note["m"]:
            note["g"] = bass[i - 1]["m"]
    return tracks, circuit, memory, crash


# the kind qubits lean toward 1, so the repeats that sound most like a glitch go there
GLITCHES = ["chop", "crush", "stutter", "slice"]
BREAKS = ["tape", "riser", "drop", "tape"]


def compose_glitches(style, entanglement, interference, noise, seed, bars, sections):
    """Where the beat breaks, and how. The arrangement says a section change needs a break; everything
    else comes from measured qubits. Edits never overlap, so each one can be traced to its own qubit."""
    if not style.get("glitch"):
        return [], None, None
    circuit, memory = qc.run_glitch(style, entanglement, interference, noise, seed)
    fx = [{"s": start * STEPS, "d": 0, "kind": "section", "section": name} for name, start, _ in sections]
    busy = 0
    for bar in range(bars):
        section = _section_at(sections, bar)
        after = _section_at(sections, bar + 1) if bar + 1 < bars else sections[0][0]
        flip = after != section
        shot_index = bar % len(memory)
        shot = qc.bits(memory[shot_index])
        for step in range(STEPS):
            start = bar * STEPS + step
            if start < busy:
                continue
            forced = flip and step == 12
            # the first half of a hook bar stays sweet
            if section == "Hook" and step < 8:
                continue
            if not forced and not shot[qc.fire_q(step)]:
                continue
            which = shot[qc.kind_q(step)] * 2 + shot[qc.form_q(step)]
            if forced:
                event = {"s": start, "d": 4, "kind": BREAKS[which], "forced": 1, "src": {"c": "glitch", "q": qc.kind_q(step), "shot": shot_index}}
            else:
                longer = step < STEPS - 1 and shot[qc.fire_q(step + 1)]
                room = (12 if flip else STEPS) - step
                length = min(4 if longer else 2, room)
                if length < 1:
                    continue
                event = {"s": start, "d": length, "kind": GLITCHES[which], "src": {"c": "glitch", "q": qc.fire_q(step), "shot": shot_index}}
            fx.append(event)
            busy = start + event["d"]
    fx.sort(key=lambda e: e["s"])
    return fx, circuit, memory


def compose_melody(style, entanglement, interference, noise, seed, chords, bars, sections, key, mode):
    circuit, memory = qc.run_melody(style, entanglement, interference, noise, seed)
    octave = style["lead_octave"]
    max_len = style["lead_max"]
    low = midi_to_degree(key, mode, degree_to_midi(key, mode, 0, octave) - 7, octave)
    high = low + 10
    lead, arp = [], []

    # A B A C, so the ear gets something to return to
    form = style.get("form", [0, 1, 0, 2])
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
            degree = _snap(style, mode, degree, d)
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
            if style.get("vowels"):
                note["y"] = d * 2 + z
            if _section_at(sections, bar) == style.get("low_voice"):
                note["m"] -= 12  # sung an octave down, so the hook has somewhere to lift to
            if style.get("slide") and last is not None and last["s"] + last["d"] >= start and last["m"] != note["m"]:
                note["g"] = last["m"]
            if "lead" in _active(style, _section_at(sections, bar)):
                if style.get("stutter") and z and step_in_bar % 4 == 3:
                    # a leap on a weak step becomes a ratchet of the same note, jumping an octave at the end
                    lead.append({**note, "d": 0.3})
                    lead.append({**note, "s": start + 0.33, "d": 0.3, "v": 0.6})
                    lead.append({**note, "s": start + 0.66, "d": 0.3, "v": 0.6, "m": note["m"] + 12})
                    last = None
                    continue
                if style.get("runs") and z and step_in_bar % 2:
                    # a vocal run: the note, then two quick steps down the scale
                    run = [degree]
                    for _ in range(2):
                        run.append(_snap(style, mode, run[-1] - 1, False))
                    for i, sung in enumerate(run):
                        part = {**note, "s": start + i * 0.5, "d": 0.5, "m": degree_to_midi(key, mode, sung, octave), "v": round(note["v"] * (1 - 0.1 * i), 3)}
                        if i:
                            part["g"] = lead[-1]["m"]
                        lead.append(part)
                    degree = run[-1]
                    last = lead[-1]
                    continue
                lead.append(note)
                last = note
            else:
                last = None
    if lead:
        # end at rest on a chord tone
        final = lead[-1]
        chord = chords[min(bars - 1, int(final["s"] // STEPS))]
        final["m"] = degree_to_midi(key, mode, chord["tones"][0], octave)
        final["d"] = max(final["d"], min(8, bars * STEPS - final["s"]))

    if style.get("arp"):
        shot = qc.bits(memory[3])
        for bar in range(bars):
            if "arp" not in _active(style, _section_at(sections, bar)):
                continue
            chord = chords[bar]
            tones = sorted(chord["pitches"])
            every = style.get("arp_every", 2)
            for slot in range(0, STEPS, every):
                i = (bar % 2) * STEPS + slot
                if shot[qc.note_q(i)]:
                    index = (shot[qc.dir_q(i)] * 2 + shot[qc.leap_q(i)]) % len(tones)
                    picked = {
                        "s": bar * STEPS + slot, "d": every, "m": tones[index] + style.get("arp_shift", 12), "v": 0.5 if slot % 4 else 0.62,
                        "src": {"c": "melody", "q": qc.note_q(i), "shot": 3},
                    }
                    if style.get("vowels"):
                        picked["y"] = index
                    arp.append(picked)
    return lead, arp, circuit, memory


def _marginals(memory, n):
    """How often each qubit measured 1 across every shot."""
    totals = [0] * n
    for m in memory:
        for i, b in enumerate(qc.bits(m)):
            totals[i] += b
    return [round(t / len(memory), 3) for t in totals]


def compose(style=DEFAULT_STYLE, key="A", mode=None, bpm=None, bars=16, entanglement=0.8, interference=0.5, noise=0.0, seed=1197, seeds=None):
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
    interference = max(0.0, min(1.0, float(interference)))
    noise = max(0.0, min(1.0, float(noise)))
    seed = int(seed)
    seeds = {"harmony": seed, "groove": seed + 1000, "melody": seed + 2000, **(seeds or {})}

    started = time.perf_counter()
    sections = _sections(bars, spec)
    chords, walk_records, walk_steps = compose_harmony(key, mode, spec, entanglement, interference, noise, int(seeds["harmony"]), bars)
    tracks, groove_c, groove_m, crash = compose_groove(spec, entanglement, interference, noise, int(seeds["groove"]), chords, bars, sections, key, mode)
    lead, arp, melody_c, melody_m = compose_melody(spec, entanglement, interference, noise, int(seeds["melody"]), chords, bars, sections, key, mode)
    tracks["lead"] = lead
    tracks["arp"] = arp
    fx, glitch_c, glitch_m = compose_glitches(spec, entanglement, interference, noise, int(seeds["groove"]) + 2, bars, sections)

    groove_record = groove_c.describe(len(groove_m), "matrix_product_state", groove_m, int(seeds["groove"]))
    groove_record["measured"] = _marginals(groove_m, groove_c.qc.num_qubits)
    groove_record["prepared"] = [spec[v][s] for s in range(STEPS) for v in qc.VOICES]
    melody_record = melody_c.describe(len(melody_m), "matrix_product_state", melody_m, int(seeds["melody"]))
    melody_record["measured"] = _marginals(melody_m, melody_c.qc.num_qubits)

    circuit_list = [groove_record, melody_record, *walk_records]
    if crash:
        crash_record = crash[0].describe(len(crash[1]), "matrix_product_state", crash[1], int(seeds["groove"]) + 1)
        crash_record["measured"] = _marginals(crash[1], crash[0].qc.num_qubits)
        crash_record["prepared"] = [spec["crash"][v][s] for s in range(STEPS) for v in qc.VOICES]
        circuit_list.append(crash_record)
    if glitch_c:
        glitch_record = glitch_c.describe(len(glitch_m), "matrix_product_state", glitch_m, int(seeds["groove"]) + 2)
        glitch_record["measured"] = _marginals(glitch_m, glitch_c.qc.num_qubits)
        circuit_list.append(glitch_record)
    elapsed = round(time.perf_counter() - started, 3)
    return {
        "version": 2,
        "params": {"style": style, "key": key, "mode": mode, "bpm": bpm, "bars": bars,
                   "entanglement": entanglement, "interference": interference, "noise": noise, "seed": seed, "seeds": seeds},
        "styleName": spec["name"],
        "bpm": bpm,
        "swing": spec["swing"],
        "bars": bars,
        "stepsPerBar": STEPS,
        "sections": [{"name": n, "start": s, "end": e} for n, s, e in sections],
        "chords": [{k: c[k] for k in ("bar", "slot", "name", "degree", "position", "pitches")} for c in chords],
        "tracks": tracks,
        "fx": fx,
        "circuits": circuit_list,
        "walk": walk_steps,
        "provenance": {
            "backend": "Qiskit Aer simulator",
            "methods": {"groove": "matrix_product_state", "melody": "matrix_product_state", "harmony": "statevector"},
            "noise": noise,
            "entanglement": entanglement,
            "interference": interference,
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
