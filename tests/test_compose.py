import itertools
import json
import math
import unittest

from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector

from app import app
from qsound import compose
from qsound import circuits
from qsound.styles import STYLES
from qsound.theory import MODES, pitch_class


class ComposeTest(unittest.TestCase):
    def test_same_seed_same_piece(self):
        a, b = compose(seed=7), compose(seed=7)
        self.assertEqual(json.dumps(a["tracks"]), json.dumps(b["tracks"]))
        self.assertNotEqual(json.dumps(a["tracks"]), json.dumps(compose(seed=8)["tracks"]))

    def test_one_layer_can_change_alone(self):
        a = compose(seed=7)
        b = compose(seed=7, seeds={"melody": 99})
        self.assertEqual(a["tracks"]["kick"], b["tracks"]["kick"])
        self.assertEqual(a["chords"], b["chords"])
        self.assertNotEqual(a["tracks"]["lead"], b["tracks"]["lead"])

    def test_pitched_notes_stay_in_key(self):
        for style in STYLES:
            for key in ("A", "Eb", "F#"):
                piece = compose(style=style, key=key, seed=3)
                scale = {(pitch_class(key) + x) % 12 for x in MODES[piece["params"]["mode"]]}
                for track in ("lead", "arp", "chords", "bass"):
                    for note in piece["tracks"][track]:
                        self.assertIn(note["m"] % 12, scale, f"{style} {key} {track}")

    def test_entanglement_locks_the_bass_to_the_kick(self):
        style = STYLES["softclub"]
        step = 4
        kick = step * 5 + circuits.VOICES.index("kick")
        bass = step * 5 + circuits.VOICES.index("bass")

        def together(e):
            c = circuits.groove_circuit(style, e)
            memory = circuits._run(circuits._chain, c, 2000, 5, 0)
            shots = [circuits.bits(m) for m in memory]
            return sum(1 for s in shots if s[kick] and s[bass]) / len(shots)

        self.assertGreater(together(1.0), together(0.0) + 0.3)

    def test_without_interference_the_groove_is_classically_reproducible(self):
        """Ry and controlled-Ry alone match conditional coin flips exactly. This is why the phases exist."""
        ps, thetas = [0.9, 0.3, 0.6, 0.2], [1.2, -0.8, 0.7]
        c = QuantumCircuit(4)
        for i, p in enumerate(ps):
            c.ry(circuits.angle(p), i)
        for i, t in enumerate(thetas):
            c.ry(t / 2, i + 1)
            c.cx(i, i + 1)
            c.ry(-t / 2, i + 1)
            c.cx(i, i + 1)
        quantum = Statevector(c).probabilities_dict()
        for outcome in itertools.product([0, 1], repeat=4):
            chance = 1.0
            for i, bit in enumerate(outcome):
                a = circuits.angle(ps[i]) + (thetas[i - 1] if i and outcome[i - 1] else 0)
                one = math.sin(a / 2) ** 2
                chance *= one if bit else 1 - one
            key = "".join(map(str, reversed(outcome)))
            self.assertAlmostEqual(quantum[key], chance, places=9)

    def test_interference_makes_fringes_that_noise_destroys(self):
        """The melody's direction qubits should swing with the phase, and decoherence should flatten that."""
        style = STYLES["softclub"]

        def swing(noise):
            c = circuits.melody_circuit(style, 0.0, 1.0)
            memory = circuits._run(circuits._chain, c, 1500 if noise == 0 else 150, 11, noise)
            shots = [circuits.bits(m) for m in memory]
            rates = [sum(s[circuits.dir_q(i)] for s in shots) / len(shots) for i in range(circuits.MOTIF_SLOTS)]
            return max(rates) - min(rates)

        self.assertGreater(swing(0), 0.8)
        self.assertLess(swing(1.0), swing(0) - 0.15)

    def test_the_walk_differs_from_a_classical_random_walk(self):
        c = circuits.walk_circuit(1, 0, 1.0, 0.0)
        c.qc.remove_final_measurements()
        quantum = Statevector(c.qc).probabilities([0, 1, 2])
        classical = [0.0] * 8
        classical[0] = 1.0
        for _ in range(circuits.WALK_STEPS):
            classical = [0.5 * classical[(p - 1) % 8] + 0.5 * classical[(p + 1) % 8] for p in range(8)]
        self.assertGreater(0.5 * sum(abs(q - k) for q, k in zip(quantum, classical)), 0.3)

    def test_interference_keeps_the_backbone_of_the_beat(self):
        piece = compose(style="softclub", interference=1.0, seed=4, bars=16)
        on_the_beat = [n for n in piece["tracks"]["kick"] if n["s"] % 4 == 0]
        self.assertGreater(len(on_the_beat), 30)

    def test_noise_changes_the_result(self):
        self.assertNotEqual(compose(seed=7)["tracks"]["kick"], compose(seed=7, noise=1.0)["tracks"]["kick"])


