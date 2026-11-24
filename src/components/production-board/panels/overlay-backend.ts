import type { CanvasBackend } from "@/lib/project-canvas/backend";

/** What of `CanvasBackend` the board's overlay calls. */
export type OverlayBackend = Pick<CanvasBackend, "fileUrl" | "readBotLooks" | "readExchange" | "sendTask" | "stopBot" | "openChat" | "readConversation">;
