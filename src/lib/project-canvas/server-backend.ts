import type {
  CanvasConflict,
  CanvasOpsResponse,
  CanvasReadOnly,
  CanvasSnapshot,
  CanvasTaskResponse,
  CanvasUploadResponse,
  ProjectCanvasEvent,
} from "../../../shared/project-canvas";
import type { GenerationFailure, GenerationModelsWire, GenerationSettingsWire, Refused } from "../../../shared/project-generation";
import { api, ApiError } from "../../state/api";
import type { Bot, Message } from "../../state/store";
import type { StoreRef } from "../../state/store-ref-context";
import { openBot, openThread } from "../../state/thread-navigation";
import { readAdvancedMode } from "../interface-mode";
import { listenLiveFrames } from "../live-events";
import { showThreads } from "../thread-preferences";
import { CanvasBackendError, type CanvasBackend } from "./backend";
import type { CanvasBotLook, CanvasExchangeMessage } from "./types";

/** How many of the newest messages of a bot's conversation are read for its latest exchange. */
const EXCHANGE_READ = 40;
const CANVAS_REFUSALS = new Set(["canvas_conflict", "canvas_stale", "canvas_read_only"]);
const GENERATION_NOT_WIRED = "Generating from the canvas waits for the canvas server's generate route.";

const projectPath = (projectId: string) => `/api/team-projects/${encodeURIComponent(projectId)}`;
const canvasPath = (projectId: string) => `${projectPath(projectId)}/canvas`;
const generationPath = (projectId: string) => `${projectPath(projectId)}/generation`;

async function canvasCall<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await api<T>(path, init);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && CANVAS_REFUSALS.has(String(error.body?.code))) {
      throw new CanvasBackendError(error.message, error.body as unknown as CanvasConflict | CanvasReadOnly);
    }
    throw error;
  }
}

const isGenerationFailure = (body: unknown): body is GenerationFailure => {
  const failure = body as Partial<GenerationFailure> | undefined;
  return typeof failure?.code === "string" && typeof failure.errorKey === "string";
};

async function generationCall<T>(path: string, init?: RequestInit): Promise<T | Refused> {
  try {
    return await api<T>(path, init);
  } catch (error) {
    if (error instanceof ApiError && isGenerationFailure(error.body)) return { refused: error.body };
    throw error;
  }
}

const isEventOf = (projectId: string, frame: unknown) => {
  const event = frame as Partial<ProjectCanvasEvent>;
  return event.kind === "project-canvas" && event.projectId === projectId;
};

function lookOf(bot: Bot): CanvasBotLook {
  const { color, avatarUrl, avatarCrop, avatarZoom, avatarFocusX, avatarFocusY, mascotBody, mascotFaceColor } = bot;
  const look: CanvasBotLook = { color, avatarUrl, avatarCrop, avatarZoom, avatarFocusX, avatarFocusY, mascotBody, mascotFaceColor };
  return Object.fromEntries(Object.entries(look).filter(([, value]) => value !== undefined)) as CanvasBotLook;
}

const looksOf = (bots: readonly Bot[]) => Object.fromEntries(bots.map((bot) => [bot.id, lookOf(bot)]));

function exchangeOf(messages: readonly Message[]): CanvasExchangeMessage[] {
  const said = messages.flatMap((message): CanvasExchangeMessage[] => (message.kind === "text" && message.text?.trim()
    ? [{ id: message.id, role: message.role === "user" ? "person" : "bot", text: message.text, at: message.at }]
    : []));
  const lastAsk = said.findLastIndex((message) => message.role === "person");
  return lastAsk < 0 ? said.slice(-1) : said.slice(lastAsk);
}

export interface ServerCanvasBackend extends CanvasBackend {
  /** Hears the app store's bots; the open canvas reads the looks again when they differ from those it was given. */
  followBots(bots: readonly Bot[]): void;
}

