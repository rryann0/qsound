# QSound

QSound composes music from measured quantum circuits and plays it in your browser. Every drum hit, bass note, chord change and melody note comes from a qubit, and you can click any note to see which one.

Live app: https://qsound.onrender.com (the free server can take a minute to wake; a piece composed earlier plays straight away)

The qubits are simulated with Qiskit Aer. Nothing here runs on quantum hardware yet.

## How the qubits make the music

There are three kinds of circuit, and no random number generator chooses any of the notes.

**Groove (80 qubits).** One qubit for every kick, snare, hat, bass and chord-stab position in a bar. Each qubit is rotated so its chance of measuring 1 matches the style. Controlled rotations then entangle them: a kick makes the bass more likely on the same step, and less likely in a style where the bass sits off the beat. Each measurement shot is a bar, so the bars vary while keeping the same feel.

**Melody (96 qubits).** Three chains of qubits, one step per 16th note: does a note start here, which way does it move, and does it leap. Entangling the direction qubits makes runs. Each shot is a two-bar motif, arranged A B A C so the ear has something to return to.

**Harmony (4 qubits, one circuit per chord).** A coined quantum walk around the circle of fifths. Each chord is where the walk lands, starting from the chord before it. Interference shapes which chords are likely, which you can see in the Chord walk view.

Music theory handles what the qubits don't: staying in key, landing strong beats on chord tones, and moving each chord's voices as little as possible.

## What the controls do

- **Entanglement** scales the entangling gates. Low: each hit is independent and chords step predictably. High: the bass locks to the kick, melodies run and the chords roam. A test in `tests/` checks that this really changes the measured correlation.
- **Decoherence** adds depolarizing noise to the gates. The prepared state stops surviving, so you can hear a groove fall apart.
- **Seed** makes runs reproducible. The same settings and seeds always give the same piece, and the page address names them exactly.
- **Measure one layer again** re-runs only the chords, groove or melody and keeps the rest.

## Sound

All sound is synthesized live with the Web Audio API, with no samples: synthesized drums, FM and subtractive voices, chorus, delay, a generated reverb, sidechain ducking and a master limiter. Each style has its own patches and mix. The same code renders WAV exports offline.

## Exports

- **WAV**: the mix as you've set it
- **MIDI**: one track per part
- **Circuits**: every circuit as OpenQASM 2
- **Record**: the whole piece as JSON, with its seeds, shots, backend and QSound version

## Run it

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Then open http://localhost:5000.

To compose without the browser and save the record and circuits:

```bash
python compose.py --style twostep --key F --seed 42 --out pieces/first
```

Tests:

```bash
python -m unittest discover tests
```

## Layout

```
app.py            Flask server: the page and /api/compose
compose.py        command line composer
qsound/           circuits, composer, music theory, styles
static/js/        synthesizer, arrangement, views and exports
scripts/          renders the logo in Blender
tests/
```

## Credits

Built on [Qiskit](https://www.ibm.com/quantum/qiskit), [Qiskit Aer](https://github.com/Qiskit/qiskit-aer) and [Flask](https://flask.palletsprojects.com/). Type: Krona One (the logo), Host Grotesk and Fragment Mono, all under the SIL Open Font License. Icons adapted from [Lucide](https://lucide.dev/) (ISC).

MIT License.
