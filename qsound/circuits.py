"""The quantum part. Up to four kinds of circuit decide everything the music does.

groove:  one qubit per drum, bass or chord hit in a bar. Each qubit is rotated so its chance of
         measuring 1 matches the style, entangled so hits depend on each other, then given a phase
         and mixed again, so amplitudes interfere. Each shot is a bar.
melody:  three qubits per 16th note: does a note start, which way it moves, how far. The same three
         layers, and here the interference fringes shape the melody's arcs. Each shot is a two-bar motif.
harmony: a coined quantum walk around the circle of fifths. Each measured position is the next chord.
glitch:  in styles that break their own beat, three qubits per 16th note: does it break here, and how.

The interference layer matters. A circuit of only Ry and controlled-Ry gates, where no qubit is rotated
after it has acted as a control, gives exactly the statistics of ordinary conditional coin flips. Phases
followed by another rotation are what make the results impossible to get that way.
"""

import math

from qiskit import QuantumCircuit, qasm2
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, depolarizing_error

# Order matters: every entangling gate joins neighbors, which keeps the chain simulator fast.
VOICES = ["bass", "kick", "snare", "hat", "stab"]
STEPS = 16
MOTIF_SLOTS = 32
WALK_POSITIONS = 8
WALK_STEPS = 5  # at 3 steps a quantum walk on this ring still matches a classical one exactly

# How far each kind of qubit gets mixed in the interference layer, at full strength. Small for the
# backbone of the beat, so it keeps its shape; larger where ghost notes can come and go.
MIX = {"kick": 0.24, "snare": 0.24, "bass": 0.42, "hat": 0.6, "stab": 0.55}

_chain = AerSimulator(method="matrix_product_state", max_parallel_threads=1)
_state = AerSimulator(method="statevector", max_parallel_threads=1)


def angle(p):
    """The RY angle that makes a qubit measure 1 with probability p."""
    return 2 * math.asin(math.sqrt(max(0.0, min(1.0, p))))


class Circuit:
    """A QuantumCircuit plus a record of its gates and qubit labels, so the app can draw and trace it."""

    def __init__(self, id_, name, n, labels):
        self.id = id_
        self.name = name
        self.qc = QuantumCircuit(n, n)
        self.labels = labels
        self.gates = []
        self.layer = None

    def _log(self, name, qubits, param=None):
        g = {"g": name, "q": qubits, "l": self.layer}
        if param is not None:
            g["p"] = round(param, 4)
        self.gates.append(g)

    def ry(self, theta, q):
        self.qc.ry(theta, q)
        self._log("ry", [q], theta)

    def rz(self, theta, q):
        self.qc.rz(theta, q)
        self._log("rz", [q], theta)

    def cry(self, theta, c, t):
        """Controlled rotation, built from gates the chain simulator accepts."""
        self.qc.ry(theta / 2, t)
        self.qc.cx(c, t)
        self.qc.ry(-theta / 2, t)
        self.qc.cx(c, t)
        self._log("cry", [c, t], theta)

    def measure_all(self):
        self.layer = "Measure"
        self.qc.measure(range(self.qc.num_qubits), range(self.qc.num_qubits))
        self._log("measure", list(range(self.qc.num_qubits)))

    def describe(self, shots, method, memory, seed):
        ops = self.qc.count_ops()
        return {
            "id": self.id,
            "name": self.name,
            "qubits": self.qc.num_qubits,
            "labels": self.labels,
            "gates": self.gates,
            "shots": shots,
            "method": method,
            "seed": seed,
            "depth": self.qc.depth(),
            "gateCounts": {k: int(v) for k, v in ops.items()},
            "firstShots": memory[:8],
            "qasm": qasm2.dumps(self.qc),
        }


def noise_model(level):
    """Depolarizing noise that scales with `level` (0 to 1). More noise, less of the prepared state survives."""
    if level <= 0:
        return None
    model = NoiseModel()
    model.add_all_qubit_quantum_error(depolarizing_error(min(0.25, level * 0.12), 1), ["ry", "rz", "p"])
    model.add_all_qubit_quantum_error(depolarizing_error(min(0.45, level * 0.3), 2), ["cx"])
    return model


