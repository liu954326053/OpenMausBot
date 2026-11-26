// React's developer-tools hook, which react-dom reads once as it loads: import this module before anything that loads
// react-dom.

/** The fields of a React fiber the bench reads, as React 19 sets them in its profiling build. */
export interface Fiber {
  tag: number;
  type: { displayName?: string; name?: string; render?: { displayName?: string; name?: string } } | null;
  alternate: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  flags: number;
  actualDuration?: number;
  memoizedProps?: Record<string, unknown> | null;
}

type CommitListener = (root: { current: Fiber }) => void;

export const commitListeners = new Set<CommitListener>();

const target = window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Record<string, unknown> };
const renderers = new Map<number, unknown>();
target.__REACT_DEVTOOLS_GLOBAL_HOOK__ ??= {
  renderers,
  supportsFiber: true,
  inject(renderer: unknown) {
    renderers.set(renderers.size + 1, renderer);
    return renderers.size;
  },
  onScheduleFiberRoot() {},
  onCommitFiberRoot() {},
  onCommitFiberUnmount() {},
  onPostCommitFiberRoot() {},
  setStrictMode() {},
  checkDCE() {},
};
const hook = target.__REACT_DEVTOOLS_GLOBAL_HOOK__;
const before = hook.onCommitFiberRoot as ((...args: unknown[]) => void) | undefined;
hook.onCommitFiberRoot = function onCommitFiberRoot(this: unknown, ...args: unknown[]) {
  before?.apply(this, args);
  for (const listener of commitListeners) listener(args[1] as { current: Fiber });
};
