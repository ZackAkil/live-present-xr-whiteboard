/**
 * Request webcam access and attach the stream to the video element.
 * @param {HTMLVideoElement} videoEl
 * @returns {Promise<HTMLVideoElement>}
 */
export async function setupCamera(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });

  videoEl.srcObject = stream;
  await new Promise((resolve) => {
    videoEl.onloadedmetadata = () => resolve();
  });
  await videoEl.play();
  return videoEl;
}

/**
 * Initialize TensorFlow.js WebGL backend and MediaPipe Hands detector.
 * @returns {Promise<object>}
 */
export async function createHandDetector() {
  await window.tf.setBackend('webgl');
  await window.tf.ready();

  const model = window.handPoseDetection.SupportedModels.MediaPipeHands;
  return window.handPoseDetection.createDetector(model, {
    runtime: 'mediapipe',
    solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands',
    modelType: 'full',
    maxHands: 2,
  });
}

/**
 * Estimate hand keypoints for the current video frame.
 * @param {object} detector
 * @param {HTMLVideoElement} videoEl
 * @returns {Promise<Array<object>>}
 */
export async function detectHands(detector, videoEl) {
  if (videoEl.readyState < 2) return [];
  return detector.estimateHands(videoEl, { flipHorizontal: false });
}
