import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";

import { appBundlePath, guidePosition, iconFileCandidates, permissionDragPage } from "./permission-drag.mjs";

test("finds the app bundle around the running binary", () => {
  assert.equal(appBundlePath("/Applications/MagicBot.app/Contents/MacOS/MagicBot", "darwin"), "/Applications/MagicBot.app");
});

test("in development finds the Electron.app under node_modules", () => {
  const exec = "/Volumes/Work/App/node_modules/.pnpm/electron@43.7.9/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron";
  assert.equal(
    appBundlePath(exec, "darwin"),
    "/Volumes/Work/App/node_modules/.pnpm/electron@43.7.9/node_modules/electron/dist/Electron.app",
  );
});

test("answers null when no bundle is above the binary, or off macOS", () => {
  assert.equal(appBundlePath("/usr/local/bin/node", "darwin"), null);
  assert.equal(appBundlePath("/Applications/MagicBot.app/Contents/MacOS/MagicBot", "linux"), null);
  assert.equal(appBundlePath("", "darwin"), null);
});

test("tries the icon the bundle names first, then the usual file names", () => {
  const resources = "/Applications/MagicBot.app/Contents/Resources";
  assert.deepEqual(iconFileCandidates(resources, "MagicBot"), [
    join(resources, "MagicBot.icns"), join(resources, "icon.icns"), join(resources, "electron.icns"), join(resources, "app.icns"),
  ]);
  assert.equal(iconFileCandidates(resources, "")[0], join(resources, "icon.icns"));
  assert.equal(iconFileCandidates(resources, "AppIcon.icns")[0], join(resources, "AppIcon.icns"));
});

test("the guide sits centred under the settings window", () => {
  const at = guidePosition({
    settings: { x: 400, y: 120, width: 800, height: 600 },
    guide: { width: 352, height: 104 },
    workArea: { x: 0, y: 0, width: 1440, height: 900 },
  });
  assert.deepEqual(at, { x: 624, y: 730 });
});

test("the guide stays on screen when the settings window is at an edge", () => {
  const workArea = { x: 0, y: 0, width: 1440, height: 900 };
  const guide = { width: 352, height: 104 };
  assert.deepEqual(guidePosition({ settings: { x: 0, y: 100, width: 400, height: 500 }, guide, workArea }).x, 24);
  assert.deepEqual(guidePosition({ settings: { x: 1300, y: 100, width: 400, height: 300 }, guide, workArea }).x, 1080);
  assert.deepEqual(guidePosition({ settings: { x: 400, y: 800, width: 600, height: 300 }, guide, workArea }).y, 788);
});

test("the guide is one draggable chip with motion, and nothing else", () => {
  const page = permissionDragPage({ appName: "<Bad & Co>", icon: "data:image/png;base64,AA", dragLabel: "D" });
  assert.ok(page.includes("&lt;Bad &amp; Co&gt;"));
  assert.ok(!page.includes("<Bad & Co>"));
  assert.ok(page.includes('id="app" draggable="true"'));
  assert.ok(page.includes("window.permissionDrag.start()"));
  assert.ok(page.includes("@keyframes enter"));
  assert.ok(page.includes("@keyframes halo"));
  assert.ok(page.includes("@keyframes sheen"));
  assert.ok(page.includes("@keyframes icon-float"));
  assert.ok(page.includes("@keyframes lift-conveyor"));
  assert.ok(page.includes("@keyframes lift-ring"));
  assert.ok(page.includes("prefers-reduced-motion"));
  assert.ok(page.includes("prefers-reduced-transparency"));
  assert.ok(!page.includes("button"));
  assert.ok(!page.includes("permissionDrag.close"));
});

test("falls back cleanly when the bundle icon is missing", () => {
  const page = permissionDragPage({ appName: "MagicBot", icon: "", dragLabel: "Drag" });
  assert.ok(!page.includes('<img src=""'));
  assert.ok(page.includes('class="fallback"'));
});