def _run(sim, circuit, shots, seed, noise):
    opts = {"shots": shots, "memory": True, "seed_simulator": seed}
    model = noise_model(noise)
    if model is not None:
        opts["noise_model"] = model
    result = sim.run(circuit.qc, **opts).result()
    if not result.success:
        raise RuntimeError(f"Circuit {circuit.id} failed: {result.status}")
    return result.get_memory(0)


def bits(shot):
    """A measured bitstring as a list indexed by qubit. Qiskit prints qubit 0 last."""
    return [int(c) for c in reversed(shot)]


def note_q(slot):
    return slot


def dir_q(slot):
    return MOTIF_SLOTS + slot


def leap_q(slot):
    return 2 * MOTIF_SLOTS + slot


def fire_q(step):
    return step


def kind_q(step):
    return STEPS + step


def form_q(step):
    return 2 * STEPS + step


def groove_circuit(style, entanglement, interference=0.0, id_="groove", name="Groove"):
    labels = [f"{v} {s + 1}" for s in range(STEPS) for v in VOICES]
    circuit = Circuit(id_, name, STEPS * len(VOICES), labels)

    def q(step, voice):
        return step * len(VOICES) + VOICES.index(voice)

    circuit.layer = "Prepare"
    for step in range(STEPS):
        for voice in VOICES:
            circuit.ry(angle(style[voice][step]), q(step, voice))

    circuit.layer = "Entangle"
    lock = style["lock"]
    for step in range(STEPS):
        circuit.cry(entanglement * lock["kick_bass"], q(step, "kick"), q(step, "bass"))
        circuit.cry(entanglement * lock["kick_snare"], q(step, "kick"), q(step, "snare"))
        circuit.cry(entanglement * lock["snare_hat"], q(step, "snare"), q(step, "hat"))
        circuit.cry(entanglement * lock["hat_stab"], q(step, "hat"), q(step, "stab"))
        if step < STEPS - 1:
            circuit.cry(entanglement * lock["stab_kick"], q(step, "stab"), q(step + 1, "bass"))

    if interference > 0:
        circuit.layer = "Interfere"
        # the phase winds along the bar, so hits move in and out of step with it
        turns = 2 + 6 * interference
        for step in range(STEPS):
            for voice in VOICES:
                circuit.rz(2 * math.pi * turns * step / STEPS, q(step, voice))
                circuit.ry(interference * MIX[voice], q(step, voice))
    circuit.measure_all()
    return circuit


def melody_circuit(style, entanglement, interference=0.0):
    # Three neighbor chains in a row: all the note qubits, then direction, then leap.
    labels = [f"{w} {s + 1}" for w in ("note", "dir", "leap") for s in range(MOTIF_SLOTS)]
    circuit = Circuit("melody", "Melody", MOTIF_SLOTS * 3, labels)
    rhythm = style["lead"]

    circuit.layer = "Prepare"
    for s in range(MOTIF_SLOTS):
        circuit.ry(angle(rhythm[s % STEPS]), note_q(s))
        circuit.ry(math.pi / 2, dir_q(s))
        circuit.ry(angle(0.26), leap_q(s))

    circuit.layer = "Entangle"
    for s in range(MOTIF_SLOTS - 1):
        # a note makes the next step less likely to start one
        circuit.cry(-entanglement * 0.9, note_q(s), note_q(s + 1))
        # direction tends to carry on, which makes runs
        circuit.cry(entanglement * 1.1, dir_q(s), dir_q(s + 1))
        # a leap makes another leap less likely
        circuit.cry(-entanglement * 0.8, leap_q(s), leap_q(s + 1))

    if interference > 0:
        circuit.layer = "Interfere"
        # A Ramsey experiment: direction qubits start balanced, so the fringes here have full contrast.
        # As the phase winds, notes tend upward, then downward. That is the melody's arc.
        turns = 1 + 2 * interference
        for s in range(MOTIF_SLOTS):
            phase = 2 * math.pi * turns * s / MOTIF_SLOTS
            circuit.rz(phase, dir_q(s))
            circuit.ry(interference * math.pi / 2, dir_q(s))
            circuit.rz(phase, note_q(s))
            circuit.ry(interference * 0.5, note_q(s))
    circuit.measure_all()
    return circuit


