import type { BotAvatarCrop, MascotFaceColor } from "../../../shared/bot-avatar";
import type { BotBodyId } from "../../../shared/bot-body";
import type { MausColor } from "../../../shared/wire";

/** What the app needs to draw a bot's avatar; the canvas snapshot does not carry it. */
export interface CanvasBotLook {
  color: MausColor;
  avatarUrl?: string | null;
  avatarCrop?: BotAvatarCrop;
  avatarZoom?: number;
  avatarFocusX?: number;
  avatarFocusY?: number;
  mascotBody?: BotBodyId | null;
  mascotFaceColor?: MascotFaceColor | null;
}

/** One message of a bot's latest exchange in the project. */
export interface CanvasExchangeMessage {
  id: string;
  role: "person" | "bot";
  text: string;
  at: number;
}
