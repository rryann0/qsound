# 🎵 Quantum Music Generator

A cutting-edge application that generates music using quantum computing principles. This project combines quantum circuits with music theory to create unique musical compositions.

## Features

- **Quantum Melody Generation**: Uses quantum superposition and entanglement to generate musical melodies
- **Rhythmic Patterns**: Quantum circuits create rhythmic variations
- **Harmonic Progressions**: Generate chord progressions using quantum algorithms
- **Web Interface**: Beautiful, modern web UI for easy interaction
- **MIDI Export**: Download generated music as MIDI files

## How It Works

1. **Quantum Superposition**: Qubits are put into superposition states, creating a probability distribution of possible musical outcomes
2. **Quantum Entanglement**: Qubits are entangled to create correlated musical patterns
3. **Measurement**: Quantum measurements collapse to classical states
4. **Musical Mapping**: Binary quantum states are mapped to musical notes using music theory (scales, intervals, etc.)

## Installation

### Prerequisites

- Python 3.8 or higher
- pip (Python package manager)

### Setup

1. Clone or navigate to this repository:
```bash
cd qsound
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

## Usage

### Command Line Interface

Run the quantum music generator directly:

```bash
python quantum_music.py
```

This will generate sample melodies and compositions, saving them as MIDI files.

### Web Interface

1. Start the Flask server:
```bash
python app.py
```

2. Open your browser and navigate to:
```
http://localhost:5000
```

3. Adjust the parameters:
   - **Number of Notes**: How many notes to generate
   - **Base Note**: Starting note (C4, D4, etc.)
   - **Scale Type**: Major, Minor, or Chromatic
   - **Tempo**: Beats per minute
   - **Composition Type**: Melody, Melody with Rhythm, or Full Composition

4. Click "Generate Quantum Music" to create your composition

5. Download the MIDI file to use in your favorite music software

## Project Structure

```
qsound/
├── quantum_music.py    # Core quantum music generation engine
├── app.py              # Flask web application
├── templates/
│   └── index.html      # Web interface
├── requirements.txt    # Python dependencies
└── README.md          # This file
```

## Technical Details

### Quantum Circuits

The application uses several types of quantum circuits:

- **Entangled Melody Circuit**: Creates correlated musical patterns through qubit entanglement
- **Rhythm Circuit**: Uses varied rotation angles to generate rhythmic patterns
- **Harmony Circuit**: Multi-qubit entanglement for harmonic relationships

### Musical Mapping

Quantum measurement results (binary strings) are mapped to musical notes using:
- Scale theory (major, minor, chromatic)
- Interval relationships
- Music21 library for music theory and MIDI generation

## Dependencies

- **qiskit**: IBM's quantum computing framework
- **qiskit-aer**: Quantum simulator backend
- **music21**: Music theory and MIDI generation
- **flask**: Web framework for the interface
- **numpy**: Numerical computations

## Examples

### Generate a simple melody:
```python
from quantum_music import QuantumMusicGenerator

generator = QuantumMusicGenerator(num_qubits=8)
melody = generator.generate_melody(num_notes=16, base_note='C4', scale_type='major')
melody.write('midi', fp='my_melody.mid')
```

### Generate a full composition:
```python
composition = generator.generate_full_composition(num_measures=4, tempo_bpm=120)
composition.write('midi', fp='my_composition.mid')
```

## Future Enhancements

- Real quantum hardware integration (IBM Quantum, Google Quantum AI)
- More complex musical structures (polyphony, counterpoint)
- Machine learning integration for style learning
- Real-time audio playback
- Export to audio formats (WAV, MP3)

## License

This project is open source and available for educational and research purposes.

## Contributing

Contributions are welcome! Feel free to submit issues or pull requests.

## Acknowledgments

- Qiskit team for the quantum computing framework
- Music21 team for music theory tools
- The quantum computing and music information retrieval communities

---

**Note**: This application uses quantum simulators by default. To use real quantum hardware, you'll need to configure Qiskit with your IBM Quantum credentials and modify the backend settings.

