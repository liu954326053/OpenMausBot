import { useEffect, useMemo } from "react";
import { createServerCanvasBackend, type ServerCanvasBackend } from "../../lib/project-canvas/server-backend";
import { useStore } from "../../state/store";
import { useStoreRef } from "../../state/store-ref";
import { ProjectCanvas, type ProjectCanvasProps } from "./ProjectCanvas";

/** The project canvas on the app's server, for a page inside the app's store. */
export function ServerProjectCanvas(props: Omit<ProjectCanvasProps, "backend">) {
  const store = useStoreRef();
  const backend = useMemo(() => createServerCanvasBackend(store), [store]);
  return (
    <>
      <BotsFollower backend={backend} />
      <ProjectCanvas {...props} backend={backend} />
    </>
  );
}

/** Draws nothing. It renders again on every change in the store, so the canvas beside it does not have to. */
function BotsFollower({ backend }: { backend: ServerCanvasBackend }) {
  const { bots } = useStore().state;
  useEffect(() => backend.followBots(bots), [backend, bots]);
  return null;
}
