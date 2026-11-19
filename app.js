import { setupCamera, createHandDetector, detectHands } from './handTracker.js';
import { extractPinchState, computeTwoHandTransform, smoothPinchState } from './pinchLogic.js';
import { createShape, createDefaultShapes, updateShapes, findShapeAt, drawShapes, triggerClearFlyOut } from './shapes.js';
import { startStroke, appendStrokePoint, drawStrokes, eraseStrokesAt } from './drawing.js';
import { isLiveConfigured, startMutedLiveSession } from './liveShapesApi.js';

const video = document.getElementById('webcam');
const canvas = document.getElementById('overlay');
const statusEl = document.getElementById('status');
const menuContainer = document.getElementById('menu-container');
const menuBtn = document.getElementById('menu-btn');
const menuPanel = document.getElementById('menu-panel');
const drawBtn = document.getElementById('draw-btn');
const eraseBtn = document.getElementById('erase-btn');
const liveBtn = document.getElementById('live-btn');
const liveIndicator = document.getElementById('live-indicator');
const ctx = canvas.getContext('2d');

const MIN_SCALE = 0.3;
const MAX_SCALE = 4.0;

let shapes = [];
let strokes = [];
let undoneStrokes = [];
let activeStroke = null;
let isDrawMode = false;
let isEraseMode = false;
let grabbedShape = null;
let dragOffset = { x: 0, y: 0 };
let twoHandBase = null;
let prevPinchByHand = {};
let lastTime = performance.now();

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function bringToFront(shape) {
  shapes = [...shapes.filter((s) => s !== shape), shape];
}

function drawHandCursor(ctx2d, pinch) {
  if (pinch.pinchProximity <= 0.01) return;

  ctx2d.save();
  ctx2d.globalAlpha = pinch.pinchProximity;

  ctx2d.fillStyle = 'rgba(255, 255, 255, 0.75)';
  for (const pt of [pinch.thumb, pinch.index]) {
    ctx2d.beginPath();
    ctx2d.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
    ctx2d.fill();
  }

  ctx2d.beginPath();
  ctx2d.arc(pinch.x, pinch.y, pinch.isPinching ? 10 : 16, 0, Math.PI * 2);
  ctx2d.fillStyle = pinch.isPinching ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.15)';
  ctx2d.fill();
  ctx2d.lineWidth = 2;
  ctx2d.strokeStyle = '#ffffff';
  ctx2d.stroke();

  ctx2d.restore();
}

function releaseGrabbedShape() {
  if (grabbedShape) {
    grabbedShape.isGrabbed = false;
    grabbedShape = null;
  }
  twoHandBase = null;
}

function moveShapeWithVelocity(shape, nextX, nextY, dt) {
  if (dt > 0) {
    const instVx = (nextX - shape.x) / dt;
    const instVy = (nextY - shape.y) / dt;
    shape.vx = shape.vx * 0.55 + instVx * 0.45;
    shape.vy = shape.vy * 0.55 + instVy * 0.45;
  }
  shape.x = nextX;
  shape.y = nextY;
}

function handleTwoHandPinch(p1, p2, dt) {
  const transform = computeTwoHandTransform(p1, p2);

  if (!twoHandBase) {
    const target =
      grabbedShape ||
      findShapeAt(shapes, transform.center.x, transform.center.y) ||
      findShapeAt(shapes, p1.x, p1.y) ||
      findShapeAt(shapes, p2.x, p2.y);

    if (!target) return;

    grabbedShape = target;
    grabbedShape.isGrabbed = true;
    grabbedShape.vx = 0;
    grabbedShape.vy = 0;
    bringToFront(grabbedShape);

    twoHandBase = {
      startDistance: Math.max(transform.distance, 10),
      startAngle: transform.angle,
      startScale: grabbedShape.scale,
      startRotation: grabbedShape.rotation,
      offset: {
        x: grabbedShape.x - transform.center.x,
        y: grabbedShape.y - transform.center.y,
      },
    };
  }

  const scaleRatio = transform.distance / twoHandBase.startDistance;
  grabbedShape.scale = clamp(twoHandBase.startScale * scaleRatio, MIN_SCALE, MAX_SCALE);
  grabbedShape.rotation = twoHandBase.startRotation + (transform.angle - twoHandBase.startAngle);
  moveShapeWithVelocity(
    grabbedShape,
    transform.center.x + twoHandBase.offset.x,
    transform.center.y + twoHandBase.offset.y,
    dt
  );
}

