import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../../../shared/project-canvas";
import { DEFAULT_GENERATION_SETTINGS, type GenerationModel, type ProjectGenerationSettings } from "../../../shared/project-generation";
import { CONCURRENCY_KEYS, concurrencyCount, nodeSettings, overrideSetting, referenceProblems, restoreSetting, settingRows, withConcurrency } from "./settings";

const project: ProjectGenerationSettings = {
  image: { ...DEFAULT_GENERATION_SETTINGS.image, server: "studio", defaults: { model: "pic-1", aspect: "1:1", quality: "auto", count: 1 } },
  video: { ...DEFAULT_GENERATION_SETTINGS.video, server: "studio", defaults: { model: "clip-1", resolution: "720p", aspect: "16:9", seconds: 5 } },
  concurrency: { ...DEFAULT_GENERATION_SETTINGS.concurrency },
};
const models: GenerationModel[] = [
  { id: "pic-1", name: "Pic", kind: "image", aspects: ["1:1", "16:9"], referenceImages: true, referenceAudio: false },
  { id: "clip-1", name: "Clip", kind: "video", resolutions: ["720p", "1080p"], durations: [5, 10], referenceImages: true, referenceAudio: false },
  { id: "clip-2", name: "Clip 2", kind: "video", referenceImages: true, referenceAudio: true },
];
const shot = (settings?: CanvasNode["metadata"]): CanvasNode => ({ id: "s", type: "shot", title: "Shot", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: settings });

describe("generation settings on a node", () => {
  it("follows the project for every key the node leaves alone", () => {
    const node = shot({ settings: { seconds: 10, quality: "high" } });
    expect(nodeSettings("video", project, node)).toEqual({ model: "clip-1", resolution: "720p", aspect: "16:9", seconds: 10 });
    const rows = settingRows("video", project, node, models);
    expect(rows.map((row) => [row.key, row.value, row.overridden, row.inherited])).toEqual([
      ["model", "clip-1", false, "clip-1"],
      ["resolution", "720p", false, "720p"],
      ["aspect", "16:9", false, "16:9"],
      ["seconds", 10, true, 5],
    ]);
  });

  it("inherits the project's new default once the node stops overriding it", () => {
    const node = shot({ settings: { resolution: "1080p" } });
    expect(nodeSettings("video", project, node).resolution).toBe("1080p");
    const restored = { ...node, metadata: { settings: restoreSetting(node, "resolution") ?? undefined } };
    const changed: ProjectGenerationSettings = { ...project, video: { ...project.video, defaults: { ...project.video.defaults, resolution: "480p" } } };
    expect(nodeSettings("video", changed, restored).resolution).toBe("480p");
    expect(restoreSetting(node, "resolution")).toBeNull();
    expect(restoreSetting(shot({ settings: { resolution: "1080p", seconds: 10 } }), "resolution")).toEqual({ seconds: 10 });
    expect(overrideSetting(node, "seconds", 10)).toEqual({ resolution: "1080p", seconds: 10 });
  });

  it("offers what the model offers, the common choices where it lists none, and flags what it refuses", () => {
    const rows = settingRows("video", project, shot({ settings: { resolution: "480p", model: "clip-1" } }), models);
    expect(rows.find((row) => row.key === "resolution")).toMatchObject({ choices: ["720p", "1080p"], problem: { key: "resolution", value: "480p", offered: ["720p", "1080p"] } });
    expect(rows.find((row) => row.key === "model")!.choices).toEqual(["clip-1", "clip-2"]);
    const common = settingRows("video", project, shot({ settings: { model: "clip-2" } }), models);
    expect(common.find((row) => row.key === "aspect")!.choices).toEqual(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]);
    expect(settingRows("image", project, { ...shot(), type: "image" }, []).find((row) => row.key === "count")!.choices).toEqual([1, 2, 3, 4]);
  });

  it("flags references the model does not take", () => {
    expect(referenceProblems("video", project, shot(), models, { images: 1, audio: 1 })).toEqual([{ key: "referenceAudio", value: 1, offered: [] }]);
    expect(referenceProblems("video", project, shot({ settings: { model: "clip-2" } }), models, { images: 1, audio: 1 })).toEqual([]);
  });
});

describe("how much of the production runs at once", () => {
  it("is set as videos, images, then episodes", () => {
    expect(CONCURRENCY_KEYS).toEqual(["videos", "images", "episodes"]);
  });

  it("takes a whole number from 1 to 50 as typed, with full-width digits and spaces around it", () => {
    expect(["1", "2", " 50 ", "07", "１２"].map(concurrencyCount)).toEqual([1, 2, 50, 7, 12]);
  });

  it("takes nothing else", () => {
    expect(["", " ", "0", "51", "100", "2.5", "-1", "+3", "1e1", "two", "0x2"].map(concurrencyCount)).toEqual(Array(11).fill(null));
  });

  it("starts from the defaults, 2 videos, 2 images and 3 episodes, where the server sends none", () => {
    const { concurrency: _sent, ...older } = project;
    expect(withConcurrency(older).concurrency).toEqual({ videos: 2, images: 2, episodes: 3 });
    expect(withConcurrency({ ...older, concurrency: { episodes: 6 } }).concurrency).toEqual({ videos: 2, images: 2, episodes: 6 });
    expect(withConcurrency({ ...project, concurrency: { videos: 9, images: 1, episodes: 50 } })).toEqual({ ...project, concurrency: { videos: 9, images: 1, episodes: 50 } });
  });
});
