# XR Presenter

A browser-based webcam AR/XR whiteboard with real-time MediaPipe hand tracking and optional Gemini Live voice-controlled shape spawning.

## Features

- **Hand-tracked manipulation**: One-hand pinch to grab, drag, and throw floating shapes; two-hand pinch to scale and rotate.
- **Freehand drawing & erasing**: Pinch to draw or erase strokes over your camera feed, with undo/redo support.
- **Gemini Live integration**: Voice-triggered function calls (`spawn_shape`, `spawn_text_box`, `clear_shapes`) via Firebase AI Logic.

## Getting Started

Because the app uses ES modules and webcam/microphone permissions, serve the directory over a local HTTP server (or `https://`):

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser and allow camera access.

### Enabling Gemini Live (Optional)

Hand tracking and drawing work out of the box. To enable the Gemini Live voice assistant:

1. Create a Firebase project and enable **Firebase AI Logic** (Gemini Developer API).
2. Copy `firebase-config.example.js` to `firebase-config.js`:
   ```bash
   cp firebase-config.example.js firebase-config.js
   ```
3. Fill in your Firebase project credentials in `firebase-config.js`.

## Controls

| Action | Input |
| --- | --- |
| Grab / Move / Throw shape | One-hand pinch |
| Scale & Rotate shape | Two-hand pinch |
| Toggle Draw mode | `D` or menu button |
| Toggle Erase mode | `E` or menu button |
| Toggle Gemini Live | `G` or menu button |
| Undo / Redo stroke | `Cmd/Ctrl + Z` / `Cmd/Ctrl + Shift + Z` |

## Project Structure

- `index.html`, `style.css` — Fullscreen webcam canvas and minimal overlay UI
- `app.js` — Main render loop, gesture routing, and keyboard/menu controls
- `handTracker.js` — TensorFlow.js + MediaPipe Hands setup and landmark detection
- `pinchLogic.js` — Pinch state extraction, smoothing, and two-hand transform math
- `shapes.js` — Floating shape physics, hit testing, and canvas rendering
- `drawing.js` — Freehand stroke recording, rendering, and erasing
- `liveShapesApi.js` — Muted Gemini Live audio session with canvas tool declarations
