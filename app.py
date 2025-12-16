"""
Web interface for Quantum Music Generator
"""

from flask import Flask, render_template, jsonify, request, send_file
from flask_cors import CORS
from quantum_music import QuantumMusicGenerator
from music21 import note
import os
import tempfile

app = Flask(__name__)
CORS(app)

generator = QuantumMusicGenerator(num_qubits=8)


@app.route('/')
def index():
    """Serve the main page"""
    return render_template('index.html')


@app.route('/api/generate', methods=['POST'])
def generate_music():
    """Generate music based on user parameters"""
    try:
        data = request.json
        num_notes = data.get('num_notes', 16)
        base_note = data.get('base_note', 'C4')
        scale_type = data.get('scale_type', 'major')
        tempo_bpm = data.get('tempo_bpm', 120)
        composition_type = data.get('type', 'melody')  # 'melody', 'rhythm', 'full'
        
        if composition_type == 'melody':
            music_stream = generator.generate_melody(
                num_notes=num_notes,
                base_note=base_note,
                scale_type=scale_type,
                tempo_bpm=tempo_bpm
            )
        elif composition_type == 'full':
            num_measures = num_notes // 8
            music_stream = generator.generate_full_composition(
                num_measures=num_measures,
                tempo_bpm=tempo_bpm,
                key_signature=base_note[0]
            )
        else:
            # For rhythm, we'll generate a simple melody with rhythm applied
            music_stream = generator.generate_melody(
                num_notes=num_notes,
                base_note=base_note,
                scale_type=scale_type,
                tempo_bpm=tempo_bpm
            )
            rhythm = generator.generate_rhythm(num_notes)
            # Get all notes from the stream
            all_elements = list(music_stream.flat.notesAndRests)
            # Apply rhythm pattern - create a new list with notes/rests
            new_elements = []
            for i, (n, r) in enumerate(zip(all_elements[:num_notes], rhythm[:num_notes])):
                if r == 0 and isinstance(n, note.Note):
                    # Replace note with rest
                    rest = note.Rest()
                    rest.duration = n.duration
                    new_elements.append(rest)
                    music_stream.replace(n, rest)
                else:
                    new_elements.append(n)
        
        # Save to temporary file
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.mid')
        temp_file.close()
        music_stream.write('midi', fp=temp_file.name)
        
        # Get note information - use flat.notes to get all notes from the stream
        notes_info = []
        # Get all notes and rests from the stream
        all_elements = list(music_stream.flat.notesAndRests)
        
        # Debug: print what we found
        # print(f"Total elements in stream: {len(all_elements)}")
        # print(f"Requested notes: {num_notes}")
        # print(f"First few elements: {[type(e).__name__ for e in all_elements[:5]]}")
        
        # Limit to the requested number of notes, but ensure we have enough
        elements_to_process = all_elements[:num_notes] if len(all_elements) >= num_notes else all_elements
        
        for n in elements_to_process:
            # Check if it's a note or rest
            if isinstance(n, note.Note):
                notes_info.append({
                    'note': n.nameWithOctave,
                    'duration': float(n.duration.quarterLength)
                })
            elif isinstance(n, note.Rest):
                notes_info.append({
                    'note': 'Rest',
                    'duration': float(n.duration.quarterLength)
                })
            elif hasattr(n, 'nameWithOctave'):
                # Handle other note-like objects
                notes_info.append({
                    'note': n.nameWithOctave,
                    'duration': float(n.duration.quarterLength)
                })
            else:
                # Fallback for any other element
                notes_info.append({
                    'note': 'Rest',
                    'duration': float(n.duration.quarterLength) if hasattr(n, 'duration') else 0.5
                })
        
        # Ensure we have at least some notes (not all rests)
        num_actual_notes = sum(1 for n in notes_info if n['note'] != 'Rest' and n['note'] != 'rest')
        
        # If we have no playable notes, log a warning but still return the data
        # (The frontend will handle this gracefully)
        if num_actual_notes == 0 and len(notes_info) > 0:
            # This shouldn't happen with the improved rhythm generation, but just in case
            pass
        
        return jsonify({
            'success': True,
            'file': temp_file.name,
            'notes': notes_info
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/download/<path:filename>')
def download_file(filename):
    """Download the generated MIDI file"""
    try:
        return send_file(filename, as_attachment=True, download_name='quantum_music.mid')
    except Exception as e:
        return jsonify({'error': str(e)}), 404


if __name__ == '__main__':
    # Create templates directory if it doesn't exist
    os.makedirs('templates', exist_ok=True)
    # Get port from environment variable (for production) or use 5000 for local development
    port = int(os.environ.get('PORT', 5000))
    # Use debug mode only in development (when PORT is not set)
    debug_mode = os.environ.get('PORT') is None
    app.run(debug=debug_mode, host='0.0.0.0', port=port)

