import {
  botNodeId, CANVAS_CONTENT_MAX_CHARS, CANVAS_MAX_NODES, CANVAS_NODE_SIZE, CANVAS_TITLE_MAX_CHARS, canvasFileNodeType, type CanvasFileRef, type CanvasNode, type CanvasNodeMetadata,
} from "../../shared/project-canvas.ts";
import type { TeamProjectWire } from "../../shared/team-projects.ts";
import { userError } from "../user-errors.ts";
import { botsAt } from "./flow.ts";
import { isProjectPathError, openProjectFile } from "./paths.ts";
import { isTake, makerOf } from "./pipeline-nodes.ts";
import { listShots, selectTake, type PipelineShot } from "./pipeline-shots.ts";
import { placeAfter, placeForActor } from "./placement.ts";
import { CanvasRefusal, pathRefusal, readOnlyRefusal, type CanvasPipelineEvent, type ProjectCanvasService } from "./service.ts";

export type { CanvasPipelineEvent } from "./service.ts";
export type { PipelineShot, PipelineTake } from "./pipeline-shots.ts";

/** What the rest of the server asks of the pipeline's nodes on a project's canvas. Every call that changes a canvas is
 * refused for an archived project, as a change to its canvas is, and answers the canvas's revision after it. */
export interface CanvasPipelineApi {
  /** The project's shots from top to bottom by their place on the canvas, each with its selected take or none. */
  shots(projectId: string): PipelineShot[];
  /** A take becomes its shot's selected take, and the shot's other takes lose the mark. */
  selectTake(projectId: string, nodeId: string): { revision: number };
  /** A video file in the project folder, by its path relative to it, becomes the finished film's node: the video node
   * that already shows the file, else the film's node there is, which takes the file, else a new one beside the first
   * post bot. */
  addFinal(projectId: string, path: string): Promise<{ nodeId: string; revision: number }>;
  /** Marks the nodes named that are on the canvas stale, or clears the mark with `stale: false`. */
  markStale(projectId: string, nodeIds: readonly string[], stale?: boolean): { revision: number };
  /** A text node becomes the script and is no longer stale; an older script of the same maker is a plain text node
   * again. */
  markScript(projectId: string, nodeId: string): { revision: number };
  /** The project's text nodes in the order they were added, each with the bot that made it when a bot did. */
  textNodes(projectId: string): Array<{ nodeId: string; botId?: string }>;
  /** A text node holding `content`, made by `botId` and placed in its lane as one it adds is. Content past
   * `CANVAS_CONTENT_MAX_CHARS` is cut. */
  addText(projectId: string, botId: string, title: string, content: string): { nodeId: string; revision: number };
  /** `listener` hears, for every project, a node that newly has a role, the end of a take's generation, and a shot's
   * selected take changing. Returns the way to stop listening. */
  on(listener: (event: CanvasPipelineEvent) => void): () => void;
}

function without(metadata: CanvasNodeMetadata | undefined, ...keys: Array<keyof CanvasNodeMetadata>): CanvasNodeMetadata {
  const copy = { ...metadata };
  for (const key of keys) delete copy[key];
  return copy;
}

function setMetadata(node: CanvasNode, metadata: CanvasNodeMetadata): void {
  if (Object.keys(metadata).length) node.metadata = metadata;
  else delete node.metadata;
}

const missing = () => new CanvasRefusal(404, { code: "not_found", ...userError("serverError.projectCanvas.nodeMissing") });