class StyleTest(unittest.TestCase):
    def glitches(self, piece):
        return [f for f in piece["fx"] if f["kind"] != "section"]

    def test_hyperpop_flips_between_sweet_hooks_and_crushed_breakdowns(self):
        piece = compose(style="hyperpop", seed=3)
        self.assertEqual([s["name"] for s in piece["sections"]], ["Verse", "Hook", "Crash", "Hook"])
        crash = piece["sections"][2]
        inside = lambda n: crash["start"] * 16 <= n["s"] < crash["end"] * 16
        self.assertFalse([n for n in piece["tracks"]["lead"] if inside(n)])
        crash_chords = [n for n in piece["tracks"]["chords"] if inside(n)]
        self.assertTrue(crash_chords)
        self.assertTrue(all(n.get("x") == "gtr" for n in crash_chords))
        self.assertTrue(all(n["src"]["c"] == "crash" for n in crash_chords))
        self.assertFalse([n for n in piece["tracks"]["chords"] if not inside(n) and n.get("x") == "gtr"])

    def test_every_glitch_comes_from_a_measured_qubit(self):
        for seed in (3, 11, 40):
            piece = compose(style="hyperpop", seed=seed)
            circuit = next(c for c in piece["circuits"] if c["id"] == "glitch")
            marks = self.glitches(piece)
            self.assertGreater(len(marks), piece["bars"])
            for mark in marks:
                self.assertEqual(mark["src"]["c"], "glitch")
                self.assertLess(mark["src"]["q"], circuit["qubits"])
                if not mark.get("forced") and mark["src"]["shot"] < len(circuit["firstShots"]):
                    self.assertEqual(circuits.bits(circuit["firstShots"][mark["src"]["shot"]])[mark["src"]["q"]], 1)

    def test_glitches_never_overlap(self):
        for bars in (8, 16, 32):
            marks = self.glitches(compose(style="hyperpop", bars=bars, seed=5))
            for a, b in zip(marks, marks[1:]):
                self.assertLessEqual(a["s"] + a["d"], b["s"])
            self.assertLessEqual(marks[-1]["s"] + marks[-1]["d"], bars * 16)

    def test_every_section_change_breaks_the_beat(self):
        piece = compose(style="hyperpop", bars=32, seed=5)
        forced = {f["s"] for f in self.glitches(piece) if f.get("forced")}
        names = piece["sections"]
        for here, after in zip(names, names[1:]):
            if here["name"] != after["name"]:
                self.assertIn(after["start"] * 16 - 4, forced)

    def test_noise_makes_more_glitches(self):
        count = lambda noise: sum(len(self.glitches(compose(style="hyperpop", noise=noise, seed=s))) for s in (5, 36, 67, 98))
        self.assertGreater(count(0.8), count(0))

    def test_only_hyperpop_glitches(self):
        self.assertFalse(compose(style="softclub", seed=3)["fx"])
        self.assertFalse(compose(style="rnb", seed=3)["fx"])

    def test_rnb_has_a_pocket(self):
        piece = compose(style="rnb", seed=3)
        hook = next(s for s in piece["sections"] if s["name"] == "Hook")
        bars = hook["end"] - hook["start"]
        inside = lambda n: hook["start"] * 16 <= n["s"] < hook["end"] * 16
        hits = {n["s"] for n in piece["tracks"]["chords"] if inside(n) and n["d"] < 8}
        self.assertGreaterEqual(len(hits) / bars, 3)
        self.assertGreater(sum(1 for h in hits if h % 4) / len(hits), 0.5)
        bass = [n for n in piece["tracks"]["bass"] if inside(n)]
        self.assertGreater(sum(1 for n in bass if n["s"] % 4) / len(bass), 0.5)
        self.assertGreater(len({n["m"] for n in bass}), 3)

    def test_rnb_pushes_chords_in_early(self):
        pushes = 0
        for seed in (3, 11, 40, 77):
            piece = compose(style="rnb", seed=seed)
            for note in piece["tracks"]["chords"]:
                bar = int(note["s"] // 16)
                if note["s"] % 16 >= 14 and bar + 1 < piece["bars"] and note["m"] in piece["chords"][bar + 1]["pitches"]:
                    pushes += 1
        self.assertGreater(pushes, 0)

    def test_new_styles_run_with_noise_at_every_length(self):
        for style in ("hyperpop", "rnb"):
            for bars in (8, 16, 32):
                piece = compose(style=style, bars=bars, noise=0.6, seed=9)
                self.assertTrue(piece["tracks"]["bass"])

    def test_fractional_notes_never_break_the_ending(self):
        for seed in range(12):
            compose(style="hyperpop", bars=8, seed=seed)
            compose(style="rnb", bars=8, seed=seed)


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_compose(self):
        r = self.client.post("/api/compose", json={"style": "drift", "key": "C", "bars": 8, "seed": 2})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["bars"], 8)

    def test_hyperpop_is_what_you_land_on(self):
        self.assertEqual(next(iter(STYLES)), "hyperpop")
        page = self.client.get("/").get_data(as_text=True)
        first = page[page.index('name="style"'):].split(">")[0]
        self.assertIn('value="hyperpop"', first)
        self.assertIn("checked", first)
        with open("static/demo.json", encoding="utf-8") as f:
            self.assertEqual(json.load(f)["params"]["style"], "hyperpop")

    def test_bad_input(self):
        for body in ({"style": "nope"}, {"key": "H"}, {"bars": 9}, {"seed": -1}, {"bpm": 900}, {"noise": "x"}, {"interference": float("nan")}, {"seeds": 3}):
            self.assertEqual(self.client.post("/api/compose", json=body).status_code, 400, body)

    def test_old_download_route_is_gone(self):
        self.assertEqual(self.client.get("/api/download/app.py").status_code, 404)


if __name__ == "__main__":
    unittest.main()
