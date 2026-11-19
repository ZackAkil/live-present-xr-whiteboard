const SHAPE_TYPES = new Set(['circle', 'square', 'triangle', 'hexagon', 'textbox']);

const DEFAULT_COLORS = {
  circle: { fill: 'rgba(56, 189, 248, 0.72)', stroke: 'rgba(186, 230, 253, 0.95)' },
  square: { fill: 'rgba(167, 139, 250, 0.72)', stroke: 'rgba(221, 214, 254, 0.95)' },
  triangle: { fill: 'rgba(52, 211, 153, 0.72)', stroke: 'rgba(167, 243, 208, 0.95)' },
  hexagon: { fill: 'rgba(251, 146, 60, 0.72)', stroke: 'rgba(254, 215, 170, 0.95)' },
  textbox: { fill: 'rgba(15, 15, 22, 0.78)', stroke: 'rgba(255, 255, 255, 0.85)' },
};

function wrapLines(text, maxChars) {
  if (!text) return [];
  const words = text.trim().split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Create a single floating shape or text box.
 * @param {string} type
 * @param {number} width
 * @param {number} height
 * @param {{ x?: number, y?: number, vx?: number, vy?: number, color?: string, text?: string }} [opts]
 * @returns {object}
 */
export function createShape(type, width, height, opts = {}) {
  const safeType = SHAPE_TYPES.has(type) ? type : 'circle';
  const palette = DEFAULT_COLORS[safeType];
  const text = (opts.text || '').trim();
  const margin = 90;
  const x = opts.x ?? (opts.flyIn ? width / 2 : margin + Math.random() * Math.max(width - margin * 2, 100));
  const y = opts.y ?? (opts.flyIn ? height / 2 : margin + Math.random() * Math.max(height - margin * 2, 100));

  let halfW = null;
  let halfH = null;
  if (safeType === 'textbox') {
    const lines = wrapLines(text || 'Text', 22);
    const longest = Math.max(...lines.map((l) => l.length), 4);
    halfW = Math.max(70, longest * 5.6 + 24);
    halfH = Math.max(30, lines.length * 13 + 16);
  }

  const DAMPING_RATE = 5;
  let startX = x;
  let startY = y;
  let vx = 0;
  let vy = 0;

  if (opts.flyIn) {
    const edge = Math.floor(Math.random() * 4);
    const pad = 140;
    if (edge === 0) { startX = -pad; startY = Math.random() * height; }
    else if (edge === 1) { startX = width + pad; startY = Math.random() * height; }
    else if (edge === 2) { startX = Math.random() * width; startY = -pad; }
    else { startX = Math.random() * width; startY = height + pad; }
    vx = (x - startX) * DAMPING_RATE;
    vy = (y - startY) * DAMPING_RATE;
  }

  return {
    id: `${safeType}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: safeType,
    x: startX,
    y: startY,
    radius: 56,
    halfW,
    halfH,
    scale: 1,
    rotation: 0,
    vx,
    vy,
    vr: 0,
    color: opts.color || palette.fill,
    stroke: opts.color ? 'rgba(255, 255, 255, 0.9)' : palette.stroke,
    text,
    isGrabbed: false,
    isEntering: Boolean(opts.flyIn),
    isClearing: false,
  };
}

/**
 * Launch all current shapes outward off-screen with spin.
 * @param {Array<object>} shapes
 * @param {number} width
 * @param {number} height
 */
export function triggerClearFlyOut(shapes, width, height) {
  const cx = width / 2;
  const cy = height / 2;

  for (const shape of shapes) {
    shape.isGrabbed = false;
    shape.isEntering = false;
    shape.isClearing = true;

    let dx = shape.x - cx;
    let dy = shape.y - cy;
    let dist = Math.hypot(dx, dy);
    if (dist < 1) {
      const angle = Math.random() * Math.PI * 2;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
      dist = 1;
    }

    const speed = 1300 + Math.random() * 500;
    shape.vx = (dx / dist) * speed;
    shape.vy = (dy / dist) * speed;
    shape.vr = (Math.random() - 0.5) * 9;
  }
}

/**
 * Create initial floating shapes positioned across the viewport.
 * @param {number} width
 * @param {number} height
 * @returns {Array<object>}
 */
export function createDefaultShapes(width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const spreadX = Math.min(width * 0.25, 240);
  const spreadY = Math.min(height * 0.2, 160);

  return [
    createShape('circle', width, height, { x: cx - spreadX, y: cy - spreadY * 0.6 }),
    createShape('square', width, height, { x: cx + spreadX, y: cy - spreadY * 0.5 }),
    createShape('triangle', width, height, { x: cx - spreadX * 0.6, y: cy + spreadY * 0.8 }),
    createShape('hexagon', width, height, { x: cx + spreadX * 0.7, y: cy + spreadY * 0.7 }),
  ];
}

function isOffscreen(shape, width, height, marginX, marginY, pad = 0) {
  return (
    shape.x < -marginX - pad ||
    shape.x > width + marginX + pad ||
    shape.y < -marginY - pad ||
    shape.y > height + marginY + pad
  );
}

/**
 * Apply inertia, fly-in, and fly-out motion to shapes, deleting shapes that leave the screen.
 * @param {Array<object>} shapes
 * @param {number} width
 * @param {number} height
 * @param {number} dt Seconds elapsed since last frame
 */
export function updateShapes(shapes, width, height, dt) {
  const damping = Math.exp(-5 * dt);

  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    if (shape.isGrabbed) continue;

    const marginX = (shape.halfW ?? shape.radius) * shape.scale;
    const marginY = (shape.halfH ?? shape.radius) * shape.scale;

    if (shape.isClearing) {
      shape.x += shape.vx * dt;
      shape.y += shape.vy * dt;
      shape.rotation += shape.vr * dt;

      if (isOffscreen(shape, width, height, marginX, marginY, 150)) {
        shapes.splice(i, 1);
      }
      continue;
    }

    if (shape.vx !== 0 || shape.vy !== 0) {
      shape.x += shape.vx * dt;
      shape.y += shape.vy * dt;
      shape.vx *= damping;
      shape.vy *= damping;

      if (Math.hypot(shape.vx, shape.vy) < 2) {
        shape.vx = 0;
        shape.vy = 0;
      }
    }

    if (shape.isEntering) {
      const inside =
        shape.x >= marginX &&
        shape.x <= width - marginX &&
        shape.y >= marginY &&
        shape.y <= height - marginY;
      if (inside) {
        shape.isEntering = false;
      }
      continue;
    }

    if (isOffscreen(shape, width, height, marginX, marginY)) {
      shapes.splice(i, 1);
    }
  }
}

/**
 * Find the topmost shape containing the given point.
 * @param {Array<object>} shapes
 * @param {number} x
 * @param {number} y
 * @returns {object|null}
 */
export function findShapeAt(shapes, x, y) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    if (!shape.isClearing && isPointInShape(shape, x, y)) {
      return shape;
    }
  }
  return null;
}

function isPointInShape(shape, x, y) {
  const dx = x - shape.x;
  const dy = y - shape.y;

  if (shape.type === 'square' || shape.type === 'textbox') {
    const halfW = (shape.halfW ?? shape.radius) * shape.scale;
    const halfH = (shape.halfH ?? shape.radius) * shape.scale;
    const cos = Math.cos(-shape.rotation);
    const sin = Math.sin(-shape.rotation);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    return Math.abs(lx) <= halfW && Math.abs(ly) <= halfH;
  }

  return Math.hypot(dx, dy) <= shape.radius * shape.scale;
}

/**
 * Render all shapes onto the 2D canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<object>} shapes
 */
export function drawShapes(ctx, shapes) {
  for (const shape of shapes) {
    ctx.save();
    ctx.translate(shape.x, shape.y);
    ctx.rotate(shape.rotation);
    ctx.scale(shape.scale, shape.scale);

    traceShapePath(ctx, shape);
    ctx.fillStyle = shape.color;
    ctx.fill();

    ctx.lineWidth = (shape.isGrabbed ? 3.5 : 2) / shape.scale;
    ctx.strokeStyle = shape.isGrabbed ? '#ffffff' : shape.stroke;
    ctx.stroke();

    if (shape.text) {
      drawShapeText(ctx, shape);
    }

    ctx.restore();
  }
}

function drawShapeText(ctx, shape) {
  const isBox = shape.type === 'textbox';
  const maxChars = isBox ? 22 : 12;
  const lines = wrapLines(shape.text, maxChars);
  const fontSize = isBox ? 18 : 15;
  const lineHeight = fontSize * 1.25;
  const startY = -((lines.length - 1) * lineHeight) / 2;

  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  lines.forEach((line, i) => {
    ctx.fillText(line, 0, startY + i * lineHeight);
  });
}

function traceShapePath(ctx, shape) {
  const r = shape.radius;
  ctx.beginPath();

  if (shape.type === 'circle') {
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    return;
  }

  if (shape.type === 'square' || shape.type === 'textbox') {
    const hw = shape.halfW ?? r;
    const hh = shape.halfH ?? r;
    ctx.roundRect(-hw, -hh, hw * 2, hh * 2, 14);
    return;
  }

  const sides = shape.type === 'triangle' ? 3 : 6;
  const startAngle = -Math.PI / 2;
  for (let i = 0; i < sides; i++) {
    const angle = startAngle + (i * Math.PI * 2) / sides;
    const px = Math.cos(angle) * r;
    const py = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
