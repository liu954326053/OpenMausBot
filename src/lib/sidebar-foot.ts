import { useLayoutEffect, type RefObject } from "react";

/** The height of the sidebar's foot, on `<html>` while the sidebar is on screen: the notices' corner starts above it. */
export const SIDEBAR_FOOT = "--sidebar-foot";

export function usePublishedSidebarFoot(sidebar: RefObject<HTMLElement | null>, shown: boolean): void {
  useLayoutEffect(() => {
    const foot = sidebar.current?.querySelector<HTMLElement>("[data-sidebar-foot]");
    if (!shown || !foot) return;
    const root = document.documentElement.style;
    const publish = () => root.setProperty(SIDEBAR_FOOT, `${Math.ceil(foot.getBoundingClientRect().height)}px`);
    publish();
    const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    resized?.observe(foot);
    return () => {
      resized?.disconnect();
      root.removeProperty(SIDEBAR_FOOT);
    };
  }, [sidebar, shown]);
}
