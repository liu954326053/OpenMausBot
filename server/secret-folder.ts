// Security: the private folder, inside a bot's own workspace or Local VM workspace, where a secret the person gave for the
// bot's commands lives for a day. Nothing that syncs, backs up, moves, links, attaches, publishes, uploads or snapshots
// workspace files may carry anything under it.
export const SECRET_FOLDER = ".magicbot-secrets";
// Security: a workspace an OpenMausBot build wrote to keeps its secret files under this name; they are guarded and swept
// the same way.
export const FORMER_SECRET_FOLDER = ".openmausbot-secrets";
export const SECRET_FOLDERS: readonly string[] = [SECRET_FOLDER, FORMER_SECRET_FOLDER];

export const SECRET_FILE_REFUSAL =
  "That file holds a secret the person gave for your own commands only: it cannot be opened from chat, attached, published, uploaded or read by a helper.";

export function inSecretFolder(path: string): boolean {
  return path.split(/[\\/]/).some((part) => SECRET_FOLDERS.includes(part));
}
