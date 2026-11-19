const WRIST_IDX = 0;
const THUMB_TIP_IDX = 4;
const INDEX_TIP_IDX = 8;
const MIDDLE_MCP_IDX = 9;

const PINCH_START_RATIO = 0.36;
const PINCH_RELEASE_RATIO = 0.52;

/**
 * Map a video-space keypoint to mirrored fullscreen canvas coordinates,
 * accounting for object-fit: cover scaling and cropping.
 * @param {{ x: number, y: number }} point
 * @param {{ videoWidth: number, videoHeight: number, canvasWidth: number, canvasHeight: number }} viewport
 * @returns {{ x: number, y: number }}
 */
export function mapVideoPointToCanvas(point, viewport) {
  const { videoWidth, videoHeight, canvasWidth, canvasHeight } = viewport;
  const scale = Math.max(canvasWidth / videoWidth, canvasHeight / videoHeight);
  const offsetX = (canvasWidth - videoWidth * scale) / 2;
  const offsetY = (canvasHeight - videoHeight * scale) / 2;

  return {
    x: canvasWidth - (point.x * scale + offsetX),
    y: point.y * scale + offsetY,
  };
}

/**
 * Compute pinch midpoint and hysteresis-stabilized pinch state from a detected hand.
 * @param {object|null} hand
 * @param {boolean} prevPinching
 * @param {{ videoWidth: number, videoHeight: number, canvasWidth: number, canvasHeight: number }} viewport
 * @returns {{ x: number, y: number, isPinching: boolean, thumb: { x: number, y: number }, index: { x: number, y: number } } | null}
 */
export function extractPinchState(hand, prevPinching, viewport) {
  const kp = hand?.keypoints;
  if (!kp || kp.length < 21) return null;

  const wrist = kp[WRIST_IDX];
  const middleMcp = kp[MIDDLE_MCP_IDX];
  const thumbRaw = kp[THUMB_TIP_IDX];
  const indexRaw = kp[INDEX_TIP_IDX];

  // Normalize pinch distance by palm size so detection works at varying camera distances.
  const palmSize = Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y);
  const isValidPalm = palmSize >= 15;
  const pinchDist = Math.hypot(thumbRaw.x - indexRaw.x, thumbRaw.y - indexRaw.y);
  const ratio = isValidPalm ? pinchDist / palmSize : 1;

  const threshold = prevPinching ? PINCH_RELEASE_RATIO : PINCH_START_RATIO;
  const rawPinching = isValidPalm && ratio < threshold;

  const PROXIMITY_START_RATIO = 0.85;
  const rawProximity = (PROXIMITY_START_RATIO - ratio) / (PROXIMITY_START_RATIO - PINCH_START_RATIO);
  const pinchProximity = rawPinching ? 1 : Math.min(Math.max(rawProximity, 0), 1);

  const thumb = mapVideoPointToCanvas(thumbRaw, viewport);
  const index = mapVideoPointToCanvas(indexRaw, viewport);

  return {
    x: (thumb.x + index.x) / 2,
    y: (thumb.y + index.y) / 2,
    rawPinching,
    isPinching: false,
    pinchProximity,
    thumb,
    index,
  };
}

/**
 * Compute midpoint, distance, and angle between two pinch points.
 * @param {{ x: number, y: number }} p1
 * @param {{ x: number, y: number }} p2
 * @returns {{ center: { x: number, y: number }, distance: number, angle: number }}
 */
export function computeTwoHandTransform(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return {
    center: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
    distance: Math.hypot(dx, dy),
    angle: Math.atan2(dy, dx),
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

const PINCH_DEBOUNCE_SEC = 0.08;

/**
 * Apply frame-rate independent exponential smoothing and pinch onset debouncing.
 * @param {object|undefined} prev
 * @param {object} next
 * @param {number} dt Seconds elapsed since last frame
 * @param {number} [speed=18] Smoothing responsiveness factor (higher = less lag)
 * @returns {object}
 */
export function smoothPinchState(prev, next, dt, speed = 18) {
  const pinchHoldTime = next.rawPinching ? (prev?.pinchHoldTime ?? 0) + dt : 0;
  const isPinching = prev?.isPinching
    ? next.rawPinching
    : pinchHoldTime >= PINCH_DEBOUNCE_SEC;

  if (!prev) {
    return {
      ...next,
      isPinching: false,
      pinchHoldTime: 0,
    };
  }

  const alpha = 1 - Math.exp(-speed * dt);
  const thumb = {
    x: lerp(prev.thumb.x, next.thumb.x, alpha),
    y: lerp(prev.thumb.y, next.thumb.y, alpha),
  };
  const index = {
    x: lerp(prev.index.x, next.index.x, alpha),
    y: lerp(prev.index.y, next.index.y, alpha),
  };

  return {
    x: (thumb.x + index.x) / 2,
    y: (thumb.y + index.y) / 2,
    isPinching,
    pinchHoldTime,
    pinchProximity: lerp(prev.pinchProximity ?? 0, next.pinchProximity, alpha),
    thumb,
    index,
  };
}
