// macOS grants Accessibility and Screen Recording to an app bundle, never to a single binary: the bundle around the
// running executable is what the person must add to the privacy list. Packaged that is MagicBot.app; in development it
// is the Electron.app under node_modules, because that is the app macOS records for `pnpm dev:desktop`.
import path from "node:path";

export function appBundlePath(execPath, platform = process.platform) {
  if (platform !== "darwin" || typeof execPath !== "string" || execPath === "") return null;
  let current = path.resolve(execPath);
  for (;;) {
    if (current.endsWith(".app")) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** The icon files a bundle may carry, the one its Info.plist names first. */
export function iconFileCandidates(resourcesDir, bundleIconFile) {
  const named = typeof bundleIconFile === "string" && bundleIconFile.trim() !== ""
    ? [bundleIconFile.trim().endsWith(".icns") ? bundleIconFile.trim() : `${bundleIconFile.trim()}.icns`]
    : [];
  return [...new Set([...named, "icon.icns", "electron.icns", "app.icns"].map((file) => path.join(resourcesDir, file)))];
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text) => String(text).replace(/[&<>"']/gu, (char) => ESCAPES[char]);

/** The guide that floats beside System Settings: the responsible app's icon, draggable into the list, and the steps. */
export function permissionDragPage({ appName, icon, title, body, dragLabel, openLabel, revealLabel, closeLabel, steps }) {
  const list = steps.map((step, index) => `<li><b>${index + 1}</b><span>${escapeHtml(step)}</span></li>`).join("\n      ");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; --ink: #1d1d1f; --muted: rgba(29,29,31,.62); --hair: rgba(0,0,0,.14); --fill: rgba(255,255,255,.6); --chip: rgba(0,0,0,.07); --accent: #0a7cff; }
  @media (prefers-color-scheme: dark) { :root { --ink: #f5f5f7; --muted: rgba(245,245,247,.62); --hair: rgba(255,255,255,.16); --fill: rgba(255,255,255,.07); --chip: rgba(255,255,255,.12); } }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: transparent; }
  body { font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", sans-serif; color: var(--ink); user-select: none; -webkit-user-select: none; }
  .card { height: 100%; display: flex; flex-direction: column; gap: 12px; padding: 12px 16px 16px; border-radius: 14px; border: .5px solid var(--hair); background: rgba(246,246,248,.94); }
  @media (prefers-color-scheme: dark) { .card { background: rgba(38,38,42,.94); } }
  .bar { display: flex; align-items: center; justify-content: space-between; height: 14px; -webkit-app-region: drag; }
  .dots { width: 34px; height: 8px; opacity: .28; background-image: radial-gradient(currentColor 1.2px, transparent 1.3px); background-size: 6px 4px; background-repeat: repeat-x; color: var(--ink); }
  .close { -webkit-app-region: no-drag; width: 20px; height: 20px; border: 0; border-radius: 50%; background: var(--chip); color: var(--muted); font-size: 12px; line-height: 20px; padding: 0; cursor: pointer; }
  .close:hover { color: var(--ink); }
  .hero { display: flex; align-items: center; gap: 12px; -webkit-app-region: drag; }
  .hero img { width: 58px; height: 58px; flex: none; }
  h1 { margin: 0 0 2px; font-size: 15px; font-weight: 650; letter-spacing: -.01em; }
  .hero p { margin: 0; font-size: 12px; color: var(--muted); }
  .drag { -webkit-app-region: no-drag; display: flex; align-items: center; gap: 9px; padding: 9px 11px; border: 1.5px dashed var(--hair); border-radius: 11px; background: var(--fill); cursor: grab; }
  .drag:active { cursor: grabbing; }
  .drag img { width: 26px; height: 26px; pointer-events: none; }
  .drag strong { font-size: 12.5px; font-weight: 600; pointer-events: none; }
  .drag em { margin-left: auto; font-style: normal; font-size: 11px; color: var(--muted); pointer-events: none; }
  ol { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 5px; }
  li { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; color: var(--muted); }
  li b { flex: none; width: 16px; height: 16px; margin-top: 1px; border-radius: 50%; background: var(--chip); color: var(--ink); font-size: 10px; font-weight: 600; display: grid; place-items: center; }
  .actions { display: flex; gap: 8px; margin-top: auto; }
  button.primary { flex: 1; border: 0; border-radius: 9px; padding: 8px 10px; background: var(--accent); color: #fff; font: 600 12.5px inherit; cursor: pointer; }
  button.primary:hover { filter: brightness(1.07); }
  button.ghost { border: .5px solid var(--hair); border-radius: 9px; padding: 8px 10px; background: transparent; color: var(--ink); font: 500 12.5px inherit; cursor: pointer; }
  button.ghost:hover { background: var(--chip); }
</style>
</head>
<body>
<div class="card">
  <div class="bar"><span class="dots"></span><button class="close" id="close" aria-label="${escapeHtml(closeLabel)}">✕</button></div>
  <div class="hero">
    <img src="${escapeHtml(icon)}" alt="">
    <div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></div>
  </div>
  <div class="drag" id="app" draggable="true" title="${escapeHtml(dragLabel)}">
    <img src="${escapeHtml(icon)}" alt="">
    <strong>${escapeHtml(appName)}</strong>
    <em>${escapeHtml(dragLabel)}</em>
  </div>
  <ol>
      ${list}
  </ol>
  <div class="actions">
    <button class="primary" id="open" type="button">${escapeHtml(openLabel)}</button>
    <button class="ghost" id="reveal" type="button">${escapeHtml(revealLabel)}</button>
  </div>
</div>
<script>
  document.getElementById("app").addEventListener("dragstart", (event) => {
    event.preventDefault();
    window.permissionDrag.start();
  });
  document.getElementById("open").addEventListener("click", () => window.permissionDrag.openSettings());
  document.getElementById("reveal").addEventListener("click", () => window.permissionDrag.reveal());
  document.getElementById("close").addEventListener("click", () => window.permissionDrag.close());
</script>
</body>
</html>`;
}
