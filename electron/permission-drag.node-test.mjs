import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";

import { appBundlePath, iconFileCandidates, permissionDragPage } from "./permission-drag.mjs";

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

test("the guide escapes what it is given and wires the drag, the panes and the close", () => {
  const page = permissionDragPage({
    appName: "<Bad & Co>", icon: "data:image/png;base64,AA", title: "T<i>", body: "B",
    dragLabel: "D", openLabel: "O", revealLabel: "R", closeLabel: "C", steps: ["one", "two", "three"],
  });
  assert.ok(page.includes("&lt;Bad &amp; Co&gt;"));
  assert.ok(!page.includes("<Bad & Co>"));
  assert.ok(page.includes('id="app" draggable="true"'));
  assert.ok(page.includes("window.permissionDrag.start()"));
  assert.ok(page.includes("window.permissionDrag.openSettings()"));
  assert.ok(page.includes("window.permissionDrag.reveal()"));
  assert.ok(page.includes("window.permissionDrag.close()"));
  assert.ok(page.includes("<b>1</b><span>one</span>"));
  assert.ok(page.includes("<b>3</b><span>three</span>"));
});
