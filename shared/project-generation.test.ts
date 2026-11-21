import { describe, expect, it } from "vitest";

import {
  COMMON_CHOICES,
  DEFAULT_GENERATION_SETTINGS,
  fitSettings,
  GENERATION_OUTPUT_FOLDERS,
  modelOffers,
  nodeStatusOf,
  resolveSettings,
  settingProblems,
  type GenerationModel,
  type ImageSettings,
  type VideoSettings,
} from "./project-generation.ts";

const projectImage: ImageSettings = { model: "flux", aspect: "1:1", quality: "high", count: 2 };
const projectVideo: VideoSettings = { model: "kling", resolution: "720p", aspect: "16:9", seconds: 5 };

const flux: GenerationModel = { id: "flux", name: "Flux", kind: "image", aspects: ["1:1", "16:9"], qualities: ["standard", "high"], maxCount: 2, referenceImages: true, referenceAudio: false };
const plain: GenerationModel = { id: "plain", name: "Plain", kind: "image", referenceImages: false, referenceAudio: false };
const kling: GenerationModel = { id: "kling", name: "Kling", kind: "video", resolutions: ["720p", "1080p"], aspects: ["16:9", "9:16"], durations: [5, 10], referenceImages: true, referenceAudio: true };
const silent: GenerationModel = { id: "silent", name: "Silent", kind: "video", resolutions: [], referenceImages: false, referenceAudio: false };

describe("a node's settings", () => {
  it("take each key the node overrides and every other key from the project", () => {
    expect(resolveSettings("image", projectImage, { quality: "standard" })).toEqual({ model: "flux", aspect: "1:1", quality: "standard", count: 2 });
    expect(resolveSettings("video", projectVideo, { model: "veo", seconds: 10 })).toEqual({ model: "veo", resolution: "720p", aspect: "16:9", seconds: 10 });
  });

  it("are the project's when the node overrides nothing", () => {
    expect(resolveSettings("image", projectImage, undefined)).toEqual(projectImage);
    expect(resolveSettings("video", projectVideo, null)).toEqual(projectVideo);
    expect(resolveSettings("video", projectVideo, {})).toEqual(projectVideo);
  });

  it("follow the project again for a key the node no longer overrides", () => {
    const changed = { ...projectImage, model: "flux-2" };
    expect(resolveSettings("image", changed, { aspect: "16:9" }).model).toBe("flux-2");
  });

  it("ignore an override of the wrong type, an empty one and a key no setting has", () => {
    const node = { model: "", aspect: 16, count: "3", quality: "  ", prompt: "not a setting" } as unknown as Partial<ImageSettings>;
    expect(resolveSettings("image", projectImage, node)).toEqual(projectImage);
    const video = { seconds: Number.NaN, resolution: null } as unknown as Partial<VideoSettings>;
    expect(resolveSettings("video", projectVideo, video)).toEqual(projectVideo);
  });

  it("keep a count or a length that is not a whole positive number out", () => {
    expect(resolveSettings("image", projectImage, { count: 0 }).count).toBe(2);
    expect(resolveSettings("image", projectImage, { count: 1.5 }).count).toBe(2);
    expect(resolveSettings("video", projectVideo, { seconds: -5 }).seconds).toBe(5);
  });

  it("never carry a key of one kind into the other", () => {
    const mixed = { seconds: 10, resolution: "1080p" } as unknown as Partial<ImageSettings>;
    expect(Object.keys(resolveSettings("image", projectImage, mixed)).sort()).toEqual(["aspect", "count", "model", "quality"]);
  });
});

describe("what a model offers", () => {
  it("is the server's list where it gave one", () => {
    expect(modelOffers(flux)).toEqual({ kind: "image", aspects: ["1:1", "16:9"], qualities: ["standard", "high"], counts: [1, 2], referenceImages: true, referenceAudio: false });
    expect(modelOffers(kling)).toEqual({ kind: "video", resolutions: ["720p", "1080p"], aspects: ["16:9", "9:16"], durations: [5, 10], referenceImages: true, referenceAudio: true });
  });

  it("is the common choices where the server gave no list, or an empty one", () => {
    expect(modelOffers(plain)).toEqual({
      kind: "image", aspects: [...COMMON_CHOICES.image.aspects], qualities: [...COMMON_CHOICES.image.qualities],
      counts: [1, 2, 3, 4], referenceImages: false, referenceAudio: false,
    });
    expect(modelOffers(silent)).toMatchObject({ resolutions: [...COMMON_CHOICES.video.resolutions], durations: [...COMMON_CHOICES.video.durations] });
  });

  it("never takes reference audio for a picture", () => {
    expect(modelOffers({ ...flux, referenceAudio: true }).referenceAudio).toBe(false);
  });
});

