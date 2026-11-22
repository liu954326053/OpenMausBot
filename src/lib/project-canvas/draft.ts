const WINDOWS_PATH = /^[A-Za-z]:\\|^\\\\/;

/**
 * The path, relative to the project folder and `/`-separated, of a file the person picked on this computer; null when
 * the file is not inside the project folder. The project folder is the one that holds `exportFolder`.
 */
export function projectRelativePath(exportFolder: string, picked: string): string | null {
  const windows = WINDOWS_PATH.test(exportFolder);
  const separator = windows ? "\\" : "/";
  const parts = (path: string) => path.split(separator).filter(Boolean);
  const folder = parts(exportFolder).slice(0, -1);
  const file = parts(picked);
  const rooted = windows ? WINDOWS_PATH.test(picked) : picked.startsWith("/");
  if (!folder.length || !rooted || file.length <= folder.length || file.includes("..")) return null;
  const same = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  return folder.every((part, index) => same(part, file[index]!)) ? file.slice(folder.length).join("/") : null;
}
