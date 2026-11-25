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

/** Where the drag guide sits: centred under the System Settings window, kept inside the work area. */
export function guidePosition({ settings, guide, workArea, gap = 10, margin = 8 }) {
  const wanted = {
    x: Math.round(settings.x + (settings.width - guide.width) / 2),
    y: Math.round(settings.y + settings.height + gap),
  };
  const minX = workArea.x + margin, minY = workArea.y + margin;
  const maxX = Math.max(minX, workArea.x + workArea.width - guide.width - margin);
  const maxY = Math.max(minY, workArea.y + workArea.height - guide.height - margin);
  return { x: Math.min(Math.max(wanted.x, minX), maxX), y: Math.min(Math.max(wanted.y, minY), maxY) };
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text) => String(text).replace(/[&<>"']/gu, (char) => ESCAPES[char]);

/** The guide itself: one tactile chip, draggable into the privacy list, that lives under the System Settings window. */
export function permissionDragPage({ appName, icon, dragLabel }) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>${escapeHtml(appName)}</title>
<style>
  :root { color-scheme: light dark; --ink: #1d1d1f; --muted: rgba(29,29,31,.55); --hair: rgba(0,0,0,.18); --card: rgba(250,250,252,.92); --sheen: rgba(255,255,255,.55); }
  @media (prefers-color-scheme: dark) { :root { --ink: #f5f5f7; --muted: rgba(245,245,247,.55); --hair: rgba(255,255,255,.22); --card: rgba(36,36,40,.92); --sheen: rgba(255,255,255,.08); } }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: transparent; }
  body { font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", sans-serif; color: var(--ink); user-select: none; -webkit-user-select: none; padding: 4px; }
  .chip { position: relative; display: flex; align-items: center; gap: 12px; height: 100%; padding: 0 16px; overflow: hidden;
    border-radius: 16px; border: 1.5px dashed var(--hair); background: var(--card);
    box-shadow: 0 10px 30px rgba(0,0,0,.18), inset 0 1px 0 var(--sheen);
    cursor: grab; animation: border-breathe 2.6s ease-in-out infinite; }
  .chip:active { cursor: grabbing; }
  .chip::after { content: ""; position: absolute; top: 0; bottom: 0; width: 45%; pointer-events: none;
    background: linear-gradient(105deg, transparent, var(--sheen), transparent); transform: translateX(-120%);
    animation: sheen 3.4s ease-in-out infinite; }
  .halo { position: absolute; left: 8px; width: 64px; height: 64px; border-radius: 50%; pointer-events: none;
    background: radial-gradient(circle, rgba(10,124,255,.32), rgba(10,124,255,0) 70%); animation: halo 2.6s ease-in-out infinite; }
  img { position: relative; width: 44px; height: 44px; flex: none; filter: drop-shadow(0 2px 5px rgba(0,0,0,.18)); pointer-events: none; }
  .who { display: flex; flex-direction: column; min-width: 0; pointer-events: none; }
  strong { font-size: 14px; font-weight: 650; letter-spacing: -.01em; }
  small { display: flex; align-items: center; gap: 4px; margin-top: 2px; font-size: 12px; color: var(--muted); }
  small svg { width: 12px; height: 12px; animation: lift 1.6s ease-in-out infinite; }
  .grip { margin-left: auto; display: flex; flex-direction: column; gap: 3px; pointer-events: none; }
  .grip i { width: 4px; height: 4px; border-radius: 50%; background: var(--hair); animation: dots 2.6s ease-in-out infinite; }
  .grip i:nth-child(2) { animation-delay: .2s; }
  .grip i:nth-child(3) { animation-delay: .4s; }
  @keyframes border-breathe { 0%,100% { border-color: var(--hair); } 50% { border-color: rgba(10,124,255,.55); } }
  @keyframes sheen { 0%, 55% { transform: translateX(-120%); } 90%, 100% { transform: translateX(260%); } }
  @keyframes halo { 0%,100% { transform: scale(.9); opacity: .55; } 50% { transform: scale(1.08); opacity: 1; } }
  @keyframes lift { 0%,100% { transform: translateY(1px); } 50% { transform: translateY(-2px); } }
  @keyframes dots { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .chip, .chip::after, .halo, small svg, .grip i { animation: none; } }
</style>
</head>
<body>
<div class="chip" id="app" draggable="true" title="${escapeHtml(dragLabel)}">
  <span class="halo" aria-hidden="true"></span>
  <img src="${escapeHtml(icon)}" alt="">
  <span class="who">
    <strong>${escapeHtml(appName)}</strong>
    <small><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 13V4M8 4l-3.2 3.2M8 4l3.2 3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>${escapeHtml(dragLabel)}</small>
  </span>
  <span class="grip" aria-hidden="true"><i></i><i></i><i></i></span>
</div>
<script>
  document.getElementById("app").addEventListener("dragstart", (event) => {
    event.preventDefault();
    window.permissionDrag.start();
  });
</script>
</body>
</html>`;
}
