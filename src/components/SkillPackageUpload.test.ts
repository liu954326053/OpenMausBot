// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SkillUploadResult } from "../../shared/skill-import";
import { SkillPackageUpload } from "./SkillPackageUpload";

let root: Root;
let host: HTMLElement;
const added = vi.fn();
const sent: Array<Record<string, unknown>> = [];
let answers: Array<{ status: number; body: unknown }> = [];

const result = (parts: Partial<SkillUploadResult>): SkillUploadResult => ({ installed: [], unchanged: [], conflicts: [], errors: [], ...parts });
const came = (name: string, replaced = false) => ({ name, files: 1, scripts: 0, skipped: [], skippedCount: 0, replaced });
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const buttons = () => [...host.querySelectorAll("button")];
const button = (label: string) => buttons().find((one) => one.textContent === label)!;
const status = () => [...host.querySelectorAll('[role="status"]')].map((one) => [...one.querySelectorAll("p")].map((line) => line.textContent).join(" "));
const alert = () => host.querySelector('[role="alert"]')?.textContent ?? null;

function render(disabled = false) {
  flushSync(() => root.render(createElement(SkillPackageUpload, { disabled, onAdded: added })));
}

async function choose(selector: string, files: File[]) {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  Object.defineProperty(input, "files", { value: files, configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
}

const inFolder = (path: string, content: string) => {
  const file = new File([content], path.split("/").at(-1)!);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  added.mockClear();
  sent.length = 0;
  answers = [];
  vi.stubGlobal("fetch", vi.fn(async (_path: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const { status: code, body } = answers.shift()!;
    return { ok: code < 300, status: code, statusText: "", headers: new Headers(), json: async () => body };
  }));
});

afterEach(() => {
  root.unmount();
  host.remove();
  vi.unstubAllGlobals();
});

describe("adding a skill package to the library", () => {
  it("offers a file and a folder, and neither while the library is busy", () => {
    render();
    expect(buttons().map((one) => [one.textContent, one.disabled])).toEqual([["Choose file…", false], ["Choose folder…", false]]);
    expect(host.querySelector<HTMLInputElement>("[data-skill-upload-file]")!.accept).toBe(".zip,.skill,application/zip");
    expect(host.querySelector("[data-skill-upload-folder]")!.hasAttribute("webkitdirectory")).toBe(true);
    render(true);
    expect(buttons().every((one) => one.disabled)).toBe(true);
  });

  it("sends a chosen archive, says what came in, and has the list reloaded", async () => {
    answers = [{ status: 201, body: result({ installed: [came("tomato-pick")], unchanged: ["ranker"] }) }];
    render();
    await choose("[data-skill-upload-file]", [new File([new Uint8Array([80, 75, 5, 6])], "comics.zip")]);

    expect(sent).toEqual([{ archive: "UEsFBg==", label: "comics.zip" }]);
    expect(status()).toEqual(["Imported tomato-pick: 1 file. Review each one and turn it on below. Already in the library with the same files: ranker."]);
    expect(added).toHaveBeenCalledOnce();
    expect(alert()).toBeNull();
    expect(host.querySelector("[data-skill-upload]")!.getAttribute("data-skill-upload")).toBe("ready");
  });

  it("sends a chosen folder's files", async () => {
    answers = [{ status: 201, body: result({ installed: [came("pick")] }) }];
    render();
    await choose("[data-skill-upload-folder]", [inFolder("pick/SKILL.md", "---\nname: pick\n---\n"), inFolder("pick/.git/config", "x")]);

    expect(sent).toEqual([{ files: [{ path: "SKILL.md", content: Buffer.from("---\nname: pick\n---\n").toString("base64") }], label: "pick" }]);
    expect(added).toHaveBeenCalledOnce();
  });

  it("leaves a skill of the same name alone until Replace, then says what replaced it", async () => {
    answers = [
      { status: 201, body: result({ installed: [came("fresh")], unchanged: ["ranker"], conflicts: ["tomato-pick"] }) },
      { status: 201, body: result({ installed: [came("tomato-pick", true)], unchanged: ["fresh", "ranker"] }) },
    ];
    render();
    await choose("[data-skill-upload-file]", [new File(["PK"], "comics.zip")]);

    expect(status()).toEqual([
      "Imported fresh: 1 file. Review each one and turn it on below. Already in the library with the same files: ranker.",
      "Already in the library with different files: tomato-pick. Replacing a skill switches it off until you have read the new one.",
    ]);
    button("Replace").click();
    await settle();

    expect(sent[1]).toEqual({ archive: "UEs=", label: "comics.zip", replace: ["tomato-pick"] });
    expect(status()).toEqual(["Imported fresh: 1 file. Imported tomato-pick: 1 file. Review each one and turn it on below. Already in the library with the same files: ranker."]);
    expect(buttons().map((one) => one.textContent)).toEqual(["Choose file…", "Choose folder…"]);
    expect(added).toHaveBeenCalledTimes(2);
  });

  it("keeps what is there when asked to, without sending anything more", async () => {
    answers = [{ status: 409, body: { ...result({ conflicts: ["tomato-pick"] }), error: "already in the library: tomato-pick" } }];
    render();
    await choose("[data-skill-upload-file]", [new File(["PK"], "comics.zip")]);
    expect(added).not.toHaveBeenCalled();
    flushSync(() => button("Keep what's there").click());

    expect(status()).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it("says why a folder was not sent, and what the library answered when it took nothing", async () => {
    render();
    await choose("[data-skill-upload-folder]", [inFolder("notes/readme.md", "x")]);
    expect(alert()).toBe("That folder has no SKILL.md. Choose a skill's own folder, or a folder that holds several skills.");
    expect(sent).toEqual([]);

    answers = [{ status: 422, body: { error: "That file isn't a zip archive.", errorKey: "serverError.skillUpload.notArchive" } }];
    await choose("[data-skill-upload-file]", [new File(["plain"], "notes.zip")]);
    expect(alert()).toBe("That file isn't a zip archive. Choose a .zip or .skill file, or a folder that holds a SKILL.md.");
    expect(added).not.toHaveBeenCalled();
    expect(buttons().every((one) => !one.disabled)).toBe(true);
  });
});
