import { t } from "@/lib/i18n";
import { assetKindLabel } from "./asset-words";
import type { BoardAsset } from "./board-index";

/** The person's words, then a line for each reference the server does not send by itself, naming the node id a bot
 * reads it by. Security: a title goes quoted inside its reference's line, so no title stands alone on a line, where
 * the server would take it for an attachment of the person's. */
export function taskText(text: string, references: readonly BoardAsset[]): string {
  if (!references.length) return text;
  const lines = references.map((asset) => t("boardPanels.chat.referenceLine", { kind: assetKindLabel(asset), title: JSON.stringify(asset.title), id: asset.node.id }));
  return `${text}\n\n${[t("boardPanels.chat.taskReferences"), ...lines].join("\n")}`;
}
