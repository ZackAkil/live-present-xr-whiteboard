/**
 * Start a new freehand stroke at the given coordinates.
 * @param {Array<object>} strokes
 * @param {number} x
 * @param {number} y
 * @param {string} [color='#ffffff']
 * @returns {object}
 */
export function startStroke(strokes, x, y, color = '#ffffff') {
  const stroke = {
    points: [{ x, y }],
    color,
    width: 4.5,
  };
  strokes.push(stroke);
  return stroke;
}

/**
 * Append a point to an active stroke if it moved beyond minDist.
 * @param {object} stroke
 * @param {number} x
 * @param {number} y
 * @param {number} [minDist=3]
 */
export function appendStrokePoint(stroke, x, y, minDist = 3) {
  const last = stroke.points[stroke.points.length - 1];
  if (Math.hypot(x - last.x, y - last.y) >= minDist) {
    stroke.points.push({ x, y });
  }
}

/**
 * Render all freehand strokes onto the 2D canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<object>} strokes
 */
export function drawStrokes(ctx, strokes) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const stroke of strokes) {
    const pts = stroke.points;
    if (pts.length === 0) continue;

    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);

    if (pts.length === 1) {
      ctx.lineTo(pts[0].x + 0.01, pts[0].y);
    } else {
      for (let i = 1; i < pts.length - 1; i++) {
        const midX = (pts[i].x + pts[i + 1].x) / 2;
        const midY = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last.x, last.y);
    }

    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Remove any strokes that pass within radius of (x, y) and return the removed strokes.
 * @param {Array<object>} strokes
 * @param {number} x
 * @param {number} y
 * @param {number} [radius=24]
 * @returns {Array<object>}
 */
export function eraseStrokesAt(strokes, x, y, radius = 24) {
  const removed = [];
  for (let i = strokes.length - 1; i >= 0; i--) {
    const hit = strokes[i].points.some((pt) => Math.hypot(pt.x - x, pt.y - y) <= radius);
    if (hit) {
      removed.push(strokes.splice(i, 1)[0]);
    }
  }
  return removed;
}
