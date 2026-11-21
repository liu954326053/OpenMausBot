import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny hook runtime: state slots that survive renders, and effects that run when their dependencies change.
const runtime = vi.hoisted(() => ({
  slots: [] as unknown[],
  deps: [] as Array<unknown[] | undefined>,
  index: 0,
  effect: 0,
}));

vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const i = runtime.index++;
    if (!(i in runtime.slots)) runtime.slots[i] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [runtime.slots[i], (next: unknown) => { runtime.slots[i] = typeof next === "function" ? (next as (v: unknown) => unknown)(runtime.slots[i]) : next; }];
  },
  useEffect: (run: () => void, deps?: unknown[]) => {
    const i = runtime.effect++;
    const previous = runtime.deps[i];
    if (!previous || !deps || deps.some((dep, at) => dep !== previous[at])) {
      runtime.deps[i] = deps;
      run();
    }
  },
}));

const { forgetDisclosuresForTests, useRememberedDisclosure } = await import("./remembered-disclosure");

/** Renders twice so an effect's state change is visible, as React would show it. */
const row = (key: string) => () => {
  let result!: ReturnType<typeof useRememberedDisclosure>;
  for (let pass = 0; pass < 2; pass++) {
    runtime.index = 0;
    runtime.effect = 0;
    result = useRememberedDisclosure(key);
  }
  return result;
};

const remount = () => {
  runtime.slots = [];
  runtime.deps = [];
};

beforeEach(() => {
  remount();
  forgetDisclosuresForTests();
});

describe("a sidebar row's remembered disclosure", () => {
  it("starts closed, and keeps the person's choice across a remount", () => {
    const writer = row("bot:writer");
    expect(writer()[0]).toBe(false);
    writer()[1](true);
    expect(writer()[0]).toBe(true);
    remount();
    expect(row("bot:writer")()[0]).toBe(true);
    remount();
    expect(row("bot:chief")()[0]).toBe(false);
  });

  it("toggles from what the row shows", () => {
    const scout = row("bot:scout");
    scout()[1]((open) => !open);
    expect(scout()[0]).toBe(true);
    scout()[1]((open) => !open);
    remount();
    expect(row("bot:scout")()[0]).toBe(false);
  });
});