export function createCanvasPipeline(service: ProjectCanvasService): CanvasPipelineApi {
  const open = (projectId: string): TeamProjectWire => {
    const project = service.project(projectId);
    if (project.archivedAt !== undefined) throw readOnlyRefusal();
    return project;
  };

  return {
    shots: (projectId) => listShots(service.document(service.project(projectId))),

    selectTake(projectId, nodeId) {
      const project = open(projectId);
      return { revision: service.serverChange(project, (document) => {
        const take = document.nodes.find((node) => node.id === nodeId);
        if (!take) throw missing();
        if (!isTake(take) || !take.metadata?.file) throw new CanvasRefusal(400, { code: "not_a_take", error: "Only a take, a video generated for a shot, can be selected." });
        const nodes = selectTake(document, take);
        return nodes.length ? { nodes, connections: [] } : null;
      }).revision };
    },

    async addFinal(projectId, path) {
      const project = open(projectId);
      if (project.folderState !== "ready") throw new CanvasRefusal(409, userError("serverError.projectCanvas.folderMissing", { folder: project.folder }));
      let file: CanvasFileRef;
      try {
        const opened = await openProjectFile(project.folder, path, Number.POSITIVE_INFINITY);
        await opened.handle.close();
        file = { path: opened.path, mime: opened.mime, bytes: opened.bytes, name: opened.name };
      } catch (error) {
        throw isProjectPathError(error) ? pathRefusal(error, project.folder) : error;
      }
      if (canvasFileNodeType(file.mime) !== "video") throw new CanvasRefusal(400, { code: "not_a_video", error: "The finished film must be a video file." });
      let nodeId = "";
      const { revision } = service.serverChange(open(projectId), (document, bots) => {
        const films = document.nodes.filter((node) => node.type === "video" && node.metadata?.role === "final");
        const shows = document.nodes.find((node) => node.type === "video" && node.metadata?.file?.path === file.path && (!node.metadata.role || node.metadata.role === "final"));
        const film = shows ?? films[0];
        if (film) {
          nodeId = film.id;
          const same = film.metadata?.role === "final" && film.metadata.file?.path === file.path && film.metadata.file.bytes === file.bytes;
          const others = films.filter((node) => node !== film);
          if (same && !others.length) return null;
          for (const node of others) setMetadata(node, without(node.metadata, "role"));
          if (!shows) film.title = file.name;
          film.metadata = { ...without(film.metadata, "stale"), file, role: "final" };
          return { nodes: [film.id, ...others.map((node) => node.id)], connections: [] };
        }
        if (document.nodes.length >= CANVAS_MAX_NODES) throw new CanvasRefusal(413, { code: "limit", error: `a canvas holds at most ${CANVAS_MAX_NODES} nodes` });
        const added: CanvasNode = { id: service.newId(), type: "video", title: file.name, position: { x: 0, y: 0 }, ...CANVAS_NODE_SIZE.video, metadata: { file, role: "final" }, createdBy: { kind: "person" } };
        const post = botsAt(service.flow(project), "post")[0];
        const beside = post === undefined ? undefined : bots.get(botNodeId(post));
        const reserved = service.reserved(project.id, document);
        added.position = beside
          ? placeAfter(document, { id: botNodeId(post!), type: "bot", title: "", ...beside }, added, bots, reserved)
          : placeForActor(document, added, { kind: "person" }, bots, reserved);
        document.nodes.push(added);
        nodeId = added.id;
        return { nodes: [added.id], connections: [] };
      });
      return { nodeId, revision };
    },

    markStale(projectId, nodeIds, stale = true) {
      const named = new Set(nodeIds);
      return { revision: service.serverChange(open(projectId), (document) => {
        const nodes = document.nodes.filter((node) => named.has(node.id) && node.type !== "bot" && Boolean(node.metadata?.stale) !== stale);
        for (const node of nodes) setMetadata(node, stale ? { ...node.metadata, stale: true } : without(node.metadata, "stale"));
        return nodes.length ? { nodes: nodes.map((node) => node.id), connections: [] } : null;
      }).revision };
    },

    markScript(projectId, nodeId) {
      return { revision: service.serverChange(open(projectId), (document) => {
        const script = document.nodes.find((node) => node.id === nodeId);
        if (!script) throw missing();
        if (script.type !== "text") throw new CanvasRefusal(400, { code: "not_a_text", error: "Only a text node can be the script." });
        const older = document.nodes.filter((node) => node !== script && node.type === "text" && node.metadata?.role === "script" && makerOf(node) === makerOf(script));
        if (script.metadata?.role === "script" && !script.metadata.stale && !older.length) return null;
        for (const node of older) setMetadata(node, without(node.metadata, "role"));
        script.metadata = { ...without(script.metadata, "stale"), role: "script" };
        return { nodes: [script.id, ...older.map((node) => node.id)], connections: [] };
      }).revision };
    },

    textNodes: (projectId) => service.document(service.project(projectId)).nodes.flatMap((node) => {
      if (node.type !== "text") return [];
      const botId = makerOf(node);
      return [botId === undefined ? { nodeId: node.id } : { nodeId: node.id, botId }];
    }),

    addText(projectId, botId, title, content) {
      const added = service.apply(open(projectId), { kind: "bot", botId }, [{
        type: "add_node", nodeType: "text", title: title.slice(0, CANVAS_TITLE_MAX_CHARS), metadata: { content: content.slice(0, CANVAS_CONTENT_MAX_CHARS) },
      }]);
      return { nodeId: added.nodeIds[0] ?? "", revision: added.revision };
    },

    on: (listener) => service.onPipeline(listener),
  };
}
