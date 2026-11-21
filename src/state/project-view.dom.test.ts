// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamProjectWire } from "../../shared/team-projects";
import { LAST_PROJECT_KEY, useLastProject } from "./project-view";
import type { AppState } from "./store";
import { setTeamProjects } from "./team-projects";

type Shown = Pick<AppState, "activeView" | "project" | "hydrated" | "selectedId">;
const project = (id: string, extra: Partial<TeamProjectWire> = {}): TeamProjectWire => ({
  id, name: id, folder: `/dramas/${id}`, section: id, team: { key: "team:urban", name: "Urban" }, follows: {},
  leadBotId: "lead", createdAt: 1, folderState: "ready", botIds: ["lead"], ...extra,
});

const dispatch = vi.fn();
let container: HTMLDivElement, root: Root;
const Harness = ({ shown }: { shown: Shown }) => { useLastProject(shown, dispatch); return null; };
const show = async (shown: Partial<Shown>) => {
  await act(async () => root.render(createElement(Harness, { shown: { activeView: "chat", hydrated: true, selectedId: "main", ...shown } })));
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  dispatch.mockClear();
  setTeamProjects(null);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setTeamProjects(null);
  vi.unstubAllGlobals();
});

describe("the project view at the next start", () => {
  it("remembers the open project and forgets it once something else opens", async () => {
    await show({ activeView: "project", project: { id: "p-1", botId: "lead" } });
    expect(localStorage.getItem(LAST_PROJECT_KEY)).toBe("p-1");
    await show({ activeView: "team-map", project: { id: "p-1" } });
    expect(localStorage.getItem(LAST_PROJECT_KEY)).toBeNull();
  });

  it("comes back once the list of projects is read, while the project is still there", async () => {
    localStorage.setItem(LAST_PROJECT_KEY, "p-1");
    await show({ hydrated: undefined, selectedId: "" });
    await show({});
    expect(dispatch).not.toHaveBeenCalled();
    expect(localStorage.getItem(LAST_PROJECT_KEY), "kept while the list is on its way").toBe("p-1");
    await act(async () => setTeamProjects({ root: "/dramas", projects: [project("p-1")] }));
    expect(dispatch).toHaveBeenCalledWith({ type: "showProject", projectId: "p-1" });
    await act(async () => setTeamProjects({ root: "/dramas", projects: [project("p-1"), project("p-2")] }));
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("stays on the chat when the project went away", async () => {
    localStorage.setItem(LAST_PROJECT_KEY, "p-1");
    setTeamProjects({ root: "/dramas", projects: [project("p-1", { archivedAt: 5 })] });
    await show({});
    expect(dispatch).not.toHaveBeenCalled();
    expect(localStorage.getItem(LAST_PROJECT_KEY)).toBeNull();
  });

  it("stays where the person went if they opened something before the list came", async () => {
    localStorage.setItem(LAST_PROJECT_KEY, "p-1");
    await show({});
    await show({ selectedId: "sales" });
    await act(async () => setTeamProjects({ root: "/dramas", projects: [project("p-1")] }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(localStorage.getItem(LAST_PROJECT_KEY)).toBeNull();
  });
});
