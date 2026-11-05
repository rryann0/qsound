"""Just enough music theory: scales, diatonic chords, voicing and chord names."""

NOTE_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
NOTE_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
FLAT_KEYS = {"F", "Bb", "Eb", "Ab", "Db", "Gb"}

MODES = {
    "major": [0, 2, 4, 5, 7, 9, 11],
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
    "mixolydian": [0, 2, 4, 5, 7, 9, 10],
    "phrygian": [0, 1, 3, 5, 7, 8, 10],
    "lydian": [0, 2, 4, 6, 7, 9, 11],
}

KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]


def pitch_class(key):
    names = NOTE_FLAT if key in NOTE_FLAT else NOTE_SHARP
    return names.index(key)


def degree_to_midi(key, mode, degree, octave=4):
    """Scale degree to MIDI note. Degree 0 is the tonic in `octave`; degrees can run past 7 or below 0."""
    scale = MODES[mode]
    oct_shift, step = divmod(degree, 7)
    return 12 * (octave + 1 + oct_shift) + pitch_class(key) + scale[step]


def midi_to_degree(key, mode, midi, octave=4):
    """The nearest scale degree to a MIDI note."""
    best, gap = 0, 999
    for d in range(-21, 29):
        g = abs(degree_to_midi(key, mode, d, octave) - midi)
        if g < gap:
            best, gap = d, g
    return best


def stack(degree, size):
    """Scale degrees of a chord built in thirds."""
    return [degree + 2 * i for i in range(size)]


def triad_quality(mode, degree):
    scale = MODES[mode]
    root = scale[degree % 7]
    third = (scale[(degree + 2) % 7] - root) % 12
    fifth = (scale[(degree + 4) % 7] - root) % 12
    if fifth == 6:
        return "dim"
    if fifth == 8:
        return "aug"
    return "min" if third == 3 else "maj"


def chord_name(key, mode, degree, size):
    """A readable name, worked out from the real intervals: Am7, Fmaj9, G7."""
    names = NOTE_FLAT if key in FLAT_KEYS or (key in NOTE_FLAT and "b" in key) else NOTE_SHARP
    scale = MODES[mode]
    root_pc = (pitch_class(key) + scale[degree % 7]) % 12

    def iv(steps):
        return (scale[(degree + steps) % 7] - scale[degree % 7]) % 12

    quality = triad_quality(mode, degree)
    head = {"min": "m", "maj": "", "dim": "dim", "aug": "aug"}[quality]
    if size < 4:
        return names[root_pc] + head
    seventh = iv(6)
    if quality == "maj" and seventh == 11:
        tail = "maj" + ("9" if size >= 5 else "7")
    else:
        tail = "9" if size >= 5 else "7"
    return names[root_pc] + head + tail


def voice_chord(pcs_degrees, key, mode, previous, low=52, high=76):
    """Place chord tones near the previous voicing so the voices move as little as possible."""
    notes = []
    for d in pcs_degrees:
        pc = degree_to_midi(key, mode, d, 4) % 12
        candidates = [m for m in range(low, high + 1) if m % 12 == pc]
        if previous:
            target = min(candidates, key=lambda m: min(abs(m - p) for p in previous))
        else:
            target = min(candidates, key=lambda m: abs(m - (low + high) / 2))
        notes.append(target)
    voiced = sorted(set(notes))
    # keep the top of the chord open: no stacks of semitones
    for i in range(1, len(voiced)):
        if voiced[i] - voiced[i - 1] == 1 and voiced[i] + 12 <= high:
            voiced[i] += 12
    return sorted(set(voiced))
