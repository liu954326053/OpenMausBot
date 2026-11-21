import { createContext, useContext } from "react";
import type { CanvasConnection, CanvasNode, CanvasNodeMetadataPatch, CanvasNodeType, CanvasPoint, CanvasSnapshot } from "../../../shared/project-canvas";
import type { CanvasController, CanvasState } from "@/lib/project-canvas/controller";
import type { HandleType } from "@/lib/project-canvas/geometry";

export type CanvasTool = "select" | "pan";
export type CreatableNodeType = Exclude<CanvasNodeType, "bot" | "audio" | "file">;

/** What every part of the canvas reads, and the changes it can ask for. */
export interface CanvasUi {
  controller: CanvasController;
  state: CanvasState;
  snapshot: CanvasSnapshot;
  readOnly: boolean;
  selection: ReadonlySet<string>;
  selectedConnectionId: string | null;
  panelNodeId: string | null;
  /** The node whose reference bar is taking clicked nodes as references. */
  pickingFor: string | null;
  drafts: Map<string, string>;
  select(ids: Iterable<string>): void;
  selectConnection(id: string | null): void;
  openPanel(nodeId: string | null): void;
  createNode(type: CreatableNodeType, at?: CanvasPoint, connectFrom?: string | { nodeId: string; handle: HandleType }): string | null;
  renameNode(nodeId: string, title: string): void;
  updateMetadata(nodeId: string, metadata: CanvasNodeMetadataPatch): void;
  connect(fromNodeId: string, toNodeId: string): void;
  removeReference(nodeId: string, sourceNodeId: string): void;
  deleteNodes(ids: Iterable<string>): void;
  startPicking(nodeId: string | null): void;
  focusNode(nodeId: string): void;
  previewImage(url: string, title: string): void;
  /** Gives a picture's node its picture's shape once the picture loads, in free space if that shape would cover a node. */
  fitPicture(nodeId: string, naturalWidth: number, naturalHeight: number): void;
  uploadFiles(files: readonly File[], at?: CanvasPoint): void;
  showNotice(text: string): void;
  openSettings(): void;
}

export const CanvasUiContext = createContext<CanvasUi | null>(null);

export function useCanvasUi(): CanvasUi {
  const ui = useContext(CanvasUiContext);
  if (!ui) throw new Error("useCanvasUi needs a CanvasUiContext provider");
  return ui;
}

/** The page's reading direction, for what floats over the canvas, which is always laid out left to right. */
export const pageDirection = (): "ltr" | "rtl" => (typeof document !== "undefined" && document.documentElement.dir === "rtl" ? "rtl" : "ltr");

export const nodeById = (snapshot: Pick<CanvasSnapshot, "nodes">, id: string): CanvasNode | undefined => snapshot.nodes.find((node) => node.id === id);

/** The nodes connected to the selected ones, which draw as related. */
export function relatedNodeIds(selection: ReadonlySet<string>, connections: readonly CanvasConnection[]): Set<string> {
  const related = new Set<string>();
  for (const connection of connections) {
    if (selection.has(connection.fromNodeId) && !selection.has(connection.toNodeId)) related.add(connection.toNodeId);
    if (selection.has(connection.toNodeId) && !selection.has(connection.fromNodeId)) related.add(connection.fromNodeId);
  }
  return related;
}
