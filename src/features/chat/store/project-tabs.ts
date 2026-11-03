import { create } from "zustand";
import { readStoredJson, writeStored } from "@/lib/storage";

/**
 * Project tabs: the project overview that opens in the center area when the
 * user clicks the *name* of a workspace row in the left sidebar.
 *
 * A plain sidebar click used to only expand the row's session list; opening
 * the overview instead is ours (the upstream app has no per-project view).
 * Each open project gets a tab in the center tab strip, so returning to a
 * project you looked at before costs one click and a running session is
 * never displaced: the strip keeps them side by side.
 *
 * Persisted in the localStorage slot beside `openTabs` — a project tab is
 * navigation, not session state, so it survives a restart the same way.
 */

/** Tab strip key prefix; use-chat-tabs routes select/close by it. */
export const PROJECT_TAB_PREFIX = "project:";

const PROJECT_TABS_KEY = "ccgui-next.projectTabs:v1";

interface ProjectTabsState {
  /** Open project paths, in tab order. */
  tabs: string[];
  /** Project overview in view; null = another kind of tab is active. */
  activePath: string | null;

  /** Open (or focus) a project and show it. */
  openProject: (path: string) => void;
  closeProject: (path: string) => void;
  /** Show a project tab (the caller handles mutual exclusion with the other
   *  center surfaces). */
  activateProject: (path: string) => void;
  /** Clear the active project tab when another tab kind takes the center. */
  deactivate: () => void;
  moveProject: (path: string, toIndex: number) => void;
  /** Forget a workspace that was removed from the sidebar. */
  forget: (path: string) => void;
}

interface StoredProjectTabs {
  tabs: string[];
  active: string | null;
}

function restore(): StoredProjectTabs {
  const parsed = readStoredJson<StoredProjectTabs>(PROJECT_TABS_KEY, (value) => {
    if (typeof value !== "object" || value === null) return null;
    const record = value as { tabs?: unknown; active?: unknown };
    const tabs = Array.isArray(record.tabs)
      ? record.tabs.filter((path): path is string => typeof path === "string")
      : [];
    const active =
      typeof record.active === "string" && tabs.includes(record.active)
        ? record.active
        : null;
    return { tabs, active };
  });
  return parsed ?? { tabs: [], active: null };
}

const restored = restore();

export const useProjectTabsStore = create<ProjectTabsState>()((set, get) => {
  const persist = (tabs: string[], active: string | null) => {
    writeStored(PROJECT_TABS_KEY, JSON.stringify({ tabs, active }));
  };

  return {
    tabs: restored.tabs,
    activePath: restored.active,

    openProject: (path) => {
      const s = get();
      if (!s.tabs.includes(path)) {
        const tabs = [...s.tabs, path];
        set({ tabs, activePath: path });
        persist(tabs, path);
        return;
      }
      if (s.activePath !== path) {
        set({ activePath: path });
        persist(s.tabs, path);
      }
    },

    closeProject: (path) => {
      const s = get();
      const index = s.tabs.indexOf(path);
      if (index < 0) return;
      const tabs = s.tabs.filter((item) => item !== path);
      // Neighbour fallback mirrors the session and browser strips: the tab
      // that took the slot, else the last one.
      const activePath =
        s.activePath === path ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : s.activePath;
      set({ tabs, activePath });
      persist(tabs, activePath);
    },

    activateProject: (path) => {
      if (!get().tabs.includes(path)) return;
      if (get().activePath === path) return;
      set({ activePath: path });
      persist(get().tabs, path);
    },

    deactivate: () => {
      if (get().activePath === null) return;
      set({ activePath: null });
      persist(get().tabs, null);
    },

    moveProject: (path, toIndex) => {
      const s = get();
      const from = s.tabs.indexOf(path);
      if (from < 0) return;
      const tabs = [...s.tabs];
      const [tab] = tabs.splice(from, 1);
      tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab);
      set({ tabs });
      persist(tabs, s.activePath);
    },

    forget: (path) => {
      const s = get();
      if (!s.tabs.includes(path)) return;
      get().closeProject(path);
    },
  };
});