/** The project canvas on the app's server: requests through the app's `api`, live events from its `/api/events`
 * stream, and the bots, conversations, navigation and Stop as the app's store has them. */
export function createServerCanvasBackend(store: StoreRef): ServerCanvasBackend {
  const botOf = (botId: string) => store.state().bots.find((bot) => bot.id === botId);
  const threadsShown = () => readAdvancedMode() && showThreads();
  const listeners = new Set<() => void>();
  let givenLooks = "";

  return {
    readSnapshot: (projectId) => canvasCall<CanvasSnapshot>(canvasPath(projectId)),

    applyOps: (projectId, request) => canvasCall<CanvasOpsResponse>(`${canvasPath(projectId)}/ops`, { method: "POST", body: JSON.stringify(request) }),

    subscribe(projectId, onChange) {
      listeners.add(onChange);
      const stopListening = listenLiveFrames({
        onFrame: (frame) => {
          if (isEventOf(projectId, frame)) onChange();
        },
        onMissedFrames: onChange,
      });
      return () => {
        listeners.delete(onChange);
        stopListening();
      };
    },

    followBots(bots) {
      if (JSON.stringify(looksOf(bots)) !== givenLooks) for (const listener of listeners) listener();
    },

    uploadFile(projectId, file, at) {
      const query = new URLSearchParams({ name: file.name });
      if (at) {
        query.set("x", String(Math.round(at.x)));
        query.set("y", String(Math.round(at.y)));
      }
      return canvasCall<CanvasUploadResponse>(`${canvasPath(projectId)}/files?${query}`, {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
    },

    fileUrl: (projectId, file) => `${canvasPath(projectId)}/files?${new URLSearchParams({ path: file.path })}`,

    async readBotLooks() {
      const looks = looksOf(store.state().bots);
      givenLooks = JSON.stringify(looks);
      return looks;
    },

    sendTask: (projectId, { botId, text, threadId }) => canvasCall<CanvasTaskResponse>(`${canvasPath(projectId)}/tasks`, {
      method: "POST",
      body: JSON.stringify({ botId, text, ...(threadId ? { threadId } : {}) }),
    }),

    async stopBot(_projectId, botId) {
      const busy = (botOf(botId)?.tasks ?? []).filter((task) => task.busy).map((task) => task.threadId);
      if (!busy.length) store.dispatch({ type: "interrupt", botId });
      for (const threadId of busy) store.dispatch({ type: "interrupt", botId, threadId });
    },

    async readExchange(_projectId, botId) {
      const bot = botOf(botId);
      const threadId = bot?.mainThreadId ?? bot?.threadId;
      if (!threadId) return [];
      const { messages } = await api<{ messages: Message[] }>(`/api/threads/${encodeURIComponent(threadId)}/messages?limit=${EXCHANGE_READ}`);
      return exchangeOf(messages);
    },

    openChat(_projectId, botId, threadId) {
      const state = store.state();
      const bot = state.bots.find((candidate) => candidate.id === botId);
      if (!bot) return;
      if (threadId) openThread(store.dispatch, { botId, threadId }, state, threadsShown());
      else openBot(store.dispatch, bot, threadsShown());
    },

    readGenerationSettings: (projectId) => api<GenerationSettingsWire>(`${generationPath(projectId)}/settings`),

    saveGenerationSettings: (projectId, settings) => generationCall<GenerationSettingsWire>(`${generationPath(projectId)}/settings`, {
      method: "PUT",
      body: JSON.stringify(settings),
    }),

    listModels(projectId, kind, preview) {
      const query = new URLSearchParams({ kind });
      if (preview) query.set("server", preview.server);
      return generationCall<GenerationModelsWire>(`${generationPath(projectId)}/models?${query}`);
    },

    startGeneration: () => Promise.reject(new Error(GENERATION_NOT_WIRED)),

    cancelGeneration: () => Promise.reject(new Error(GENERATION_NOT_WIRED)),
  };
}
