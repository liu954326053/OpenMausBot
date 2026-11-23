import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { vi, type Mock } from "vitest";
import type { BoardAnchor, BoardOpened, BoardOverlayProps } from "@/lib/production-board/overlay";
import { ProductionBoardOverlay } from "../ProductionBoardOverlay";
import { boardSnapshot, fakeBackend, SAMPLE_PROJECT_ID, type FakeBackend } from "./board-sample";

export interface LayerSize {
  width: number;
  height: number;
}

export interface OverlayHarness {
  host: HTMLElement;
  /** Around the overlay, with handlers like the board's own: React ones for pointers, double and right clicks, a native one for the wheel. */
  board: HTMLElement;
  /** The types of the events that reached the board's handlers. */
  boardHeard: string[];
  fake: FakeBackend;
  /** Card rectangles by node id, as the board would report them. */
  anchors: Map<string, BoardAnchor>;
  open: Mock<(what: BoardOpened) => void>;
  close: Mock<() => void>;
  focusNode: Mock<(nodeId: string) => void>;
  focusEpisode: Mock<(episode: number) => void>;
  current(): BoardOverlayProps;
  update(next: Partial<BoardOverlayProps>): Promise<void>;
  /** The board panned or zoomed. */
  moveView(): Promise<void>;
  /** Lets pending reads and sends finish. */
  settle(): Promise<void>;
  unmount(): void;
}

/** Every element's observed size is `size`, as the board's layer would be. */
function sizedObserver(size: LayerSize) {
  return class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback([{ target, contentRect: size } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  };
}

/** Renders the overlay as the board does: it holds `opened`, which `open` and `close` change. */
export async function renderOverlay(overrides: Partial<BoardOverlayProps> = {}, layer: LayerSize = { width: 1440, height: 900 }, fake = fakeBackend()): Promise<OverlayHarness> {
  vi.stubGlobal("ResizeObserver", sizedObserver(layer));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const anchors = new Map<string, BoardAnchor>();
  const listeners = new Set<() => void>();
  const boardHeard: string[] = [];
  const hear = (event: { type: string }) => boardHeard.push(event.type);
  let props: BoardOverlayProps;
  const render = () => act(async () => {
    root.render(createElement("div", { "data-test-board": "", onPointerDown: hear, onDoubleClick: hear, onContextMenu: hear }, createElement(ProductionBoardOverlay, props)));
  });
  const update = async (next: Partial<BoardOverlayProps>) => {
    props = { ...props, ...next };
    await render();
  };
  const open = vi.fn((what: BoardOpened) => void update({ opened: what }));
  const close = vi.fn(() => void update({ opened: null }));
  const focusNode = vi.fn<(nodeId: string) => void>();
  const focusEpisode = vi.fn<(episode: number) => void>();
  props = {
    projectId: SAMPLE_PROJECT_ID,
    snapshot: boardSnapshot(),
    backend: fake.backend,
    opened: null,
    open,
    close,
    anchorOf: (nodeId) => anchors.get(nodeId) ?? null,
    subscribeView: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    focusNode,
    focusEpisode,
    focusStage: vi.fn(),
    ...overrides,
  };
  await render();
  const board = host.querySelector<HTMLElement>("[data-test-board]")!;
  board.addEventListener("wheel", hear);
  const settle = () => act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await settle();
  return {
    host,
    board,
    boardHeard,
    fake,
    anchors,
    open,
    close,
    focusNode,
    focusEpisode,
    current: () => props,
    update,
    moveView: () => act(async () => {
      for (const listener of listeners) listener();
    }),
    settle,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    },
  };
}
