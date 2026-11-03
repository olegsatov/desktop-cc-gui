import { beforeEach, describe, expect, it } from "vitest";
import { useProjectTabsStore, PROJECT_TAB_PREFIX } from "./store/project-tabs";
import {
  DEFAULT_OVERVIEW_ORDER,
  readProjectOverview,
  saveProjectOverview,
} from "./project-overview-store";

const A = "/Users/someone/Coding/one";
const B = "/Users/someone/Coding/two";

describe("project tabs", () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectTabsStore.setState({ tabs: [], activePath: null });
  });

  it("opens a project, focuses it again instead of duplicating", () => {
    const store = useProjectTabsStore.getState();
    store.openProject(A);
    store.openProject(B);
    store.openProject(A);
    expect(useProjectTabsStore.getState().tabs).toEqual([A, B]);
    expect(useProjectTabsStore.getState().activePath).toBe(A);
  });

  it("hands the slot to the neighbour when the active tab closes", () => {
    const store = useProjectTabsStore.getState();
    store.openProject(A);
    store.openProject(B);
    store.activateProject(A);
    store.closeProject(A);
    expect(useProjectTabsStore.getState().tabs).toEqual([B]);
    expect(useProjectTabsStore.getState().activePath).toBe(B);
  });

  it("falls back to the last tab when the last one closes", () => {
    const store = useProjectTabsStore.getState();
    store.openProject(A);
    store.openProject(B);
    store.closeProject(B);
    expect(useProjectTabsStore.getState().activePath).toBe(A);
    store.closeProject(A);
    expect(useProjectTabsStore.getState().activePath).toBeNull();
  });

  it("keeps a background tab from stealing focus on open", () => {
    const store = useProjectTabsStore.getState();
    store.openProject(A);
    store.openProject(B);
    // Re-opening a tab that is already in the strip focuses it…
    store.openProject(A);
    expect(useProjectTabsStore.getState().activePath).toBe(A);
    // …while the strip order stays as it was.
    expect(useProjectTabsStore.getState().tabs).toEqual([A, B]);
  });

  it("reorders tabs and keeps the active one", () => {
    const store = useProjectTabsStore.getState();
    store.openProject(A);
    store.openProject(B);
    store.moveProject(B, 0);
    expect(useProjectTabsStore.getState().tabs).toEqual([B, A]);
    expect(useProjectTabsStore.getState().activePath).toBe(B);
  });

  it("forgets a workspace that left the sidebar", () => {
    const store = useProjectTabsStore.getState();
    store.openProject(A);
    store.forget(A);
    expect(useProjectTabsStore.getState().tabs).toEqual([]);
    expect(useProjectTabsStore.getState().activePath).toBeNull();
  });

  it("writes tab order and the active project to storage", () => {
    const store = useProjectTabsStore.getState();
    store.openProject(A);
    store.openProject(B);
    const raw = localStorage.getItem("ccgui-next.projectTabs:v1");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual({ tabs: [A, B], active: B });
  });

  it("keys tabs with a prefix the strip can route on", () => {
    expect(PROJECT_TAB_PREFIX + A).toBe("project:/Users/someone/Coding/one");
  });
});

describe("project overview layout", () => {
  beforeEach(() => localStorage.clear());

  it("starts from the default order with nothing folded", () => {
    expect(readProjectOverview(A)).toEqual({ order: [...DEFAULT_OVERVIEW_ORDER], folded: {} });
  });

  it("round-trips a custom order and folded blocks", () => {
    saveProjectOverview(A, { order: ["work", "rules"], folded: { rules: true } });
    const layout = readProjectOverview(A);
    expect(layout.order.slice(0, 2)).toEqual(["work", "rules"]);
    expect(layout.folded).toEqual({ rules: true });
  });

  it("keeps each project's layout to itself", () => {
    saveProjectOverview(A, { order: ["work"], folded: {} });
    expect(readProjectOverview(B).order).toEqual([...DEFAULT_OVERVIEW_ORDER]);
  });

  it("drops unknown block ids from a stored layout", () => {
    localStorage.setItem(
      "ccgui-next.projectOverview:v1:" + A,
      JSON.stringify({ order: ["work", "gone"], folded: { gone: true, rules: true } }),
    );
    const layout = readProjectOverview(A);
    expect(layout.order).toEqual(["work"]);
    expect(layout.folded).toEqual({ rules: true });
  });

  it("survives a corrupt stored layout", () => {
    localStorage.setItem("ccgui-next.projectOverview:v1:" + A, "{not json");
    expect(readProjectOverview(A).order).toEqual([...DEFAULT_OVERVIEW_ORDER]);
  });
});
