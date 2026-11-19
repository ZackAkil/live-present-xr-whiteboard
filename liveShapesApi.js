import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAI,
  getLiveGenerativeModel,
  GoogleAIBackend,
  ResponseModality,
  Schema,
  startAudioConversation,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-ai.js';

const LIVE_MODEL = 'gemini-3.1-flash-live-preview';

const SPAWN_SHAPE_TOOL = {
  name: 'spawn_shape',
  description: 'Spawn one or more floating shapes onto the XR canvas, optionally with text inside.',
  parameters: Schema.object({
    properties: {
      type: Schema.string({
        description: 'Shape type: circle, square, triangle, or hexagon.',
      }),
      color: Schema.string({
        description: 'Optional CSS color (e.g. red, cyan, #ff5500).',
      }),
      text: Schema.string({
        description: 'Optional short text label to display inside the shape.',
      }),
      count: Schema.integer({
        description: 'Number of shapes to spawn (1 to 10). Defaults to 1.',
      }),
    },
    optionalProperties: ['color', 'text', 'count'],
  }),
};

const SPAWN_TEXT_BOX_TOOL = {
  name: 'spawn_text_box',
  description: 'Spawn a floating text box onto the XR canvas.',
  parameters: Schema.object({
    properties: {
      text: Schema.string({
        description: 'The text content to display inside the text box.',
      }),
      color: Schema.string({
        description: 'Optional background CSS color for the text box.',
      }),
    },
    optionalProperties: ['color'],
  }),
};

const CLEAR_SHAPES_TOOL = {
  name: 'clear_shapes',
  description: 'Clear all shapes, text boxes, and drawings from the XR canvas.',
  parameters: Schema.object({
    properties: {},
  }),
};

const SYSTEM_INSTRUCTION =
  'You are a silent canvas assistant for an AR whiteboard. ' +
  'ONLY call a function when the user explicitly asks for that specific action—never call functions speculatively or during casual speech: ' +
  'call spawn_shape only when explicitly asked to add/create/spawn a shape; ' +
  'call spawn_text_box only when explicitly asked to add a text box/note/label; ' +
  'call clear_shapes only when explicitly asked to clear or reset the space. ' +
  'Otherwise, and after any function call, respond only with "OK".';

let aiInstance = null;

async function getAi() {
  if (!aiInstance) {
    let firebaseConfig;
    try {
      ({ firebaseConfig } = await import('./firebase-config.js'));
    } catch {
      throw new Error(
        'Missing firebase-config.js. Copy firebase-config.example.js to firebase-config.js and add your Firebase credentials.'
      );
    }
    const app = initializeApp(firebaseConfig);
    aiInstance = getAI(app, { backend: new GoogleAIBackend() });
  }
  return aiInstance;
}

/**
 * Strip incoming audio inlineData parts so the Live API stays muted
 * while still streaming mic input and executing function calls.
 */
function muteSessionAudio(session) {
  const originalReceive = session.receive.bind(session);
  session.receive = async function* () {
    for await (const message of originalReceive()) {
      if (message.type === 'serverContent' && message.modelTurn?.parts) {
        message.modelTurn.parts = message.modelTurn.parts.filter(
          (part) => !part.inlineData
        );
      }
      yield message;
    }
  };
}

/**
 * Start a muted Gemini Live session wired to shape and text-box function calls.
 * @param {{
 *   onSpawnShape: (args: { type?: string, color?: string, text?: string, count?: number }) => number,
 *   onSpawnTextBox: (args: { text?: string, color?: string }) => boolean,
 *   onClearShapes: () => void,
 * }} handlers
 * @returns {Promise<{ stop: () => Promise<void> }>}
 */
export async function startMutedLiveSession({
  onSpawnShape,
  onSpawnTextBox,
  onClearShapes,
}) {
  const model = getLiveGenerativeModel(await getAi(), {
    model: LIVE_MODEL,
    systemInstruction: SYSTEM_INSTRUCTION,
    tools: [
      {
        functionDeclarations: [
          SPAWN_SHAPE_TOOL,
          SPAWN_TEXT_BOX_TOOL,
          CLEAR_SHAPES_TOOL,
        ],
      },
    ],
    generationConfig: {
      responseModalities: [ResponseModality.AUDIO],
      temperature: 0.7,
    },
  });

  const session = await model.connect();
  muteSessionAudio(session);

  let controller = null;

  const stop = async () => {
    try {
      if (controller) {
        await controller.stop();
        controller = null;
      }
      if (!session.isClosed) {
        await session.close();
      }
    } catch {
      // Ignore cleanup errors during teardown.
    }
  };

  try {
    controller = await startAudioConversation(session, {
      functionCallingHandler: async (functionCalls) => {
        const call = functionCalls[0];
        if (call?.name === 'spawn_shape') {
          const spawned = onSpawnShape(call.args ?? {});
          return { id: call.id, name: call.name, response: { spawned } };
        }
        if (call?.name === 'spawn_text_box') {
          const created = onSpawnTextBox(call.args ?? {});
          return { id: call.id, name: call.name, response: { created } };
        }
        if (call?.name === 'clear_shapes') {
          onClearShapes();
          return { id: call.id, name: call.name, response: { cleared: true } };
        }
        return {
          id: call?.id,
          name: call?.name ?? 'unknown',
          response: { error: 'Unsupported function call' },
        };
      },
    });
  } catch (err) {
    await stop();
    throw err;
  }

  return { stop };
}