function handleSingleHandPinch(pinch, dt) {
  if (twoHandBase) {
    twoHandBase = null;
    if (grabbedShape) {
      dragOffset = { x: grabbedShape.x - pinch.x, y: grabbedShape.y - pinch.y };
    }
  }

  if (!grabbedShape) {
    const hit = findShapeAt(shapes, pinch.x, pinch.y);
    if (!hit) return;

    grabbedShape = hit;
    grabbedShape.isGrabbed = true;
    grabbedShape.vx = 0;
    grabbedShape.vy = 0;
    dragOffset = { x: hit.x - pinch.x, y: hit.y - pinch.y };
    bringToFront(grabbedShape);
  }

  moveShapeWithVelocity(grabbedShape, pinch.x + dragOffset.x, pinch.y + dragOffset.y, dt);
}

function handleDrawPinch(active) {
  if (active.length === 0) {
    activeStroke = null;
    return;
  }

  const p = active[0];
  if (!activeStroke) {
    undoneStrokes = [];
    activeStroke = startStroke(strokes, p.x, p.y);
  } else {
    appendStrokePoint(activeStroke, p.x, p.y);
  }
}

function handlePinchInteractions(pinches, dt) {
  const active = pinches.filter((p) => p.isPinching);

  if (isEraseMode) {
    if (active.length > 0) {
      const removed = eraseStrokesAt(strokes, active[0].x, active[0].y);
      undoneStrokes.push(...removed);
    }
    return;
  }

  if (isDrawMode) {
    handleDrawPinch(active);
    return;
  }

  if (active.length >= 2) {
    handleTwoHandPinch(active[0], active[1], dt);
  } else if (active.length === 1) {
    handleSingleHandPinch(active[0], dt);
  } else {
    releaseGrabbedShape();
  }
}

function extractAllPinches(hands, viewport, dt) {
  const nextByHand = {};
  const pinches = [];

  hands.forEach((hand, i) => {
    const key =
      hand.handedness && !(hand.handedness in nextByHand)
        ? hand.handedness
        : `hand_${i}`;
    const prev = prevPinchByHand[key];
    const raw = extractPinchState(hand, Boolean(prev?.isPinching), viewport);
    if (raw) {
      const smoothed = smoothPinchState(prev, raw, dt);
      nextByHand[key] = smoothed;
      pinches.push(smoothed);
    }
  });

  prevPinchByHand = nextByHand;
  return pinches;
}

function setStatus(text) {
  statusEl.textContent = text;
  statusEl.classList.toggle('ready', !text);
}

