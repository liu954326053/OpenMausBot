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

const LIFT_ARROW_SVG = `<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M9 14V4.5M9 4.5 5 8.5M9 4.5l4 4" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const FALLBACK_ICON_SVG = `<svg class="fallback" viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="4" y="4" width="40" height="40" rx="11" fill="currentColor" fill-opacity=".08" stroke="currentColor" stroke-opacity=".16"/><path d="M24 16v16M16 24h16" stroke="currentColor" stroke-opacity=".45" stroke-width="2" stroke-linecap="round"/></svg>`;

/** The guide itself: one tactile chip, draggable into the privacy list, that lives under the System Settings window. */
export function permissionDragPage({ appName, icon, dragLabel }) {
  const safeName = escapeHtml(appName);
  const safeLabel = escapeHtml(dragLabel);
  const safeIcon = escapeHtml(icon);
  const iconMarkup = safeIcon
    ? `<img src="${safeIcon}" alt="" draggable="false">`
    : FALLBACK_ICON_SVG;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>${safeName}</title>
<style>
  :root {
    color-scheme: light dark;
    --surface: radial-gradient(150px 90px at 92% 50%, rgba(0, 113, 227, .07), transparent 72%),
      linear-gradient(180deg, rgba(255, 255, 255, .76) 0%, rgba(246, 248, 252, .58) 100%);
    --surface-hover: radial-gradient(160px 96px at 92% 50%, rgba(0, 113, 227, .12), transparent 72%),
      linear-gradient(180deg, rgba(255, 255, 255, .88) 0%, rgba(248, 250, 255, .70) 100%);
    --solid-surface: #f7f8fa;
    --ink: #111318;
    --ink-2: rgba(17, 19, 24, .58);
    --accent: #0071e3;
    --badge-bg: linear-gradient(180deg, rgba(0, 113, 227, .13) 0%, rgba(0, 113, 227, .06) 100%);
    --badge-bg-hover: linear-gradient(180deg, rgba(0, 113, 227, .20) 0%, rgba(0, 113, 227, .11) 100%);
    --badge-border: rgba(0, 113, 227, .20);
    --badge-border-hover: rgba(0, 113, 227, .34);
    --ring-color: rgba(0, 113, 227, .34);
    --halo: rgba(0, 113, 227, .15);
    --rim-top: rgba(255, 255, 255, .92);
    --rim-bottom: rgba(15, 23, 42, .06);
    --glint: rgba(0, 113, 227, .24);
    --sheen: rgba(255, 255, 255, .56);
    --spot: rgba(255, 255, 255, .52);
    --icon-shadow: drop-shadow(0 4px 10px rgba(15, 23, 42, .15)) drop-shadow(0 1px 2px rgba(15, 23, 42, .09));
    --icon-shadow-hover: drop-shadow(0 8px 16px rgba(15, 23, 42, .20)) drop-shadow(0 2px 4px rgba(15, 23, 42, .10));
    --badge-rim: rgba(255, 255, 255, .78);
    --badge-shadow: rgba(0, 113, 227, .08);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --surface: radial-gradient(160px 96px at 92% 50%, rgba(88, 169, 255, .11), transparent 72%),
        linear-gradient(180deg, rgba(48, 50, 58, .66) 0%, rgba(28, 30, 36, .56) 100%);
      --surface-hover: radial-gradient(170px 100px at 92% 50%, rgba(88, 169, 255, .18), transparent 72%),
        linear-gradient(180deg, rgba(58, 61, 71, .76) 0%, rgba(35, 37, 45, .66) 100%);
      --solid-surface: #1e2026;
      --ink: #f5f6f8;
      --ink-2: rgba(245, 246, 248, .64);
      --accent: #5cb0ff;
      --badge-bg: linear-gradient(180deg, rgba(92, 176, 255, .21) 0%, rgba(92, 176, 255, .10) 100%);
      --badge-bg-hover: linear-gradient(180deg, rgba(92, 176, 255, .32) 0%, rgba(92, 176, 255, .16) 100%);
      --badge-border: rgba(122, 192, 255, .25);
      --badge-border-hover: rgba(145, 206, 255, .44);
      --ring-color: rgba(92, 176, 255, .46);
      --halo: rgba(92, 176, 255, .24);
      --rim-top: rgba(255, 255, 255, .17);
      --rim-bottom: rgba(0, 0, 0, .28);
      --glint: rgba(140, 204, 255, .42);
      --sheen: rgba(255, 255, 255, .09);
      --spot: rgba(255, 255, 255, .09);
      --icon-shadow: drop-shadow(0 5px 12px rgba(0, 0, 0, .44)) drop-shadow(0 1px 2px rgba(0, 0, 0, .28));
      --icon-shadow-hover: drop-shadow(0 9px 18px rgba(0, 0, 0, .54)) drop-shadow(0 2px 4px rgba(0, 0, 0, .32));
      --badge-rim: rgba(255, 255, 255, .16);
      --badge-shadow: rgba(0, 0, 0, .24);
    }
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: transparent;
  }
  body {
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "PingFang SC", sans-serif;
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
    user-select: none;
    -webkit-user-select: none;
  }
  .chip {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    height: 100%;
    padding: 0 16px 0 14px;
    overflow: hidden;
    background: var(--surface);
    box-shadow: inset 0 1px 0 var(--rim-top), inset 0 -1px 0 var(--rim-bottom);
    cursor: grab;
    transition: background 180ms ease, opacity 180ms ease;
    animation: enter 300ms cubic-bezier(.22, 1, .36, 1) both;
  }
  .chip:hover { background: var(--surface-hover); }
  .chip:active, .chip.pressing { cursor: grabbing; }

  .chip::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0;
    background: radial-gradient(150px circle at var(--mx, 50%) var(--my, 50%), var(--spot), transparent 72%);
    transition: opacity 220ms ease;
  }
  .chip:hover::before { opacity: 1; }

  .chip::after {
    content: "";
    position: absolute;
    inset: -20% 0;
    width: 42%;
    pointer-events: none;
    background: linear-gradient(106deg, transparent 15%, var(--sheen) 50%, transparent 85%);
    transform: translateX(-160%);
    animation: sheen 4.8s cubic-bezier(.4, 0, .2, 1) infinite;
  }

  .glint {
    position: absolute;
    top: 0;
    left: 50%;
    width: 180px;
    height: 1px;
    border-radius: 999px;
    pointer-events: none;
    background: linear-gradient(90deg, transparent, var(--glint), transparent);
    transform: translateX(-50%) scaleX(.72);
    opacity: .3;
    animation: glint 2.6s ease-in-out infinite;
  }

  .inner {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 13px;
    width: 100%;
    min-width: 0;
    pointer-events: none;
    transition: transform 140ms cubic-bezier(.22, 1, .36, 1), opacity 180ms ease;
  }
  .chip.pressing .inner { transform: scale(.985); }
  .chip.dragging .inner { opacity: .68; transform: translateY(-1px) scale(.985); }

  .icon-stage {
    position: relative;
    width: 48px;
    height: 48px;
    flex: none;
    display: grid;
    place-items: center;
  }
  .halo {
    position: absolute;
    inset: -6px;
    border-radius: 50%;
    background: radial-gradient(circle at 50% 54%, var(--halo), transparent 68%);
    filter: blur(10px);
    animation: halo 2.6s cubic-bezier(.4, 0, .2, 1) infinite;
  }
  .icon-float {
    position: relative;
    width: 48px;
    height: 48px;
    display: grid;
    place-items: center;
    animation: icon-float 2.6s cubic-bezier(.4, 0, .2, 1) infinite;
  }
  .icon-inner {
    width: 48px;
    height: 48px;
    display: grid;
    place-items: center;
    transition: transform 200ms cubic-bezier(.22, 1, .36, 1), filter 200ms ease, opacity 180ms ease;
    filter: var(--icon-shadow);
  }
  .chip:hover .icon-inner {
    transform: translateY(-2px) scale(1.045);
    filter: var(--icon-shadow-hover);
  }
  .chip.pressing .icon-inner {
    transform: translateY(0) scale(.94);
    transition-duration: 90ms;
  }
  .chip.dragging .icon-inner {
    transform: translateY(-5px) scale(.9);
    opacity: .55;
  }
  .icon-inner img, .icon-inner .fallback {
    width: 48px;
    height: 48px;
    object-fit: contain;
    display: block;
    -webkit-user-drag: none;
  }

  .who {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 3px;
    min-width: 0;
    flex: 1;
  }
  strong {
    font-size: 14.5px;
    line-height: 1.24;
    font-weight: 600;
    letter-spacing: -.015em;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  small {
    font-size: 12px;
    line-height: 1.32;
    font-weight: 450;
    letter-spacing: .004em;
    color: var(--ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lift {
    position: relative;
    margin-inline-start: auto;
    width: 34px;
    height: 34px;
    flex: none;
    border-radius: 999px;
    display: grid;
    place-items: center;
    color: var(--accent);
    background: var(--badge-bg);
    border: 1px solid var(--badge-border);
    box-shadow: inset 0 1px 0 var(--badge-rim), 0 1px 3px var(--badge-shadow);
    transition: transform 200ms cubic-bezier(.22, 1, .36, 1), background 180ms ease, border-color 180ms ease;
  }
  .chip:hover .lift {
    transform: translateY(-1.5px);
    background: var(--badge-bg-hover);
    border-color: var(--badge-border-hover);
  }
  .chip.pressing .lift {
    transform: scale(.93);
    transition-duration: 90ms;
  }
  .lift-ring {
    position: absolute;
    inset: -1px;
    border-radius: 999px;
    border: 1px solid var(--ring-color);
    opacity: 0;
    animation: lift-ring 2.6s cubic-bezier(.22, 1, .36, 1) infinite;
  }
  .lift-track {
    position: relative;
    width: 18px;
    height: 18px;
    overflow: hidden;
  }
  .arrow {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    animation: lift-conveyor 5.2s cubic-bezier(.22, 1, .36, 1) infinite;
  }
  .arrow.a2 { animation-delay: -2.6s; }
  .arrow svg { width: 16px; height: 16px; display: block; }

  @keyframes enter {
    from { opacity: 0; transform: translateY(6px) scale(.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes sheen {
    0%, 62% { transform: translateX(-160%); opacity: 0; }
    72% { opacity: 1; }
    92%, 100% { transform: translateX(300%); opacity: 0; }
  }
  @keyframes glint {
    0%, 36%, 100% { opacity: .24; transform: translateX(-50%) scaleX(.70); }
    56% { opacity: .88; transform: translateX(-50%) scaleX(1.06); }
  }
  @keyframes halo {
    0%, 36%, 100% { opacity: .40; transform: scale(.92); }
    54% { opacity: .88; transform: scale(1.08); }
  }
  @keyframes icon-float {
    0%, 36%, 100% { transform: translateY(0); }
    54% { transform: translateY(-2.5px); }
  }
  @keyframes lift-conveyor {
    0%, 19% { transform: translateY(0) scale(1); opacity: 1; }
    32% { transform: translateY(-15px) scale(.86); opacity: 0; }
    32.1%, 73% { transform: translateY(15px) scale(.86); opacity: 0; }
    89%, 100% { transform: translateY(0) scale(1); opacity: 1; }
  }
  @keyframes lift-ring {
    0%, 37% { transform: scale(.94); opacity: 0; }
    45% { transform: scale(1.02); opacity: .55; }
    80%, 100% { transform: scale(1.42); opacity: 0; }
  }

  @media (prefers-reduced-transparency: reduce) {
    .chip, .chip:hover { background: var(--solid-surface); }
  }
  @media (prefers-contrast: more) {
    :root { --ink-2: rgba(17, 19, 24, .82); --badge-border: rgba(0, 113, 227, .48); }
    @media (prefers-color-scheme: dark) {
      :root { --ink-2: rgba(245, 246, 248, .86); --badge-border: rgba(145, 206, 255, .58); }
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .chip, .chip::after, .glint, .halo, .icon-float, .lift-ring, .arrow { animation: none; }
    .chip, .chip::before, .inner, .icon-inner, .lift { transition: opacity 140ms ease, background 140ms ease; }
    .arrow.a2 { display: none; }
  }
</style>
</head>
<body>
<div class="chip" id="app" draggable="true" title="${safeLabel}" aria-label="${safeName}: ${safeLabel}">
  <span class="glint" aria-hidden="true"></span>
  <div class="inner">
    <span class="icon-stage" aria-hidden="true">
      <span class="halo"></span>
      <span class="icon-float"><span class="icon-inner">${iconMarkup}</span></span>
    </span>
    <span class="who">
      <strong>${safeName}</strong>
      <small>${safeLabel}</small>
    </span>
    <span class="lift" aria-hidden="true">
      <span class="lift-ring"></span>
      <span class="lift-track">
        <span class="arrow a1">${LIFT_ARROW_SVG}</span>
        <span class="arrow a2">${LIFT_ARROW_SVG}</span>
      </span>
    </span>
  </div>
</div>
<script>
  const chip = document.getElementById("app");
  let resetTimer = null;
  const clearStates = () => {
    clearTimeout(resetTimer);
    resetTimer = null;
    chip.classList.remove("pressing", "dragging");
  };
  chip.addEventListener("pointermove", (event) => {
    const rect = chip.getBoundingClientRect();
    chip.style.setProperty("--mx", (event.clientX - rect.left) + "px");
    chip.style.setProperty("--my", (event.clientY - rect.top) + "px");
  });
  chip.addEventListener("pointerdown", () => {
    chip.classList.add("pressing");
  });
  chip.addEventListener("pointerup", clearStates);
  chip.addEventListener("pointercancel", clearStates);
  chip.addEventListener("dragend", clearStates);
  window.addEventListener("blur", clearStates);
  chip.addEventListener("dragstart", (event) => {
    event.preventDefault();
    chip.classList.remove("pressing");
    chip.classList.add("dragging");
    clearTimeout(resetTimer);
    resetTimer = setTimeout(clearStates, 1200);
    window.permissionDrag.start();
  });
</script>
</body>
</html>`;
}
