import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fakePng } from "../testing/fake-generation-mcp-server.ts";
import { GenerationRefused } from "./failure.ts";
import { projectRelativeParts, readReferences, resultBaseName, resultBytes, saveResult, sniffAudio, sniffVideo } from "./project-files.ts";

let root = "";
let project = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omb-generation-files-"));
  project = join(root, "project");
  mkdirSync(project);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function refusedWith(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof GenerationRefused) return error.failure.error;
    throw error;
  }
  throw new Error("not refused");
}

async function refusedLater(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof GenerationRefused) return error.failure.error;
    throw error;
  }
  throw new Error("not refused");
}

const AT = new Date(2026, 10, 21, 9, 5, 7).getTime();
const PNG = fakePng("1:1", 3);
const MP4 = readFileSync(new URL("../testing/fixtures/generation-sample.mp4", import.meta.url));

describe("a result's name", () => {
  it("is the node's name made safe for one file on every system, the local time and the job", () => {
    expect(resultBaseName("镜头 1", "image", AT, "gen-1b2c-4d5e6f")).toBe("镜头 1-20261121-090507-4d5e6f");
    expect(resultBaseName("../../etc/passwd", "image", AT, "gen-a")).toBe("etc passwd-20261121-090507-gena");
    expect(resultBaseName(' a:b*c?"d<e>f|g\\h\u0007 ', "video", AT, "gen-a")).toBe("a b c d e f g h-20261121-090507-gena");
    expect(resultBaseName(" ... ", "video", AT, "gen-a")).toBe("video-20261121-090507-gena");
    expect(resultBaseName(undefined, "image", AT, "gen-a")).toBe("image-20261121-090507-gena");
    expect([...resultBaseName("长".repeat(100), "image", AT, "gen-a")].length).toBe(60 + "-20261121-090507-gena".length);
  });

  it("never names a path that leaves the project folder", () => {
    expect(projectRelativeParts("参考/a.png")).toEqual(["参考", "a.png"]);
    expect(projectRelativeParts("./参考\\a.png")).toEqual(["参考", "a.png"]);
    for (const path of ["", "/etc/passwd", "\\\\server\\share", "C:/x.png", "a/../../b", "..", "a\0b"]) expect(projectRelativeParts(path)).toBeNull();
  });
});

describe("saving a result", () => {
  it("makes 产出/图片 and 产出/视频 and never replaces a file already there", () => {
    const first = saveResult(project, "image", "shot", PNG, "image/png");
    expect(first).toEqual({ path: "产出/图片/shot.png", mime: "image/png", bytes: PNG.length, name: "shot.png" });
    writeFileSync(join(project, "产出", "图片", "shot-2.png"), "theirs");
    expect(saveResult(project, "image", "shot", PNG, "image/png").path).toBe("产出/图片/shot-3.png");
    expect(readFileSync(join(project, "产出", "图片", "shot-2.png"), "utf8")).toBe("theirs");
    expect(saveResult(project, "video", "clip", MP4, "video/mp4").path).toBe("产出/视频/clip.mp4");
    expect(readFileSync(join(project, "产出", "视频", "clip.mp4")).equals(MP4)).toBe(true);
  });

  it("refuses an output folder that is a link or a file, and a project folder that is gone", () => {
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(project, "产出"));
    expect(refusedWith(() => saveResult(project, "image", "shot", PNG, "image/png"))).toBe("The result couldn't be saved in this project's folder: 产出 is not a folder");
    expect(readdirSync(elsewhere)).toEqual([]);

    rmSync(join(project, "产出"));
    mkdirSync(join(project, "产出"));
    writeFileSync(join(project, "产出", "视频"), "a file");
    expect(refusedWith(() => saveResult(project, "video", "clip", MP4, "video/mp4"))).toBe("The result couldn't be saved in this project's folder: 视频 is not a folder");

    rmSync(project, { recursive: true });
    expect(refusedWith(() => saveResult(project, "image", "shot", PNG, "image/png"))).toBe(
      "This project's folder can't be found. Reconnect its drive or put the folder back, then try again.",
    );
    expect(existsSync(project)).toBe(false);
  });
});

