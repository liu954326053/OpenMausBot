import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import type { SkillUploadResult } from "../../shared/skill-import.ts";
import type { SkillsLibrarySkillWire } from "../../shared/wire.ts";
import type { AppConfig } from "../config.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { listLibrarySkills, readLibrarySkillFile, setLibrarySkillReviewState } from "../skill-library.ts";
import type { Store } from "../store.ts";
import { buildZip } from "../testing/zip-fixture.ts";
import { createBotSkillsRoutes } from "./bot-skills.ts";
import { dispatchRoutes } from "./table.ts";

const skillMd = (name: string, body = "Pick the comics that fit.") => `---\nname: ${name}\ndescription: Picks comics.\n---\n\n# ${name}\n\n${body}\n`;
const base64 = (text: string | Buffer) => Buffer.from(text).toString("base64");

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

interface Reply extends Partial<SkillUploadResult> {
  error?: string;
  errorKey?: string;
  skills?: SkillsLibrarySkillWire[];
  undo?: string;
  skill?: { name: string; enabled: boolean };
}

async function serve(features: AppConfig["features"] = {}) {
  const store = { bot: () => undefined, bots: [] } as unknown as Store;
  const routes = [createBotSkillsRoutes({
    store,
    cfg: { features } as AppConfig,
    listBotSkills: () => [],
    readBotSkillFile: () => null,
    stagedSkillListing: (staged) => staged,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = { kind: "loopback", scopes: ["admin"] } as unknown as RequestAuth;
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Reply };
  };
}

const stored = (name: string) => listLibrarySkills().find((skill) => skill.name === name);

describe("uploading skill packages to the skills library", () => {
  it("puts every skill of an archive in the library switched off, with where it came from", async () => {
    const call = await serve();
    const archive = buildZip([
      { name: "comics/tomato-pick/SKILL.md", data: skillMd("tomato-pick") },
      { name: "comics/tomato-pick/scripts/rank.py", data: "print('rank')\n", mode: 0o100755 },
      { name: "comics/douyin-pick/SKILL.md", data: skillMd("douyin-pick") },
      { name: "__MACOSX/comics/._tomato-pick", data: "fork" },
    ]);

    const reply = await call("POST", "/api/skills-library/upload", { archive: base64(archive), label: "comics\n.zip" });

    expect(reply.status).toBe(201);
    expect(reply.body.installed?.map((skill) => [skill.name, skill.replaced, skill.files])).toEqual([["douyin-pick", false, 1], ["tomato-pick", false, 2]]);
    expect(stored("tomato-pick")).toMatchObject({ enabled: false, source: "upload:comics .zip" });
    expect(readLibrarySkillFile("tomato-pick")).toBe(skillMd("tomato-pick"));
  });

  it("takes a folder's files, and says nothing changed when the same ones come again", async () => {
    const call = await serve();
    const files = [
      { path: "folder-pick\\SKILL.md", content: base64(skillMd("folder-pick")) },
      { path: "folder-pick/references/sites.md", content: base64("# Sites\n") },
    ];

    const first = await call("POST", "/api/skills-library/upload", { files, oversize: ["folder-pick/video.mp4", "elsewhere/big.bin"], label: "folder-pick" });
    expect(first.status).toBe(201);
    expect(first.body.installed).toMatchObject([{ name: "folder-pick", files: 2, skipped: [{ path: "video.mp4", reason: "large" }], skippedCount: 1 }]);
    const again = await call("POST", "/api/skills-library/upload", { files, label: "folder-pick" });

    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ installed: [], unchanged: ["folder-pick"], conflicts: [] });
    expect(stored("folder-pick")).toMatchObject({ source: "upload:folder-pick", files: ["references/sites.md"] });
  });

  it("leaves a skill of the same name alone until asked to replace it, then makes the person read it again", async () => {
    const call = await serve();
    const first = [{ path: "SKILL.md", content: base64(skillMd("swap-pick")) }];
    const second = [{ path: "SKILL.md", content: base64(skillMd("swap-pick", "Pick by this week's chart.")) }];
    expect((await call("POST", "/api/skills-library/upload", { files: first })).status).toBe(201);
    setLibrarySkillReviewState("swap-pick", "approved");

    const refused = await call("POST", "/api/skills-library/upload", { files: second });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ conflicts: ["swap-pick"], installed: [], error: "already in the library: swap-pick" });
    expect(readLibrarySkillFile("swap-pick")).toBe(skillMd("swap-pick"));

    const replaced = await call("POST", "/api/skills-library/upload", { files: second, replace: ["swap-pick"] });
    expect(replaced.status).toBe(201);
    expect(replaced.body.installed).toMatchObject([{ name: "swap-pick", replaced: true }]);
    expect(readLibrarySkillFile("swap-pick")).toBe(skillMd("swap-pick", "Pick by this week's chart."));
    expect(stored("swap-pick")).toMatchObject({ enabled: false, source: "upload:files" });
  });

  it("refuses what holds no skill, what is not an archive, and a request with neither or both", async () => {
    const call = await serve();

    const empty = await call("POST", "/api/skills-library/upload", { files: [{ path: "notes.md", content: base64("notes") }] });
    expect(empty).toMatchObject({ status: 422, body: { errorKey: "serverError.skillUpload.noSkill" } });
    const broken = await call("POST", "/api/skills-library/upload", { archive: base64("this is not a zip") });
    expect(broken).toMatchObject({ status: 422, body: { errorKey: "serverError.skillUpload.notArchive" } });
    expect((await call("POST", "/api/skills-library/upload", {})).status).toBe(400);
    const both = { archive: base64("x"), files: [{ path: "SKILL.md", content: base64(skillMd("both-pick")) }] };
    expect((await call("POST", "/api/skills-library/upload", both)).status).toBe(400);
    expect(stored("both-pick")).toBeUndefined();
  });

  it("says a skill any bot may pick up is one that is switched on", async () => {
    const call = await serve();
    expect((await call("POST", "/api/skills-library/upload", { files: [{ path: "SKILL.md", content: base64(skillMd("offer-pick")) }] })).status).toBe(201);
    const row = async () => (await call("GET", "/api/skills-library")).body.skills?.find((skill) => skill.name === "offer-pick");

    expect(await row()).not.toHaveProperty("onOffer");
    setLibrarySkillReviewState("offer-pick", "approved");
    expect(await row()).toMatchObject({ onOffer: true });
  });

  it("is not there when the library is switched off", async () => {
    const call = await serve({ skillsLibrary: false });
    const files = [{ path: "SKILL.md", content: base64(skillMd("off-pick")) }];

    expect((await call("POST", "/api/skills-library/upload", { files })).status).toBe(404);
    expect((await call("DELETE", "/api/skills-library/off-pick")).status).toBe(404);
    expect((await call("POST", "/api/skills-library/restore", { undo: "off-pick.00000000-0000-0000-0000-000000000000" })).status).toBe(404);
    expect(stored("off-pick")).toBeUndefined();
  });
});

