"""QSound's web app. The server only runs circuits; the browser does all the synthesis."""

import os

from flask import Flask, jsonify, render_template, request

from qsound import compose
from qsound.styles import STYLES
from qsound.theory import KEYS, MODES

app = Flask(__name__)
BARS = (8, 16, 32)


@app.get("/")
def index():
    styles = [{"id": k, "name": v["name"], "blurb": v["blurb"], "bpm": v["bpm"], "mode": v["mode"]} for k, v in STYLES.items()]
    return render_template("index.html", styles=styles, keys=KEYS, modes=list(MODES), bars=BARS)


@app.get("/health")
def health():
    return "ok"


@app.post("/api/compose")
def api_compose():
    data = request.get_json(silent=True) or {}
    try:
        style = data.get("style", "softclub")
        key = data.get("key", "A")
        mode = data.get("mode") or None
        bars = int(data.get("bars", 16))
        bpm = data.get("bpm")
        if style not in STYLES:
            raise ValueError("Unknown style")
        if key not in KEYS:
            raise ValueError("Unknown key")
        if mode is not None and mode not in MODES:
            raise ValueError("Unknown mode")
        if bars not in BARS:
            raise ValueError("Bars must be 8, 16 or 32")
        if bpm is not None and not 50 <= int(bpm) <= 200:
            raise ValueError("Tempo must be between 50 and 200 BPM")
        seed = int(data.get("seed", 1197))
        if not 0 <= seed < 2**31:
            raise ValueError("Seed out of range")
        seeds = data.get("seeds")
        if seeds is not None:
            seeds = {k: int(seeds[k]) for k in ("harmony", "groove", "melody") if k in seeds}
    except (TypeError, ValueError) as e:
        return jsonify({"error": str(e)}), 400

    piece = compose(
        style=style, key=key, mode=mode, bpm=bpm, bars=bars,
        entanglement=float(data.get("entanglement", 0.8)), noise=float(data.get("noise", 0)),
        seed=seed, seeds=seeds,
    )
    return jsonify(piece)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=os.environ.get("PORT") is None, host="0.0.0.0", port=port)
