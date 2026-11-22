import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { fakeMp4 } from "./testing.ts";
import { videoFacts } from "./video-file.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function factsOf(bytes: Buffer, name = "clip.bin") {
  const dir = mkdtempSync(join(tmpdir(), "omb-video-file-"));
  dirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, bytes);
  const handle = await open(path, "r");
  try {
    return await videoFacts(handle, bytes.length);
  } finally {
    await handle.close();
  }
}

describe("what a video file says of itself", () => {
  it("reads an MP4's length, size and frame rate from its header, whatever the file is called", async () => {
    expect(await factsOf(fakeMp4({ seconds: 4, width: 1920, height: 1080, fps: 24 }), "notes.txt"))
      .toEqual({ mime: "video/mp4", durationUs: 4_000_000, width: 1920, height: 1080, fps: 24 });
  });

  it("finds the header after the media", async () => {
    expect(await factsOf(fakeMp4({ seconds: 1.5, width: 720, height: 1280, fps: 30, mediaBytes: 300_000, mediaFirst: true })))
      .toEqual({ mime: "video/mp4", durationUs: 1_500_000, width: 720, height: 1280, fps: 30 });
  });

  it("gives a video stored on its side the size it plays at", async () => {
    expect(await factsOf(fakeMp4({ width: 1920, height: 1080, turned: true }))).toMatchObject({ width: 1080, height: 1920 });
  });

  it("reads a QuickTime file, whose track names a data handler too", async () => {
    expect(await factsOf(fakeMp4({ seconds: 3, width: 1592, height: 1524, fps: 60, quickTime: true })))
      .toEqual({ mime: "video/quicktime", durationUs: 3_000_000, width: 1592, height: 1524, fps: 60 });
  });

  it("reads a real encoder's file", async () => {
    const sample = fileURLToPath(new URL("../testing/fixtures/generation-sample.mp4", import.meta.url));
    const handle = await open(sample, "r");
    try {
      const facts = await videoFacts(handle, (await handle.stat()).size);
      expect(facts).toMatchObject({ mime: "video/mp4" });
      expect(facts!.durationUs).toBeGreaterThan(0);
      expect(facts!.width).toBeGreaterThan(0);
      expect(facts!.fps).toBeGreaterThan(0);
    } finally {
      await handle.close();
    }
  });

  it("knows a WebM as a video without reading more of it", async () => {
    expect(await factsOf(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(40)]))).toEqual({ mime: "video/webm" });
  });

  it("is no video for a text file with a video's name, an audio-only MP4 brand, or an empty file", async () => {
    expect(await factsOf(Buffer.from("not a video at all"), "film.mp4")).toBeNull();
    const audio = fakeMp4();
    audio.write("M4A ", 8, "latin1");
    expect(await factsOf(audio, "film.mp4")).toBeNull();
    expect(await factsOf(Buffer.alloc(0), "film.mp4")).toBeNull();
  });

  it("is a video without a length when its header is cut short", async () => {
    const whole = fakeMp4();
    expect(await factsOf(whole.subarray(0, 60))).toEqual({ mime: "video/mp4" });
  });
});