def glitch_circuit(style, entanglement, interference=0.0):
    """One bar of edits, in three neighbor chains: where the beat breaks, then two qubits for how."""
    labels = [f"{w} {s + 1}" for w in ("glitch", "kind", "form") for s in range(STEPS)]
    circuit = Circuit("glitch", "Glitch", STEPS * 3, labels)
    chance = style["glitch"]

    circuit.layer = "Prepare"
    for s in range(STEPS):
        circuit.ry(angle(chance[s]), fire_q(s))
        circuit.ry(math.pi / 2, kind_q(s))
        circuit.ry(math.pi / 2, form_q(s))

    circuit.layer = "Entangle"
    for s in range(STEPS - 1):
        # a glitch tends to run on into the next step, which makes it longer
        circuit.cry(entanglement * 0.9, fire_q(s), fire_q(s + 1))
        # one kind of edit tends to carry on, and its form tends to change
        circuit.cry(entanglement * 1.1, kind_q(s), kind_q(s + 1))
        circuit.cry(-entanglement * 0.8, form_q(s), form_q(s + 1))

    if interference > 0:
        circuit.layer = "Interfere"
        turns = 1 + 3 * interference
        for s in range(STEPS):
            phase = 2 * math.pi * turns * s / STEPS
            circuit.rz(phase, kind_q(s))
            circuit.ry(interference * math.pi / 2, kind_q(s))
            circuit.rz(phase, fire_q(s))
            circuit.ry(interference * 0.35, fire_q(s))
    circuit.measure_all()
    return circuit


def walk_circuit(index, start, entanglement, interference=0.0):
    """A coined quantum walk on a ring of chords, starting from the chord before this one."""
    position_qubits = 3
    labels = [f"position {i}" for i in range(position_qubits)] + ["coin"]
    circuit = Circuit(f"harmony-{index}", f"Harmony walk {index + 1}", position_qubits + 1, labels)
    qc = circuit.qc
    coin = position_qubits
    for b in range(position_qubits):
        if (start >> b) & 1:
            qc.x(b)
            circuit._log("x", [b])
    circuit.layer = "Start"
    # Start the coin balanced, so the walk spreads both ways round the ring.
    qc.ry(math.pi / 2, coin)
    qc.s(coin)
    circuit._log("ry", [coin], math.pi / 2)
    circuit._log("s", [coin])
    # At full strength this coin is a Hadamard. Weaker, the walk mixes less and keeps its direction.
    theta = entanglement * math.pi / 2
    # A phase that grows round the ring pushes the walker's wave one way, like a field on a particle.
    ramp = interference * 1.6
    for step in range(WALK_STEPS):
        circuit.layer = f"Step {step + 1}"
        if ramp > 0:
            for b in range(position_qubits):
                qc.p(ramp * 2**b, b)
                circuit._log("p", [b], ramp * 2**b)
        qc.z(coin)
        qc.ry(theta, coin)
        circuit._log("z", [coin])
        circuit._log("ry", [coin], theta)
        # move forward if the coin is 1
        qc.mcx([coin, 0, 1], 2)
        qc.ccx(coin, 0, 1)
        qc.cx(coin, 0)
        circuit._log("inc", [coin, 0, 1, 2])
        # move back if the coin is 0
        qc.x(coin)
        qc.cx(coin, 0)
        qc.ccx(coin, 0, 1)
        qc.mcx([coin, 0, 1], 2)
        qc.x(coin)
        circuit._log("dec", [coin, 0, 1, 2])
    circuit.layer = "Measure"
    qc.measure(range(position_qubits), range(position_qubits))
    circuit._log("measure", list(range(position_qubits)))
    return circuit


def _shots(clean, noise):
    """Noisy runs resimulate the circuit for every shot, so they take fewer."""
    return 10 if noise > 0 else clean


def run_groove(style, entanglement, interference, noise, seed, id_="groove", name="Groove"):
    circuit = groove_circuit(style, entanglement, interference, id_, name)
    return circuit, _run(_chain, circuit, _shots(64, noise), seed, noise)


def run_melody(style, entanglement, interference, noise, seed):
    circuit = melody_circuit(style, entanglement, interference)
    return circuit, _run(_chain, circuit, _shots(32, noise), seed, noise)


def run_glitch(style, entanglement, interference, noise, seed):
    circuit = glitch_circuit(style, entanglement, interference)
    return circuit, _run(_chain, circuit, _shots(32, noise), seed, noise)


def run_walk(index, start, entanglement, interference, noise, seed):
    circuit = walk_circuit(index, start, entanglement, interference)
    return circuit, _run(_state, circuit, _shots(64, noise), seed, noise)
