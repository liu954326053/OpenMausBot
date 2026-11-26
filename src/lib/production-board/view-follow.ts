import { useLayoutEffect, useState } from "react";

type Subscribe = (listener: () => void) => () => void;

/** One subscription to the board's view for whatever in the overlay follows it, held while something does, through
 * the function the board gave last. A follower hears once of all the moves the board made at once, before the page
 * is drawn again. */
export function useViewFollow(subscribeView: Subscribe): Subscribe {
  const [hub] = useState(() => viewHub(subscribeView));
  useLayoutEffect(() => hub.from(subscribeView), [hub, subscribeView]);
  return hub.follow;
}

function viewHub(first: Subscribe) {
  const followers = new Set<() => void>();
  let source = first;
  let unsubscribe: (() => void) | null = null;
  let pending = false;
  const moved = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      for (const follower of followers) follower();
    });
  };
  return {
    from(next: Subscribe) {
      if (next === source) return;
      source = next;
      if (!unsubscribe) return;
      unsubscribe();
      unsubscribe = source(moved);
    },
    follow(listener: () => void) {
      followers.add(listener);
      unsubscribe ??= source(moved);
      return () => {
        followers.delete(listener);
        if (followers.size) return;
        unsubscribe?.();
        unsubscribe = null;
      };
    },
  };
}
