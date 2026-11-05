import json
import unittest

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

    def test_noise_changes_the_result(self):
        self.assertNotEqual(compose(seed=7)["tracks"]["kick"], compose(seed=7, noise=1.0)["tracks"]["kick"])


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_compose(self):
        r = self.client.post("/api/compose", json={"style": "drift", "key": "C", "bars": 8, "seed": 2})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["bars"], 8)

    def test_bad_input(self):
        for body in ({"style": "nope"}, {"key": "H"}, {"bars": 9}, {"seed": -1}, {"bpm": 900}):
            self.assertEqual(self.client.post("/api/compose", json=body).status_code, 400, body)

    def test_old_download_route_is_gone(self):
        self.assertEqual(self.client.get("/api/download/app.py").status_code, 404)


if __name__ == "__main__":
    unittest.main()
