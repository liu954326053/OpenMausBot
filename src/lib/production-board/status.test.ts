import { beforeAll, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { botStatus, episodeStatus, generationTone, taskStatus, toneState } from "./status";

beforeAll(() => setLocale("en"));

describe("a bot's status", () => {
  it("puts a question for the person first, then a failure, then its work, then its task", () => {
    expect(botStatus({ status: "working", waiting: { threadId: "t", messageId: "m", card: {} as never } }).tone).toBe("asking");
    expect(botStatus({ status: "idle" }, "failed").tone).toBe("failed");
    expect(botStatus({ status: "error" }).tone).toBe("failed");
    expect(botStatus({ status: "working" }).tone).toBe("working");
    expect(botStatus({ status: "queued" }).tone).toBe("working");
    expect(botStatus({ status: "idle" }, "done").tone).toBe("done");
    expect(botStatus({ status: "idle" }).tone).toBe("idle");
  });
});

describe("the other statuses", () => {
  it("read a task, an episode and a generation", () => {
    expect(taskStatus(undefined)).toBeNull();
    expect(taskStatus("waiting")?.tone).toBe("idle");
    expect(episodeStatus("videos")?.tone).toBe("working");
    expect(episodeStatus("failed")?.tone).toBe("failed");
    expect(episodeStatus(undefined)).toBeNull();
    expect(generationTone("loading")).toBe("working");
    expect(generationTone(undefined)).toBe("idle");
  });

  it("name the mockup's state for each tone", () => {
    expect((["idle", "working", "done", "asking", "failed"] as const).map(toneState)).toEqual(["waiting", "working", "done", "working", "failed"]);
  });
});