describe("references", () => {
  it("are read only from real folders inside the project, as what their bytes are", () => {
    mkdirSync(join(project, "参考"));
    writeFileSync(join(project, "参考", "a.png"), PNG);
    writeFileSync(join(project, "voice.wav"), Buffer.concat([Buffer.from("RIFF\0\0\0\0WAVEfmt "), Buffer.alloc(32)]));
    const read = readReferences(project, { images: ["参考/a.png"], audio: ["voice.wav"] });
    expect(read.images).toEqual([{ name: "a.png", mimeType: "image/png", data: PNG.toString("base64") }]);
    expect(read.audio.map((file) => file.mimeType)).toEqual(["audio/wav"]);

    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "b.png"), PNG);
    symlinkSync(outside, join(project, "linked"));
    expect(refusedWith(() => readReferences(project, { images: ["linked/b.png"], audio: [] }))).toBe("linked/b.png isn't a file in this project's folder.");
    expect(refusedWith(() => readReferences(project, { images: Array.from({ length: 9 }, () => "参考/a.png"), audio: [] })))
      .toBe("Send at most 8 reference pictures and 2 audio files, 40 MB in all.");
    expect(refusedWith(() => readReferences(project, { images: [], audio: ["参考/a.png"] }))).toBe("参考/a.png isn't audio, so it can't be reference audio.");
  });

  it("are told apart by their bytes", () => {
    expect(sniffVideo(MP4)).toBe("video/mp4");
    expect(sniffVideo(Buffer.from("\0\0\0\x14ftypqt  \0\0\0\0", "latin1"))).toBe("video/quicktime");
    expect(sniffVideo(Buffer.from("\0\0\0\x14ftypM4A \0\0\0\0", "latin1"))).toBeNull();
    expect(sniffVideo(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]))).toBe("video/webm");
    expect(sniffVideo(PNG)).toBeNull();
    expect(sniffAudio(Buffer.from("ID3\x04\0\0", "latin1"))).toBe("audio/mpeg");
    expect(sniffAudio(Buffer.from("OggS\0\x02", "latin1"))).toBe("audio/ogg");
    expect(sniffAudio(PNG)).toBeNull();
  });
});

describe("a downloaded result", () => {
  let server: Server | undefined;
  let other: Server | undefined;
  afterEach(async () => {
    for (const each of [server, other]) await new Promise((resolve) => (each ? each.close(resolve) : resolve(undefined)));
    server = other = undefined;
  });
  const serve = async (body: Buffer) => {
    const started = createServer((req, res) => res.writeHead(req.url === "/missing" ? 404 : 200).end(body));
    await new Promise<void>((resolve) => started.listen(0, "127.0.0.1", resolve));
    return { started, origin: `http://127.0.0.1:${(started.address() as AddressInfo).port}` };
  };

  it("comes from the MCP server's own address, or inline, and must be what was asked for", async () => {
    const own = await serve(PNG);
    server = own.started;
    const fromServer = await resultBytes({ url: `${own.origin}/files/a.png` }, "image", `${own.origin}/mcp`, "gen");
    expect(fromServer).toEqual({ bytes: PNG, mime: "image/png" });
    expect(await resultBytes({ data: MP4.toString("base64") }, "video", null, "gen")).toEqual({ bytes: MP4, mime: "video/mp4" });
    expect(await refusedLater(() => resultBytes({ url: `${own.origin}/files/a.png` }, "video", `${own.origin}/mcp`, "gen"))).toBe(
      "The result couldn't be downloaded from gen: it is not a video",
    );
    expect(await refusedLater(() => resultBytes({ url: `${own.origin}/missing` }, "image", `${own.origin}/mcp`, "gen"))).toBe(
      "The result couldn't be downloaded from gen: the address answered 404",
    );
    expect(await refusedLater(() => resultBytes({ data: "not base64!" }, "image", null, "gen"))).toBe(
      "The result couldn't be downloaded from gen: its data is not a file this size can be",
    );
  });

  it("is never fetched from this computer or a private network other than the MCP server itself", async () => {
    const own = await serve(PNG);
    const elsewhere = await serve(PNG);
    server = own.started;
    other = elsewhere.started;
    expect(await refusedLater(() => resultBytes({ url: `${elsewhere.origin}/a.png` }, "image", `${own.origin}/mcp`, "gen"))).toBe(
      "The result couldn't be downloaded from gen: its address is neither https nor the MCP server's own",
    );
    expect(await refusedLater(() => resultBytes({ url: `https://127.0.0.1:${(elsewhere.started.address() as AddressInfo).port}/a.png` }, "image", `${own.origin}/mcp`, "gen"))).toBe(
      "The result couldn't be downloaded from gen: its address points at this computer or a private network",
    );
    expect(await refusedLater(() => resultBytes({ url: "https://10.0.0.8/a.png" }, "image", `${own.origin}/mcp`, "gen"))).toBe(
      "The result couldn't be downloaded from gen: its address points at this computer or a private network",
    );
  });
});
