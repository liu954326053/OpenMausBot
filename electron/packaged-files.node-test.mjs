import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import test from "node:test";

const ROOT = new URL("..", import.meta.url);
const yml = readFileSync(new URL("electron-builder.yml", ROOT), "utf8").replace(/\r\n/g, "\n");
const patterns = [...yml.split("\nfiles:\n")[1].split(/\n(?=\S)/)[0].matchAll(/^ {2}- "?([^"\n]+)"?$/gm)].map((match) => match[1]);
const packaged = (file) => patterns.some((pattern) => !pattern.startsWith("!") && posix.matchesGlob(file, pattern))
  && !patterns.some((pattern) => pattern.startsWith("!") && posix.matchesGlob(file, pattern.slice(1)));
const electronFiles = readdirSync(new URL("electron", ROOT), { recursive: true }).map((file) => posix.join("electron", file.replaceAll("\\", "/")));

test("no test or test fixture under electron/ is packaged", () => {
  const tests = electronFiles.filter((file) => /\.(node-)?test\.|-test-fixture\.|\/fixtures\//.test(file));
  assert.ok(tests.includes("electron/packaged-files.node-test.mjs"));
  assert.deepEqual(tests.filter(packaged), []);
  assert.equal(packaged("electron/main.mjs"), true);
});

test("every file the packaged Electron code imports is packaged too", () => {
  const missing = [];
  for (const file of electronFiles.filter((file) => /\.(mjs|cjs|js)$/.test(file) && packaged(file))) {
    for (const [, specifier] of readFileSync(new URL(file, ROOT), "utf8").matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = posix.normalize(posix.join(posix.dirname(file), specifier));
      if (target.startsWith("electron/") && !packaged(target)) missing.push(`${file} imports ${specifier}`);
    }
  }
  assert.deepEqual(missing, []);
});