describe("settings a model does not offer", () => {
  it("are none for settings the model offers", () => {
    expect(settingProblems("image", projectImage, [flux, kling])).toEqual([]);
    expect(settingProblems("video", projectVideo, [flux, kling], { images: 2, audio: 1 })).toEqual([]);
  });

  it("name each refused key with what the model offers instead", () => {
    expect(settingProblems("image", { model: "flux", aspect: "21:9", quality: "max", count: 3 }, [flux])).toEqual([
      { key: "aspect", value: "21:9", offered: ["1:1", "16:9"] },
      { key: "quality", value: "max", offered: ["standard", "high"] },
      { key: "count", value: 3, offered: [1, 2] },
    ]);
    expect(settingProblems("video", { model: "kling", resolution: "4k", aspect: "1:1", seconds: 7 }, [kling])).toEqual([
      { key: "resolution", value: "4k", offered: ["720p", "1080p"] },
      { key: "aspect", value: "1:1", offered: ["16:9", "9:16"] },
      { key: "seconds", value: 7, offered: [5, 10] },
    ]);
  });

  it("judge a model with no lists by the common choices", () => {
    expect(settingProblems("image", { model: "plain", aspect: "16:9", quality: "high", count: 4 }, [plain])).toEqual([]);
    expect(settingProblems("image", { model: "plain", aspect: "5:1", quality: "high", count: 5 }, [plain])).toEqual([
      { key: "aspect", value: "5:1", offered: [...COMMON_CHOICES.image.aspects] },
      { key: "count", value: 5, offered: [1, 2, 3, 4] },
    ]);
  });

  it("say which models the server lists when the model is not one of them, or of another kind", () => {
    expect(settingProblems("image", { ...projectImage, model: "gone" }, [flux, plain, kling])).toEqual([{ key: "model", value: "gone", offered: ["flux", "plain"] }]);
    expect(settingProblems("image", { ...projectImage, model: "kling" }, [flux, kling])).toEqual([{ key: "model", value: "kling", offered: ["flux"] }]);
  });

  it("refuse references the model does not take rather than drop them", () => {
    expect(settingProblems("image", { ...projectImage, model: "plain", quality: "auto" }, [plain], { images: 1, audio: 0 })).toEqual([
      { key: "referenceImages", value: 1, offered: [] },
    ]);
    expect(settingProblems("image", projectImage, [flux], { images: 0, audio: 1 })).toEqual([{ key: "referenceAudio", value: 1, offered: [] }]);
    expect(settingProblems("video", { model: "silent", resolution: "720p", aspect: "16:9", seconds: 5 }, [silent], { images: 1, audio: 2 })).toEqual([
      { key: "referenceImages", value: 1, offered: [] },
      { key: "referenceAudio", value: 2, offered: [] },
    ]);
  });
});

describe("settings fitted to a model", () => {
  it("keep every value the model offers", () => {
    expect(fitSettings("image", projectImage, flux)).toEqual(projectImage);
    expect(fitSettings("video", projectVideo, kling)).toEqual(projectVideo);
  });

  it("take the model's first choice for a value it does not offer, and the nearest count or length", () => {
    expect(fitSettings("image", { model: "flux", aspect: "21:9", quality: "auto", count: 4 }, flux)).toEqual({ model: "flux", aspect: "1:1", quality: "standard", count: 2 });
    expect(fitSettings("video", { model: "kling", resolution: "4k", aspect: "1:1", seconds: 8 }, kling)).toEqual({ model: "kling", resolution: "720p", aspect: "16:9", seconds: 10 });
  });

  it("fall back to the common choices where the model gives no list", () => {
    expect(fitSettings("image", { model: "plain", aspect: "5:1", quality: "auto", count: 9 }, plain)).toEqual({ model: "plain", aspect: COMMON_CHOICES.image.aspects[0], quality: "auto", count: 4 });
  });

  it("are settings the model offers, whatever they were", () => {
    const images: ImageSettings[] = [projectImage, DEFAULT_GENERATION_SETTINGS.image.defaults, { model: "", aspect: "7:3", quality: "ultra", count: 10 }];
    for (const settings of images) {
      for (const model of [flux, plain]) expect(settingProblems("image", fitSettings("image", { ...settings, model: model.id }, model), [model])).toEqual([]);
    }
    const videos: VideoSettings[] = [projectVideo, DEFAULT_GENERATION_SETTINGS.video.defaults, { model: "", resolution: "8k", aspect: "2:1", seconds: 60 }];
    for (const settings of videos) {
      for (const model of [kling, silent]) expect(settingProblems("video", fitSettings("video", { ...settings, model: model.id }, model), [model])).toEqual([]);
    }
  });
});

describe("the rest of the contract", () => {
  it("starts a project with no server and no model, from the common choices", () => {
    expect(DEFAULT_GENERATION_SETTINGS.image.server).toBeNull();
    expect(DEFAULT_GENERATION_SETTINGS.video.server).toBeNull();
    expect(DEFAULT_GENERATION_SETTINGS.image.defaults.model).toBe("");
    expect(COMMON_CHOICES.image.aspects).toContain(DEFAULT_GENERATION_SETTINGS.image.defaults.aspect);
    expect(COMMON_CHOICES.image.qualities).toContain(DEFAULT_GENERATION_SETTINGS.image.defaults.quality);
    expect(COMMON_CHOICES.video.resolutions).toContain(DEFAULT_GENERATION_SETTINGS.video.defaults.resolution);
    expect(COMMON_CHOICES.video.durations).toContain(DEFAULT_GENERATION_SETTINGS.video.defaults.seconds);
    expect(DEFAULT_GENERATION_SETTINGS.image.tools).toEqual({ listModels: "list_models", generate: "generate_image", taskStatus: "task_status", cancelTask: "cancel_task" });
    expect(DEFAULT_GENERATION_SETTINGS.video.tools.generate).toBe("generate_video");
  });

  it("maps a job's status to the status its node shows", () => {
    expect(nodeStatusOf("queued")).toBe("loading");
    expect(nodeStatusOf("running")).toBe("loading");
    expect(nodeStatusOf("done")).toBe("success");
    expect(nodeStatusOf("failed")).toBe("error");
    expect(nodeStatusOf("cancelled")).toBe("idle");
  });

  it("puts results under the project folder's output folders", () => {
    expect(GENERATION_OUTPUT_FOLDERS).toEqual({ image: ["产出", "图片"], video: ["产出", "视频"] });
  });
});
