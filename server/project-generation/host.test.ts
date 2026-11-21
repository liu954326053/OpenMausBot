import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BOT_GENERATION_CEILING, DEFAULT_GENERATION_SETTINGS, type GenerationFailure, type GenerationJob } from "../../shared/project-generation.ts";
import { fakePng } from "../testing/fake-generation-mcp-server.ts";
import { generationHarness, type GenerationHarness } from "../testing/project-generation-harness.ts";

let harness: GenerationHarness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

async function open() {
  harness = await generationHarness();
  return harness;
}

const IMAGE = { server: "gen", defaults: { model: "pixel-1", aspect: "1:1", quality: "standard", count: 1 } };
const VIDEO = { server: "gen", defaults: { model: "motion-1", resolution: "720p", aspect: "16:9", seconds: 5 } };

function refusal(outcome: { refused: GenerationFailure } | object): GenerationFailure {
  if (!("refused" in outcome)) throw new Error(`not refused: ${JSON.stringify(outcome)}`);
  return outcome.refused;
}

function job(outcome: { job: GenerationJob } | { refused: GenerationFailure }): GenerationJob {
  if (!("job" in outcome)) throw new Error(`refused: ${JSON.stringify(outcome.refused)}`);
  return outcome.job;
}

describe("a project's generation settings", () => {
  it("lists the models of the chosen MCP server, and of a server being chosen", async () => {
    const h = await open();
    h.project("film");
    expect(refusal(await h.api.models("film", "image"))).toMatchObject({ code: "no_server", error: "Choose an MCP server for pictures in this project's settings first." });
    const previewed = await h.api.models("film", "video", { server: "gen" });
    expect(previewed).toEqual({ models: [
      expect.objectContaining({ id: "motion-1", name: "Motion 1", resolutions: ["720p", "1080p"], durations: [5, 10], referenceAudio: true }),
      expect.objectContaining({ id: "motion-lite", durations: [4], referenceImages: false }),
    ] });
    await h.api.saveSettings("film", { image: { server: "gen" } } as never);
    expect((await h.api.models("film", "image") as { models: Array<{ id: string }> }).models.map((model) => model.id)).toEqual(["pixel-1", "sketch"]);
    expect(h.generation.servers()).toEqual(["gen"]);
  });

  it("keeps each project's own settings, and a new project starts from the settings saved last", async () => {
    const h = await open();
    h.project("first");
    expect(h.api.settings("first")).toEqual(DEFAULT_GENERATION_SETTINGS);
    const saved = await h.api.saveSettings("first", { image: IMAGE, video: VIDEO } as never);
    const settings = { image: { ...DEFAULT_GENERATION_SETTINGS.image, ...IMAGE }, video: { ...DEFAULT_GENERATION_SETTINGS.video, ...VIDEO } };
    expect(saved).toEqual({ settings });

    h.project("second");
    const again = h.restart();
    expect(again.api.settings("second")).toEqual(settings);
    expect(await again.api.saveSettings("second", { image: { defaults: { aspect: "16:9" } } } as never)).toHaveProperty("settings");
    expect(again.api.settings("first")).toEqual(settings);
    h.project("third");
    expect(again.api.settings("third")?.image.defaults).toEqual({ ...IMAGE.defaults, aspect: "16:9" });
    expect(again.api.settings("nope")).toBeNull();
  });

  it("refuses a setting the model doesn't offer when it is saved, saying what the model offers", async () => {
    const h = await open();
    h.project("film");
    const quality = refusal(await h.api.saveSettings("film", { image: { ...IMAGE, defaults: { ...IMAGE.defaults, quality: "auto" } } } as never));
    expect(quality).toMatchObject({
      code: "setting_refused", error: "Pixel 1 doesn't offer the quality auto. It offers standard, hd.",
      problems: [{ key: "quality", value: "auto", offered: ["standard", "hd"] }],
    });
    const seconds = refusal(await h.api.saveSettings("film", { video: { ...VIDEO, defaults: { ...VIDEO.defaults, model: "motion-lite", resolution: "480p" } } } as never));
    expect(seconds.error).toBe("Motion Lite doesn't make 5-second videos. It makes 4 seconds.");
    const model = refusal(await h.api.saveSettings("film", { image: { ...IMAGE, defaults: { ...IMAGE.defaults, model: "pixel-9" } } } as never));
    expect(model).toMatchObject({ code: "model_unknown", error: "gen doesn't list a model called pixel-9. Choose another one in this project's settings." });
    expect(h.api.settings("film")).toEqual(DEFAULT_GENERATION_SETTINGS);
  });

  it("refuses a server that is gone, turned off or lacking a tool, and settings that aren't settings", async () => {
    const h = await open();
    h.project("film");
    const gone = refusal(await h.api.saveSettings("film", { image: { ...IMAGE, server: "elsewhere" } } as never));
    expect(gone).toMatchObject({ code: "server_unusable", error: "There is no MCP server called elsewhere any more. Choose another one in this project's settings." });
    h.setServers((url) => ({ gen: { type: "http", url, enabled: false } }));
    expect(refusal(await h.api.saveSettings("film", { image: IMAGE } as never)).error)
      .toBe("The MCP server gen is turned off. Turn it on in Apps → MCP servers, or choose another one in this project's settings.");
    expect(refusal(await h.api.saveSettings("film", { image: { defaults: { count: 0 } } } as never))).toMatchObject({ code: "invalid" });
    expect(refusal(await h.api.saveSettings("film", { video: { tools: { generate: "generate video!" } } } as never))).toMatchObject({ code: "invalid" });
  });
});

