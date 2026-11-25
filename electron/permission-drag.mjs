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

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text) => String(text).replace(/[&<>"']/gu, (char) => ESCAPES[char]);

/** The helper window's page: the bundle's icon, draggable into System Settings, and a way out for people who cannot drag. */
export function permissionDragPage({ appName, icon, title, body, dragLabel, revealLabel }) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; font: 13px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  body { margin: 0; padding: 14px 16px; color: #1d1d1f; background: #f5f5f7; user-select: none; -webkit-user-select: none; }
  @media (prefers-color-scheme: dark) { body { color: #f5f5f7; background: #1e1e20; } button { color: #f5f5f7 !important; border-color: #ffffff33 !important; } }
  h1 { margin: 0 0 4px; font-size: 13px; font-weight: 600; }
  p { margin: 0 0 10px; font-size: 12px; line-height: 1.45; opacity: .75; }
  .app { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 12px; background: rgba(127,127,127,.12); cursor: grab; }
  .app:active { cursor: grabbing; }
  .app img { width: 48px; height: 48px; pointer-events: none; }
  .app span { font-size: 13px; font-weight: 600; pointer-events: none; }
  .hint { margin: 8px 0 12px; }
  button { width: 100%; padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(0,0,0,.2); background: transparent; font: inherit; color: inherit; cursor: pointer; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(body)}</p>
<div class="app" id="app" draggable="true" title="${escapeHtml(dragLabel)}">
  <img src="${escapeHtml(icon)}" alt="">
  <span>${escapeHtml(appName)}</span>
</div>
<p class="hint">${escapeHtml(dragLabel)}</p>
<button type="button" id="reveal">${escapeHtml(revealLabel)}</button>
<script>
  document.getElementById("app").addEventListener("dragstart", (event) => {
    event.preventDefault();
    window.permissionDrag.start();
  });
  document.getElementById("reveal").addEventListener("click", () => window.permissionDrag.reveal());
</script>
</body>
</html>`;
}
