import { CANVAS_NODE_SIZE, canvasFileNodeType, type CanvasNode, type CanvasPoint } from "../../../shared/project-canvas";
import { fitNodeSize } from "./geometry";

type Frame = Pick<CanvasNode, "position" | "width" | "height">;
type Size = Pick<CanvasNode, "width" | "height">;

/** The room a node placed for the person keeps from every other. */
export const PLACEMENT_GAP = 40;
const STEP = 24;
const MAX_RINGS = 160;
/** A step up or down costs this much more than one sideways, so on a screen wider than it is tall new nodes fall into a row. */
const ROW_BIAS = 1.5;

const isFree = (x: number, y: number, size: Size, taken: readonly Frame[]) => taken.every((frame) =>
  x >= frame.position.x + frame.width + PLACEMENT_GAP
  || x + size.width + PLACEMENT_GAP <= frame.position.x
  || y >= frame.position.y + frame.height + PLACEMENT_GAP
  || y + size.height + PLACEMENT_GAP <= frame.position.y);

/** The grid cells `radius` steps from the middle one. */
function ring(radius: number): Array<[number, number]> {
  if (radius === 0) return [[0, 0]];
  const cells: Array<[number, number]> = [];
  for (let i = -radius; i <= radius; i += 1) cells.push([i, -radius], [i, radius]);
  for (let j = 1 - radius; j < radius; j += 1) cells.push([-radius, j], [radius, j]);
  return cells;
}

/**
 * The top left of a node of `size` centred on `center` when it keeps `PLACEMENT_GAP` from every frame in `taken`, and
 * otherwise as near that as it can be: beside it before above or below it, right before left, below before above.
 * At the right of everything when nothing near is free.
 */
export function freeSpot(center: CanvasPoint, size: Size, taken: readonly Frame[]): CanvasPoint {
  const origin = { x: center.x - size.width / 2, y: center.y - size.height / 2 };
  const reach = MAX_RINGS * STEP + PLACEMENT_GAP;
  const near = taken.filter((frame) =>
    frame.position.x < origin.x + size.width + reach && frame.position.x + frame.width > origin.x - reach
    && frame.position.y < origin.y + size.height + reach && frame.position.y + frame.height > origin.y - reach);
  let best: { dx: number; dy: number; cost: number } | null = null;
  for (let radius = 0; radius <= MAX_RINGS && !(best && radius * STEP > best.cost); radius += 1) {
    for (const [i, j] of ring(radius)) {
      const dx = i * STEP;
      const dy = j * STEP;
      const cost = Math.hypot(dx, dy * ROW_BIAS);
      if (best && (cost > best.cost || (cost === best.cost && (dx < best.dx || (dx === best.dx && dy < best.dy))))) continue;
      if (isFree(origin.x + dx, origin.y + dy, size, near)) best = { dx, dy, cost };
    }
  }
  if (best) return { x: origin.x + best.dx, y: origin.y + best.dy };
  return { x: Math.max(...taken.map((frame) => frame.position.x + frame.width)) + PLACEMENT_GAP, y: origin.y };
}

const covers = (a: Frame, b: Frame) => a.position.x < b.position.x + b.width && b.position.x < a.position.x + a.width
  && a.position.y < b.position.y + b.height && b.position.y < a.position.y + a.height;

/** The top left of `node` once it is `size`: where it is while it covers no frame in `taken` there, else the free spot
 * nearest that. */
export function grownSpot(node: Frame, size: Size, taken: readonly Frame[]): CanvasPoint {
  const grown = { position: node.position, ...size };
  if (!taken.some((frame) => covers(grown, frame))) return node.position;
  return freeSpot({ x: node.position.x + size.width / 2, y: node.position.y + size.height / 2 }, size, taken);
}

/** The size a file's node grows to once it shows the file: a picture's own shape as `fitNodeSize` gives it, any other
 * file its type's size. */
export async function uploadedNodeSize(file: File): Promise<Size> {
  const type = canvasFileNodeType(file.type || "application/octet-stream");
  if (type !== "image" || typeof createImageBitmap !== "function") return CANVAS_NODE_SIZE[type];
  return createImageBitmap(file).then((bitmap) => {
    const size = fitNodeSize(bitmap.width, bitmap.height);
    bitmap.close();
    return size;
  }, () => CANVAS_NODE_SIZE.image);
}
