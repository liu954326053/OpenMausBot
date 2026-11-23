import { createContext, useContext } from "react";
import type { CanvasNode, CanvasSnapshot } from "../../../shared/project-canvas";
import type { CanvasController, CanvasState } from "@/lib/project-canvas/controller";

/** What the project's view shares with what it opens over the board, such as the project's settings. */
export interface CanvasUi {
  controller: CanvasController;
  state: CanvasState;
  snapshot: CanvasSnapshot;
  readOnly: boolean;
  /** The node whose details are open over the board. */
  panelNodeId: string | null;
}

export const CanvasUiContext = createContext<CanvasUi | null>(null);

export function useCanvasUi(): CanvasUi {
  const ui = useContext(CanvasUiContext);
  if (!ui) throw new Error("useCanvasUi needs a CanvasUiContext provider");
  return ui;
}

export const nodeById = (snapshot: Pick<CanvasSnapshot, "nodes">, id: string): CanvasNode | undefined => snapshot.nodes.find((node) => node.id === id);
