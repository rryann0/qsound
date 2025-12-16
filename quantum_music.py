"""
Quantum Music Generator
Generates music using quantum computing principles
"""

import numpy as np
from qiskit import QuantumCircuit, QuantumRegister, ClassicalRegister
from music21 import stream, note, tempo, meter, key, scale
import random

try:
    from qiskit_aer import AerSimulator
except ImportError:
    raise ImportError(
        "qiskit-aer is required. Please install it with: pip install qiskit-aer"
    )


class QuantumMusicGenerator:
    """Generate music using quantum circuits"""
    
    def __init__(self, num_qubits=8):
        """
        Initialize the quantum music generator
        
        Args:
            num_qubits: Number of qubits to use (more qubits = more musical possibilities)
        """
        self.num_qubits = num_qubits
        self.simulator = AerSimulator()
        
        # Musical scales for mapping quantum states
        self.major_scale = [0, 2, 4, 5, 7, 9, 11]  # C major scale intervals
        self.minor_scale = [0, 2, 3, 5, 7, 8, 10]  # A minor scale intervals
        self.chromatic_scale = list(range(12))  # All 12 semitones
        
    def create_entangled_melody_circuit(self, num_notes=16):
        """
        Create a quantum circuit that uses entanglement to generate correlated musical patterns
        
        Args:
            num_notes: Number of musical notes to generate
            
        Returns:
            QuantumCircuit: The quantum circuit
        """
        qreg = QuantumRegister(self.num_qubits, 'q')
        creg = ClassicalRegister(self.num_qubits, 'c')
        qc = QuantumCircuit(qreg, creg)
        
        # Create superposition states
        for i in range(self.num_qubits):
            qc.h(qreg[i])
        
        # Create entanglement between qubits for musical correlation
        for i in range(self.num_qubits - 1):
            qc.cx(qreg[i], qreg[i + 1])
        
        # Add some controlled rotations for musical variation
        for i in range(0, self.num_qubits - 1, 2):
            qc.crz(np.pi / 4, qreg[i], qreg[i + 1])
        
        # Measure all qubits
        qc.measure_all()
        
        return qc
    
    def create_rhythm_circuit(self):
        """
        Create a quantum circuit for generating rhythmic patterns
        
        Returns:
            QuantumCircuit: The quantum circuit for rhythm generation
        """
        qreg = QuantumRegister(self.num_qubits, 'q')
        creg = ClassicalRegister(self.num_qubits, 'c')
        qc = QuantumCircuit(qreg, creg)
        
        # Create varied superposition states
        for i in range(self.num_qubits):
            angle = np.pi / (i + 1)  # Varying angles for different probabilities
            qc.ry(angle, qreg[i])
        
        # Entangle qubits for rhythmic patterns
        for i in range(0, self.num_qubits - 1, 2):
            qc.cx(qreg[i], qreg[i + 1])
        
        qc.measure_all()
        return qc
    
    def create_harmony_circuit(self, num_chords=4):
        """
        Create a quantum circuit for generating harmonic progressions
        
        Args:
            num_chords: Number of chords to generate
            
        Returns:
            QuantumCircuit: The quantum circuit for harmony
        """
        qreg = QuantumRegister(self.num_qubits, 'q')
        creg = ClassicalRegister(self.num_qubits, 'c')
        qc = QuantumCircuit(qreg, creg)
        
        # Create complex superposition
        for i in range(self.num_qubits):
            qc.h(qreg[i])
        
        # Create multi-qubit entanglement for chord relationships
        for i in range(0, self.num_qubits - 2, 3):
            qc.ccx(qreg[i], qreg[i + 1], qreg[i + 2])
        
        # Add phase gates for harmonic color
        for i in range(self.num_qubits):
            qc.p(np.pi / (i + 1), qreg[i])
        
        qc.measure_all()
        return qc
    
    def execute_circuit(self, circuit, shots=1024):
        """
        Execute a quantum circuit and return measurement results
        
        Args:
            circuit: QuantumCircuit to execute
            shots: Number of times to run the circuit
            
        Returns:
            dict: Measurement results
        """
        job = self.simulator.run(circuit, shots=shots)
        result = job.result()
        counts = result.get_counts(circuit)
        return counts
    
    def quantum_to_note(self, quantum_state, base_note='C4', scale_type='major'):
        """
        Map quantum measurement results to musical notes
        
        Args:
            quantum_state: Binary string from quantum measurement
            base_note: Starting note (e.g., 'C4')
            scale_type: 'major', 'minor', or 'chromatic'
            
        Returns:
            str: Musical note name (e.g., 'C4', 'D4', etc.)
        """
        # Clean the quantum state string - remove spaces and take only the binary part
        # Handle formats like '00000000 00000000' or '0x00' or just '00000000'
        clean_state = str(quantum_state).replace(' ', '').replace('0x', '')
        
        # If it's still not a valid binary string, try to extract just the binary digits
        if not all(c in '01' for c in clean_state):
            # Extract only binary digits
            clean_state = ''.join(c for c in clean_state if c in '01')
        
        # If we have multiple qubits, use a subset for note generation (first 4 bits for 12 semitones)
        # This gives us 0-15 range, which we'll mod by 12
        if len(clean_state) > 4:
            clean_state = clean_state[:4]  # Use first 4 bits
        elif len(clean_state) == 0:
            clean_state = '0'  # Fallback
        
        # Convert binary string to integer
        try:
            note_index = int(clean_state, 2) % 12
        except ValueError:
            # Fallback if conversion fails
            note_index = hash(clean_state) % 12
        
        # Choose scale
        if scale_type == 'major':
            scale_intervals = self.major_scale
        elif scale_type == 'minor':
            scale_intervals = self.minor_scale
        else:
            scale_intervals = self.chromatic_scale
        
        # Map to scale
        scale_note = note_index % len(scale_intervals)
        semitone_offset = scale_intervals[scale_note]
        
        # Parse base note
        base_pitch = note.Note(base_note)
        base_midi = base_pitch.pitch.midi
        
        # Calculate new MIDI number
        new_midi = base_midi + semitone_offset
        
        # Create note
        new_note = note.Note()
        new_note.pitch.midi = new_midi
        
        return new_note.nameWithOctave
    
    def generate_melody(self, num_notes=16, base_note='C4', scale_type='major', tempo_bpm=120):
        """
        Generate a musical melody using quantum circuits
        
        Args:
            num_notes: Number of notes in the melody
            base_note: Starting note
            scale_type: Scale type to use
            tempo_bpm: Tempo in beats per minute
            
        Returns:
            music21.stream.Stream: Generated melody
        """
        # Create quantum circuit
        qc = self.create_entangled_melody_circuit(num_notes)
        
        # Execute circuit once with multiple shots to get varied results
        counts = self.execute_circuit(qc, shots=num_notes)
        
        # Extract individual measurement results
        all_measurements = []
        for state, count in counts.items():
            # Add each state the number of times it was measured
            all_measurements.extend([state] * count)
        
        # If we don't have enough measurements, fill with random selections
        while len(all_measurements) < num_notes:
            if counts:
                # Randomly select from existing counts
                state = random.choice(list(counts.keys()))
                all_measurements.append(state)
            else:
                # Fallback: generate a random binary string
                all_measurements.append(format(random.randint(0, 255), '08b'))
        
        # Take only the number of notes we need
        all_measurements = all_measurements[:num_notes]
        
        # Create music stream
        s = stream.Stream()
        s.insert(0, tempo.MetronomeMark(number=tempo_bpm))
        s.insert(0, meter.TimeSignature('4/4'))
        s.insert(0, key.KeySignature(0))  # C major
        
        # Convert quantum states to notes
        for i, measurement in enumerate(all_measurements):
            note_name = self.quantum_to_note(measurement, base_note, scale_type)
            n = note.Note(note_name)
            n.duration.quarterLength = 0.5  # Eighth notes
            s.append(n)
        
        return s
    
    def generate_rhythm(self, num_beats=16):
        """
        Generate rhythmic patterns.

        For a better listening experience in the browser, this uses a
        simple beat-heavy random pattern (about 70% beats, 30% rests)
        instead of relying purely on quantum randomness, which was
        often producing mostly rests.
        """
        rhythm = []
        beat_probability = 0.7  # 70% chance of a beat

        for _ in range(num_beats):
            rhythm.append(1 if random.random() < beat_probability else 0)

        # Ensure we don't accidentally get all rests
        if sum(rhythm) == 0:
            rhythm[random.randrange(num_beats)] = 1

        return rhythm
    
    def generate_harmony(self, num_chords=4, base_key='C'):
        """
        Generate harmonic progressions using quantum circuits
        
        Args:
            num_chords: Number of chords to generate
            base_key: Key signature
            
        Returns:
            list: List of chord names
        """
        qc = self.create_harmony_circuit(num_chords)
        counts = self.execute_circuit(qc, shots=num_chords)
        
        # Common chord progressions
        major_chords = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']
        minor_chords = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']
        
        chords = []
        for state in sorted(counts.keys())[:num_chords]:
            # Clean the state string
            clean_state = str(state).replace(' ', '').replace('0x', '')
            if not all(c in '01' for c in clean_state):
                clean_state = ''.join(c for c in clean_state if c in '01')
            
            # Convert to integer, handling edge cases
            try:
                if len(clean_state) > 0:
                    chord_index = int(clean_state, 2) % len(major_chords)
                else:
                    chord_index = hash(str(state)) % len(major_chords)
            except ValueError:
                chord_index = hash(str(state)) % len(major_chords)
            
            chords.append(major_chords[chord_index])
        
        return chords
    
    def generate_full_composition(self, num_measures=4, tempo_bpm=120, key_signature='C'):
        """
        Generate a complete musical composition with melody, rhythm, and harmony
        
        Args:
            num_measures: Number of measures
            tempo_bpm: Tempo in beats per minute
            key_signature: Key signature
            
        Returns:
            music21.stream.Stream: Complete composition
        """
        num_notes = num_measures * 8  # 8 notes per measure (assuming 4/4 time)
        
        # Generate melody
        melody = self.generate_melody(num_notes, f'{key_signature}4', 'major', tempo_bpm)
        
        # Generate rhythm
        rhythm = self.generate_rhythm(num_notes)
        
        # Apply rhythm to melody - get all elements first
        all_elements = list(melody.flat.notesAndRests)
        # Apply rhythm pattern
        for i, (n, r) in enumerate(zip(all_elements[:num_notes], rhythm[:num_notes])):
            if r == 0 and isinstance(n, note.Note):
                # Replace note with rest
                rest = note.Rest()
                rest.duration = n.duration
                melody.replace(n, rest)
        
        return melody


def main():
    """Example usage"""
    print("🎵 Quantum Music Generator 🎵")
    print("=" * 40)
    
    generator = QuantumMusicGenerator(num_qubits=8)
    
    # Generate a simple melody
    print("\nGenerating quantum melody...")
    melody = generator.generate_melody(num_notes=16, base_note='C4', scale_type='major', tempo_bpm=120)
    
    # Save to MIDI
    output_file = 'quantum_melody.mid'
    melody.write('midi', fp=output_file)
    print(f"✅ Melody saved to {output_file}")
    
    # Generate full composition
    print("\nGenerating full quantum composition...")
    composition = generator.generate_full_composition(num_measures=4, tempo_bpm=120)
    
    output_file = 'quantum_composition.mid'
    composition.write('midi', fp=output_file)
    print(f"✅ Composition saved to {output_file}")
    
    # Show the notes
    print("\nGenerated notes:")
    for n in melody.notes[:8]:
        if isinstance(n, note.Note):
            print(f"  {n.nameWithOctave} (duration: {n.duration.quarterLength})")
        else:
            print(f"  Rest (duration: {n.duration.quarterLength})")


if __name__ == '__main__':
    main()

