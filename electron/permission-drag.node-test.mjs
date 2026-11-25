import assert from "node:assert/strict";
import test from "node:test";

import { appBundlePath, permissionDragPage } from "./permission-drag.mjs";

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

test("the helper page escapes what it is given and wires the drag", () => {
  const page = permissionDragPage({ appName: "<Bad & Co>", icon: "data:image/png;base64,AA", title: "T<i>", body: "B", dragLabel: "D", revealLabel: "R" });
  assert.ok(page.includes("&lt;Bad &amp; Co&gt;"));
  assert.ok(!page.includes("<Bad & Co>"));
  assert.ok(page.includes('id="app" draggable="true"'));
  assert.ok(page.includes("window.permissionDrag.start()"));
  assert.ok(page.includes("window.permissionDrag.reveal()"));
});
