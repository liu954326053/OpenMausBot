import { botNodeId, CANVAS_MAX_NODES, CANVAS_NODE_SIZE, canvasFileNodeType, type CanvasDocument, type CanvasFileRef, type CanvasNode, type CanvasNodeMetadata } from "../../shared/project-canvas.ts";
import type { TeamProjectWire } from "../../shared/team-projects.ts";
import { userError } from "../user-errors.ts";
import { botsAt } from "./flow.ts";
import { isProjectPathError, openProjectFile } from "./paths.ts";
import { episodesOf, isFinal, isProfile, isTake } from "./pipeline-nodes.ts";
import { listShots, selectTake, type PipelineShot } from "./pipeline-shots.ts";
import { placeAfter, placeForActor } from "./placement.ts";
import { CanvasRefusal, pathRefusal, readOnlyRefusal, type CanvasPipelineEvent, type ProjectCanvasService } from "./service.ts";

export type { CanvasPipelineEvent } from "./service.ts";
export type { PipelineShot, PipelineTake } from "./pipeline-shots.ts";

/** An episode as the canvas has it: its script node. */
export interface CanvasEpisode {
  episode: number;
  nodeId: string;
  title: string;
}

/** A character's or a scene's profile on the canvas, with the image nodes of its group. */
export interface CanvasProfile {
  nodeId: string;
  role: "character" | "scene";
  title: string;
  subtitle?: string;
  /** `ready`: it holds a picture. `loading`: one is generated. `error`: generating failed. `empty`: it has a prompt and
   * was never generated. */
  pictures: Array<{ nodeId: string; state: "ready" | "loading" | "error" | "empty" }>;
}

export interface PipelineView {
  episodes: CanvasEpisode[];
  shots: PipelineShot[];
  profiles: CanvasProfile[];
}

/** What the rest of the server asks of the production's nodes on a project's canvas. Every call that changes a canvas
 * is refused for an archived project, as a change to its canvas is, and answers the canvas's revision after it. */