describe("starting a generation", () => {
  it("is refused with no MCP server chosen, saying one must be chosen in the project's settings", async () => {
    const h = await open();
    h.project("film");
    const outcome = refusal(await h.api.start("film", { kind: "video", nodeId: "n", prompt: "waves" }, { requester: { kind: "person" } }));
    expect(outcome).toEqual({
      code: "no_server", error: "Choose an MCP server for videos in this project's settings first.", errorKey: "serverError.projectGeneration.noVideoServer",
    });
    await h.api.saveSettings("film", { image: { server: "gen" } } as never);
    expect(refusal(await h.api.start("film", { kind: "image", nodeId: "n", prompt: "a" }, { requester: { kind: "person" } })).code).toBe("no_model");
    expect(h.fake.calls.filter((call) => call.tool.startsWith("generate_"))).toEqual([]);
  });

  it("refuses a node's own setting the model doesn't offer, and references it can't take or that aren't in the project", async () => {
    const h = await open();
    const folder = h.project("film");
    await h.api.saveSettings("film", { image: IMAGE, video: VIDEO } as never);
    const person = { requester: { kind: "person" } as const };
    expect(refusal(await h.api.start("film", { kind: "image", nodeId: "n", prompt: "a", overrides: { aspect: "21:9" } }, person))).toMatchObject({
      code: "setting_refused", error: "Pixel 1 doesn't make the shape 21:9. It makes 1:1, 16:9, 9:16.", problems: [{ key: "aspect", value: "21:9", offered: ["1:1", "16:9", "9:16"] }],
    });
    expect(refusal(await h.api.start("film", { kind: "image", nodeId: "n", prompt: "a", overrides: { count: 5 } }, person)).error).toBe("Pixel 1 can't make 5 pictures at once. Choose 1, 2, 3, 4.");

    writeFileSync(join(folder, "ref.png"), fakePng("1:1", 1));
    writeFileSync(join(folder, "notes.txt"), "not a picture");
    writeFileSync(join(h.root, "outside.png"), fakePng("1:1", 2));
    symlinkSync(join(h.root, "outside.png"), join(folder, "linked.png"));
    mkdirSync(join(folder, "sub"));
    const sketch = { kind: "image", nodeId: "n", prompt: "a", overrides: { model: "sketch", quality: "auto", aspect: "1:1" } } as const;
    expect(refusal(await h.api.start("film", { ...sketch, references: { images: ["ref.png"] } }, person)).error).toBe("Sketch doesn't take reference pictures. Remove them, or choose another model.");
    for (const [path, error] of [
      ["../outside.png", "../outside.png isn't a file in this project's folder."],
      ["linked.png", "linked.png isn't a file in this project's folder."],
      ["sub", "sub isn't a file in this project's folder."],
      ["notes.txt", "notes.txt isn't a picture, so it can't be a reference picture."],
    ]) {
      expect(refusal(await h.api.start("film", { kind: "image", nodeId: "n", prompt: "a", references: { images: [path!] } }, person))).toMatchObject({ code: "reference_refused", error });
    }
    expect(refusal(await h.api.start("film", { kind: "video", nodeId: "n", prompt: "a", overrides: { model: "motion-lite", resolution: "480p", seconds: 4 }, references: { audio: ["ref.png"] } }, person)).code)
      .toBe("reference_refused");
    expect(h.fake.calls.filter((call) => call.tool.startsWith("generate_"))).toEqual([]);
  });

  it("is refused in an archived project, an unknown one, and for input that isn't a generation", async () => {
    const h = await open();
    h.project("old", Date.now());
    const person = { requester: { kind: "person" } as const };
    expect(refusal(await h.api.start("old", { kind: "image", nodeId: "n", prompt: "a" }, person)).error).toBe("This project is archived, so nothing new is made in it. Restore it first.");
    expect(refusal(await h.api.start("missing", { kind: "image", nodeId: "n", prompt: "a" }, person)).code).toBe("project_unavailable");
    h.project("film");
    for (const input of [{ kind: "audio", nodeId: "n", prompt: "a" }, { kind: "image", nodeId: "n", prompt: "   " }, { kind: "image", prompt: "a" }]) {
      expect(refusal(await h.api.start("film", input as never, person)).code).toBe("invalid");
    }
  });

  it("needs the person's confirmation once a bot passes its ceiling, counts each picture, and doesn't count what was confirmed", async () => {
    const h = await open();
    h.project("film");
    await h.api.saveSettings("film", { image: IMAGE, video: VIDEO } as never);
    const bot = (confirmed?: true) => ({ requester: { kind: "bot", botId: "bot-a", ...(confirmed ? { confirmed } : {}) } as const });
    const picture = (count: number) => ({ kind: "image", nodeId: "n", prompt: "a", overrides: { count } }) as const;

    job(await h.api.start("film", picture(4), bot()));
    job(await h.api.start("film", picture(4), bot()));
    expect(h.api.botAllowance("film", "bot-a").image).toMatchObject({ used: 8, ceiling: BOT_GENERATION_CEILING.image });
    expect(refusal(await h.api.start("film", picture(1), bot()))).toMatchObject({
      code: "confirmation_needed", allowance: { used: 8, ceiling: 8, asked: 1 },
      error: "A bot may start 8 pictures a day without you, and this one has started 8. Confirm to let it make 1 more.",
    });
    job(await h.api.start("film", picture(2), bot(true)));
    job(await h.api.start("film", picture(4), { requester: { kind: "person" } }));
    job(await h.api.start("film", picture(1), { requester: { kind: "bot", botId: "bot-b" } }));
    expect(h.api.botAllowance("film", "bot-a").image.used).toBe(8);

    for (let made = 0; made < BOT_GENERATION_CEILING.video; made += 1) job(await h.api.start("film", { kind: "video", nodeId: "v", prompt: "a" }, bot()));
    const again = h.restart();
    expect(refusal(await again.api.start("film", { kind: "video", nodeId: "v", prompt: "a" }, bot())).error)
      .toBe("A bot may start 3 videos a day without you, and this one has started 3. Confirm to let it make 1 more.");
    expect(refusal(await again.api.start("film", picture(1), bot())).code).toBe("confirmation_needed");
  });
});