async function main() {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  shapes = createDefaultShapes(canvas.width, canvas.height);

  try {
    setStatus('Starting camera...');
    await setupCamera(video);

    setStatus('Loading hand pose model...');
    const detector = await createHandDetector();

    setStatus('');

    async function frame(now) {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const hands = await detectHands(detector, video);
      const viewport = {
        videoWidth: video.videoWidth || 1280,
        videoHeight: video.videoHeight || 720,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
      };

      const pinches = extractAllPinches(hands, viewport, dt);
      handlePinchInteractions(pinches, dt);
      updateShapes(shapes, canvas.width, canvas.height, dt);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawShapes(ctx, shapes);
      drawStrokes(ctx, strokes);
      for (const pinch of pinches) {
        drawHandCursor(ctx, pinch);
      }

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`);
  }
}

let liveSession = null;
let isLiveAvailable = false;

isLiveConfigured().then((configured) => {
  isLiveAvailable = configured;
  liveBtn.hidden = !configured;
});

async function toggleLiveSession() {
  if (!isLiveAvailable) return;
  if (liveSession) {
    await liveSession.stop();
    liveSession = null;
    liveBtn.textContent = 'Gemini Live: Off (G)';
    liveBtn.classList.remove('active');
    liveIndicator.classList.remove('active');
    setStatus('');
    return;
  }

  liveBtn.disabled = true;
  liveBtn.textContent = 'Gemini Live: Connecting...';
  setStatus('Connecting to Gemini Live...');

  try {
    liveSession = await startMutedLiveSession({
      onSpawnShape: ({ type, color, text, count }) => {
        const total = clamp(Number(count) || 1, 1, 10);
        for (let i = 0; i < total; i++) {
          shapes.push(
            createShape(type, canvas.width, canvas.height, { color, text, flyIn: true })
          );
        }
        return total;
      },
      onSpawnTextBox: ({ text, color }) => {
        shapes.push(
          createShape('textbox', canvas.width, canvas.height, { text, color, flyIn: true })
        );
        return true;
      },
      onClearShapes: () => {
        releaseGrabbedShape();
        triggerClearFlyOut(shapes, canvas.width, canvas.height);
        strokes = [];
        undoneStrokes = [];
        activeStroke = null;
      },
    });
    liveBtn.textContent = 'Gemini Live: On (G)';
    liveBtn.classList.add('active');
    liveIndicator.classList.add('active');
    setStatus('');
  } catch (err) {
    console.error(err);
    liveBtn.textContent = 'Gemini Live: Error';
    liveBtn.classList.remove('active');
    liveIndicator.classList.remove('active');
    setStatus(`Gemini Live error: ${err.message}`);
  } finally {
    liveBtn.disabled = false;
  }
}

function undoDrawing() {
  activeStroke = null;
  const removed = strokes.pop();
  if (!removed) return false;
  undoneStrokes.push(removed);
  return true;
}

function redoDrawing() {
  const restored = undoneStrokes.pop();
  if (!restored) return false;
  strokes.push(restored);
  return true;
}

function syncModeButtons() {
  drawBtn.textContent = isDrawMode ? 'Draw: On (D)' : 'Draw: Off (D)';
  drawBtn.classList.toggle('active', isDrawMode);
  eraseBtn.textContent = isEraseMode ? 'Erase: On (E)' : 'Erase: Off (E)';
  eraseBtn.classList.toggle('active', isEraseMode);
}

function toggleDrawMode() {
  isDrawMode = !isDrawMode;
  if (isDrawMode) isEraseMode = false;
  releaseGrabbedShape();
  activeStroke = null;
  syncModeButtons();
}

function toggleEraseMode() {
  isEraseMode = !isEraseMode;
  if (isEraseMode) isDrawMode = false;
  releaseGrabbedShape();
  activeStroke = null;
  syncModeButtons();
}

function setMenuOpen(open) {
  menuPanel.classList.toggle('hidden', !open);
  menuBtn.setAttribute('aria-expanded', String(open));
}

menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setMenuOpen(menuPanel.classList.contains('hidden'));
});

document.addEventListener('click', (e) => {
  if (!menuContainer.contains(e.target)) {
    setMenuOpen(false);
  }
});

drawBtn.addEventListener('click', toggleDrawMode);
eraseBtn.addEventListener('click', toggleEraseMode);
liveBtn.addEventListener('click', toggleLiveSession);
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  const hasMod = e.ctrlKey || e.metaKey;

  if (hasMod && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redoDrawing();
    else undoDrawing();
    return;
  }

  if (e.repeat || hasMod) return;
  if (key === 'd') toggleDrawMode();
  else if (key === 'e') toggleEraseMode();
  else if (key === 'g' && !liveBtn.disabled) toggleLiveSession();
});

main();