describe("removing a skill from the skills library", () => {
  it("takes it out for everyone and puts it back as it was when undone", async () => {
    const call = await serve();
    const files = [
      { path: "SKILL.md", content: base64(skillMd("gone-pick")) },
      { path: "references/sites.md", content: base64("# Sites\n") },
    ];
    expect((await call("POST", "/api/skills-library/upload", { files, label: "gone-pick.zip" })).status).toBe(201);
    setLibrarySkillReviewState("gone-pick", "approved");
    const before = stored("gone-pick");

    const removed = await call("DELETE", "/api/skills-library/gone-pick");
    expect(removed.status).toBe(200);
    expect(removed.body.undo).toMatch(/^gone-pick\./);
    expect(stored("gone-pick")).toBeUndefined();
    expect(readLibrarySkillFile("gone-pick")).toBeNull();
    expect((await call("DELETE", "/api/skills-library/gone-pick")).status).toBe(404);

    const restored = await call("POST", "/api/skills-library/restore", { undo: removed.body.undo });
    expect(restored.status).toBe(200);
    expect(restored.body.skill).toMatchObject({ name: "gone-pick", enabled: true });
    expect(stored("gone-pick")).toEqual(before);
    expect(readLibrarySkillFile("gone-pick")).toBe(skillMd("gone-pick"));
  });

  it("has nothing to undo twice, for a made-up token, or once the name is taken again", async () => {
    const call = await serve();
    const files = [{ path: "SKILL.md", content: base64(skillMd("twice-pick")) }];
    expect((await call("POST", "/api/skills-library/upload", { files })).status).toBe(201);
    const removed = await call("DELETE", "/api/skills-library/twice-pick");
    expect((await call("POST", "/api/skills-library/upload", { files })).status).toBe(201);

    expect((await call("POST", "/api/skills-library/restore", { undo: removed.body.undo })).status).toBe(409);
    expect((await call("POST", "/api/skills-library/restore", { undo: "../../etc/passwd" })).status).toBe(409);
    expect((await call("POST", "/api/skills-library/restore", {})).status).toBe(400);
    expect(stored("twice-pick")).toBeDefined();
  });
});
