import { describe, expect, it } from "vitest";

import { buildZip } from "../testing/zip-fixture.ts";
import { readZip, safeEntryPath, ZipProblem } from "./zip.ts";

const limits = { maxFiles: 5, maxFileBytes: 1024, maxTotalBytes: 4096 };
const problemOf = (bytes: Buffer): string | null => {
  try { readZip(bytes, limits); return null; } catch (error) {
    if (error instanceof ZipProblem) return error.message;
    throw error;
  }
};

describe("a plugin archive", () => {
  it("reads deflated and stored files, and takes a single wrapping folder off", () => {
    const entries = readZip(buildZip([
      { name: "plugin.json", data: '{"schemaVersion":1}' },
      { name: "readme.txt", data: "stored", method: 0 },
    ]), limits);
    expect(entries.map((entry) => entry.path)).toEqual(["plugin.json", "readme.txt"]);
    expect(entries[1]!.data.toString("utf8")).toBe("stored");
  });

  it("refuses a path that leaves the folder, an absolute one, and a Windows drive", () => {
    for (const name of ["../escape.txt", "/etc/passwd", "C:/Windows/system32/x.txt", "a/../../b.txt"]) {
      expect(problemOf(buildZip([{ name, data: "x" }])), name).toMatch(/outside|absolute/);
    }
    expect(() => safeEntryPath("images/../plugin.json")).toThrow(ZipProblem);
  });

  it("refuses a link, a symlinked folder, a zip bomb and an archive with too many files", () => {
    expect(problemOf(buildZip([{ name: "link", data: "/etc/passwd", mode: 0o120777 }]))).toContain("not a file or folder");
    expect(problemOf(buildZip([{ name: "a", data: "x" }, { name: "b", data: "y" }, { name: "c", data: "z" }, { name: "d", data: "w" }, { name: "e", data: "v" }, { name: "f", data: "u" }]))).toContain("more than 5 files");
    expect(problemOf(buildZip([{ name: "big", data: Buffer.alloc(4097), method: 0 }]))).toContain("larger than a plugin file may be");
  });

  it("refuses a file that is not a zip at all, and an encrypted entry", () => {
    expect(problemOf(Buffer.from("not a zip"))).toContain("not a zip archive");
    const encrypted = buildZip([{ name: "plugin.json", data: "{}" }]);
    const directory = encrypted.readUInt32LE(encrypted.length - 22 + 16);
    encrypted.writeUInt16LE(1, directory + 8);
    expect(problemOf(encrypted)).toContain("password-protected");
  });
});
