"""QSound's web app. The server only runs circuits; the browser does all the synthesis."""

import math
import os

from flask import Flask, jsonify, redirect, render_template, request, url_for

from qsound import compose
from qsound.styles import STYLES
from qsound.theory import KEYS, MODES

app = Flask(__name__)
BARS = (8, 16, 32)
STYLE_LIST = [{"id": k, "name": v["name"], "blurb": v["blurb"], "bpm": v["bpm"], "mode": v["mode"]} for k, v in STYLES.items()]
MAX_SEED = 2**31


def _unit(data, name, default):
    """A number from 0 to 1."""
    value = float(data.get(name, default))
    if not math.isfinite(value):
        raise ValueError(f"{name} must be a number")
    return max(0.0, min(1.0, value))


@app.get("/")
def index():
    return render_template("index.html", styles=STYLE_LIST, keys=KEYS, modes=list(MODES), bars=BARS)


@app.get("/guide")
def guide():
    return render_template("guide.html", styles=STYLE_LIST)


@app.get("/favicon.ico")
def favicon():
    return redirect(url_for("static", filename="img/favicon.png"))


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
        if not 0 <= seed < MAX_SEED:
            raise ValueError("Seed out of range")
        seeds = data.get("seeds")
        if seeds is not None:
            seeds = {k: int(seeds[k]) % MAX_SEED for k in ("harmony", "groove", "melody") if k in seeds}
        entanglement = _unit(data, "entanglement", 0.8)
        interference = _unit(data, "interference", 0.5)
        noise = _unit(data, "noise", 0)
    except (TypeError, ValueError, AttributeError) as e:
        return jsonify({"error": str(e)}), 400

    piece = compose(
        style=style, key=key, mode=mode, bpm=bpm, bars=bars,
        entanglement=entanglement, interference=interference, noise=noise,
        seed=seed, seeds=seeds,
    )
    return jsonify(piece)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=os.environ.get("PORT") is None, host="0.0.0.0", port=port)