export interface CanvasPipelineApi {
  /** The project's shots episode by episode, each with its selected take or none. */
  shots(projectId: string): PipelineShot[];
  /** The episodes' scripts by number. */
  episodes(projectId: string): CanvasEpisode[];
  /** The characters and scenes in the order they were added. */
  profiles(projectId: string): CanvasProfile[];
  /** The episodes, the shots and the profiles from one reading of the canvas. */
  view(projectId: string): PipelineView;
  /** The brief's rows go on the canvas as the lead's brief, made or brought up to date, and the node that stands for
   * the lead's split of the work is there with it. */
  setBrief(projectId: string, leadBotId: string, rows: ReadonlyArray<readonly [string, string]>, titles: { brief: string; plan: string }): { revision: number };
  /** A take becomes its shot's selected take, and the shot's other takes lose the mark. */
  selectTake(projectId: string, nodeId: string): { revision: number };
  /** A video file in the project folder, by its path relative to it, becomes an episode's finished film: the video
   * node that already shows the file, else the film's node the episode has, which takes the file, else a new one
   * beside the episode's post bot. Without an episode it is the film of a drama made before episodes. */
  addFinal(projectId: string, path: string, episode?: number): Promise<{ nodeId: string; revision: number }>;
  /** Marks the nodes named that are on the canvas stale, or clears the mark with `stale: false`. */
  markStale(projectId: string, nodeIds: readonly string[], stale?: boolean): { revision: number };
  /** `listener` hears, for every project, a node that newly has a role, the end of a take's generation, and a shot's
   * selected take changing. Returns the way to stop listening. */
  on(listener: (event: CanvasPipelineEvent) => void): () => void;
  /** `listener` hears the id of every project whose canvas changed in what `view` answers, or cannot be read after a
   * change. Moving or resizing nodes changes nothing in it. Returns the way to stop listening. */
  onViewChange(listener: (projectId: string) => void): () => void;
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

const episodesIn = (document: CanvasDocument): CanvasEpisode[] => episodesOf(document).map((node) => ({ episode: node.metadata!.episode!, nodeId: node.id, title: node.title }));

function profilesIn({ nodes }: CanvasDocument): CanvasProfile[] {
  return nodes.filter(isProfile).map((profile): CanvasProfile => {
    const pictures = profile.groupId === undefined ? [] : nodes.filter((node) => node.type === "image" && node.groupId === profile.groupId).flatMap((node) => {
      const { file, status, prompt } = node.metadata ?? {};
      const state = file ? "ready" as const : status === "loading" ? "loading" as const : status === "error" ? "error" as const : prompt?.trim() ? "empty" as const : null;
      return state ? [{ nodeId: node.id, state }] : [];
    });
    const subtitle = profile.metadata?.card?.subtitle;
    return { nodeId: profile.id, role: profile.metadata!.role as CanvasProfile["role"], title: profile.title, ...(subtitle ? { subtitle } : {}), pictures };
  });
}

export function createCanvasPipeline(service: ProjectCanvasService): CanvasPipelineApi {
  const open = (projectId: string): TeamProjectWire => {
    const project = service.project(projectId);
    if (project.archivedAt !== undefined) throw readOnlyRefusal();
    return project;
  };
  const read = (projectId: string) => service.document(service.project(projectId));
  const view = (projectId: string): PipelineView => {
    const document = read(projectId);
    return { episodes: episodesIn(document), shots: listShots(document), profiles: profilesIn(document) };
  };

  return {
    shots: (projectId) => listShots(read(projectId)),

    episodes: (projectId) => episodesIn(read(projectId)),

    profiles: (projectId) => profilesIn(read(projectId)),

    view,

    setBrief(projectId, leadBotId, rows, titles) {
      const project = open(projectId);
      const card = { rows: rows.map(([label, value]): [string, string] => [label, value]) };
      return { revision: service.serverChange(project, (document, bots) => {
        const changed: string[] = [];
        const lead = { kind: "bot", botId: leadBotId } as const;
        const held = (role: "brief" | "plan") => document.nodes.find((node) => node.type === "text" && node.metadata?.role === role);
        const add = (role: "brief" | "plan", title: string, metadata: CanvasNodeMetadata) => {
          if (document.nodes.length >= CANVAS_MAX_NODES) throw new CanvasRefusal(413, { code: "limit", error: `a canvas holds at most ${CANVAS_MAX_NODES} nodes` });
          const node: CanvasNode = { id: service.newId(), type: "text", title, position: { x: 0, y: 0 }, ...CANVAS_NODE_SIZE.text, metadata: { ...metadata, role }, createdBy: lead };
          node.position = placeForActor(document, node, lead, bots, service.reserved(project.id, document));
          document.nodes.push(node);
          changed.push(node.id);
        };
        const brief = held("brief");
        if (!brief) add("brief", titles.brief, { card });
        else if (JSON.stringify(brief.metadata?.card?.rows) !== JSON.stringify(card.rows)) {
          brief.metadata = { ...brief.metadata, card: { ...brief.metadata?.card, ...card } };
          changed.push(brief.id);
        }
        if (!held("plan")) add("plan", titles.plan, {});
        return changed.length ? { nodes: changed, connections: [] } : null;
      }).revision };
    },

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

    async addFinal(projectId, path, episode) {
      const project = open(projectId);
      const ofEpisode = episode === undefined ? {} : { episode };
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
        const films = document.nodes.filter((node) => isFinal(node) && node.metadata?.episode === episode);
        const shows = document.nodes.find((node) => node.type === "video" && node.metadata?.file?.path === file.path && (!node.metadata.role || node.metadata.role === "final"));
        const film = shows ?? films[0];
        if (film) {
          nodeId = film.id;
          const same = film.metadata?.role === "final" && film.metadata.episode === episode && film.metadata.file?.path === file.path && film.metadata.file.bytes === file.bytes;
          const others = films.filter((node) => node !== film);
          if (same && !others.length) return null;
          for (const node of others) setMetadata(node, without(node.metadata, "role", "episode"));
          if (!shows) film.title = file.name;
          film.metadata = { ...without(film.metadata, "stale", "episode"), file, role: "final", ...ofEpisode };
          return { nodes: [film.id, ...others.map((node) => node.id)], connections: [] };
        }
        if (document.nodes.length >= CANVAS_MAX_NODES) throw new CanvasRefusal(413, { code: "limit", error: `a canvas holds at most ${CANVAS_MAX_NODES} nodes` });
        const added: CanvasNode = { id: service.newId(), type: "video", title: file.name, position: { x: 0, y: 0 }, ...CANVAS_NODE_SIZE.video, metadata: { file, role: "final", ...ofEpisode }, createdBy: { kind: "person" } };
        const post = botsAt(service.flow(project), "post").find((botId) => project.episodeBots[botId]?.number === episode);
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

    on: (listener) => service.onPipeline(listener),

    onViewChange(listener) {
      const seen = new Map<string, string>();
      return service.onChange((projectId) => {
        let now: string;
        try {
          now = JSON.stringify(view(projectId));
        } catch {
          seen.delete(projectId);
          listener(projectId);
          return;
        }
        if (seen.get(projectId) === now) return;
        seen.set(projectId, now);
        listener(projectId);
      });
    },
  };
}
