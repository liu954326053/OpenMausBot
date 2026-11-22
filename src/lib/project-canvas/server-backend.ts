import type {
  CanvasConflict,
  CanvasGenerateResponse,
  CanvasOpsResponse,
  CanvasReadOnly,
  CanvasSnapshot,
  CanvasTaskResponse,
  CanvasUploadResponse,
  ProjectCanvasEvent,
} from "../../../shared/project-canvas";
import type { ProjectDraftOpenResult } from "../../../shared/project-draft";
import type { GenerationFailure, GenerationModelsWire, GenerationSettingsWire, Refused } from "../../../shared/project-generation";
import { api, ApiError } from "../../state/api";
import type { Bot, Group, Message } from "../../state/store";
import type { StoreRef } from "../../state/store-ref-context";
import { currentTeamProjectSide } from "../../state/team-projects";
import { openBot, openThread } from "../../state/thread-navigation";
import { botShowsUnread } from "../bot-unread";
import { readAdvancedMode } from "../interface-mode";
import { listenLiveFrames } from "../live-events";
import { showThreads } from "../thread-preferences";
import { CanvasBackendError, type CanvasBackend } from "./backend";
import type { CanvasBotLook, CanvasExchangeMessage } from "./types";

/** How many of the newest messages of a bot's conversation are read for its latest exchange. */
const EXCHANGE_READ = 40;
/** A group chat holds every member's lines: a bot's part is read from this many of its newest. */
const ROOM_EXCHANGE_READ = 120;
const CANVAS_REFUSALS = new Set(["canvas_conflict", "canvas_stale", "canvas_read_only"]);

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
    return await canvasCall<T>(path, init);
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
  const look: CanvasBotLook = { color, avatarUrl, avatarCrop, avatarZoom, avatarFocusX, avatarFocusY, mascotBody, mascotFaceColor, unread: botShowsUnread(bot) || undefined };
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

/** A bot's part of a group chat: what it said, and what the person said to it by name. */
function roomExchange(messages: readonly Message[], bot: Pick<Bot, "id" | "name">): Message[] {
  return messages.filter((message) => message.from?.botId === bot.id || (message.role === "user" && Boolean(message.text?.includes(`@${bot.name}`))));
}

const roomOfThread = (groups: readonly Group[], threadId: string) =>
  groups.find((group) => group.threadId === threadId || group.tasks?.some((task) => task.threadId === threadId));

/** The project's group chat while the bot is in it. */
function roomWith(projectId: string, botId: string, groups: readonly Group[]): Group | undefined {
  const side = currentTeamProjectSide();
  const roomId = [...side.projects, ...side.archived].find((project) => project.id === projectId)?.roomId;
  const room = roomId ? groups.find((group) => group.id === roomId) : undefined;
  return room?.memberIds.includes(botId) ? room : undefined;
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
  const desktop = typeof window === "undefined" ? undefined : window.ogb;
  const pathOf = desktop?.remoteClient?.active ? undefined : desktop?.getPathForFile;

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

    sendTask: (projectId, task) => canvasCall<CanvasTaskResponse>(`${canvasPath(projectId)}/tasks`, { method: "POST", body: JSON.stringify(task) }),

    async stopBot(_projectId, botId) {
      const busy = (botOf(botId)?.tasks ?? []).filter((task) => task.busy).map((task) => task.threadId);
      if (!busy.length) store.dispatch({ type: "interrupt", botId });
      for (const threadId of busy) store.dispatch({ type: "interrupt", botId, threadId });
    },

    async readExchange(projectId, botId) {
      const bot = botOf(botId);
      const threadId = bot?.mainThreadId ?? bot?.threadId;
      const room = bot ? roomWith(projectId, botId, store.state().groups) : undefined;
      const read = (thread: string, limit: number) => api<{ messages: Message[] }>(`/api/threads/${encodeURIComponent(thread)}/messages?limit=${limit}`);
      const [own, inRoom] = await Promise.all([
        threadId ? read(threadId, EXCHANGE_READ).then(({ messages }) => exchangeOf(messages)) : [],
        room && bot ? read(room.threadId, ROOM_EXCHANGE_READ).then(({ messages }) => exchangeOf(roomExchange(messages, bot))) : [],
      ]);
      return (inRoom.at(-1)?.at ?? -1) > (own.at(-1)?.at ?? -1) ? inRoom : own;
    },

    openChat(_projectId, botId, threadId) {
      const state = store.state();
      const room = threadId ? roomOfThread(state.groups, threadId) : undefined;
      if (room) {
        store.dispatch({ type: "select", id: room.id });
        return;
      }
      const bot = state.bots.find((candidate) => candidate.id === botId);
      if (!bot) return;
      if (threadId) openThread(store.dispatch, { botId, threadId }, state, threadsShown());
      else openBot(store.dispatch, bot, threadsShown());
    },

    readConversation(_projectId, botId, threadId) {
      const bot = botOf(botId);
      const thread = threadId ?? bot?.mainThreadId ?? bot?.threadId;
      if (!bot || !thread || roomOfThread(store.state().groups, thread)) return;
      const task = bot.tasks?.find((one) => one.threadId === thread);
      if (!(task ? task.unread : bot.unread)) return;
      void api(`/api/bots/${encodeURIComponent(botId)}/read`, { method: "POST", body: JSON.stringify({ threadId: thread }) }).catch(() => {});
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

    startGeneration: (projectId, request) => generationCall<CanvasGenerateResponse>(`${canvasPath(projectId)}/generate`, {
      method: "POST",
      body: JSON.stringify(request),
    }),

    async cancelGeneration(projectId, jobId) {
      await api(`${generationPath(projectId)}/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
    },

    selectTake: (projectId, nodeId) => canvasCall<{ revision: number }>(`${canvasPath(projectId)}/select-take`, { method: "POST", body: JSON.stringify({ nodeId }) }),

    async answerVideos(projectId, input) {
      await canvasCall(`${projectPath(projectId)}/pipeline/videos`, { method: "POST", body: JSON.stringify(input) });
    },

    openDraft: (projectId) => api<ProjectDraftOpenResult>(`${projectPath(projectId)}/draft/open`, { method: "POST" }),

    async setFinalFilm(projectId, input) {
      await canvasCall(`${projectPath(projectId)}/final`, { method: "POST", body: JSON.stringify(input) });
    },

    ...(pathOf ? { localPathOf: (file: File) => pathOf(file) } : {}),
  };
}
