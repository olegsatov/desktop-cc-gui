import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipc, type SessionMeta } from "@/lib/ipc";
import { useChatStore } from "./store";
import { OPEN_TABS_KEY, type ActiveSession } from "./store/persistence";
import {
  SESSION_TAB_LIMIT,
  setSplitSessionKeysProvider,
  tabKey,
  tabsOverLimit,
} from "./store/tab-limit";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    loadSessionPage: vi.fn(async () => ({
      messages: [],
      nextBefore: null,
      subagentHistory: [],
    })),
    loadRemoteSessionPage: vi.fn(async () => ({
      messages: [],
      nextBefore: null,
      subagentHistory: [],
    })),
    listWorkspaces: vi.fn(async () => []),
    listSessions: vi.fn(async () => []),
    listEngines: vi.fn(async () => []),
    listArchivedSessions: vi.fn(async () => []),
    listPlanReviews: vi.fn(async () => []),
    getAppSettings: vi.fn(async () => ({})),
    getCliConfig: vi.fn(async () => null),
    rescanSessions: vi.fn(async () => {}),
    rememberSessionModel: vi.fn(async () => {}),
    rememberSessionEffort: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
  listenComputerUseEscape: vi.fn(async () => () => {}),
}));

const WS = "/tmp/ws";

function session(sessionId: string, workspacePath = WS): ActiveSession {
  return { engine: "claude", sessionId, workspacePath };
}

function resetStore() {
  localStorage.clear();
  useChatStore.setState({
    initialized: false,
    openTabs: [],
    active: null,
    activeEngine: "claude",
    models: {},
    providers: {},
    efforts: {},
    archivedSessionKeys: {},
    bySession: {},
    streamingByKey: {},
    retryingByKey: {},
    waitingByKey: {},
    unseen: {},
    drafts: {},
    restoredSessionKeys: {},
    createdSessionKeys: {},
    sessionContributions: {},
    pendingRuntimeSwitch: null,
  });
}

describe("tabsOverLimit", () => {
  beforeEach(() => setSplitSessionKeysProvider(() => new Set()));

  const empty = { active: null, streamingByKey: {}, waitingByKey: {} };

  it("leaves a list within the cap alone", () => {
    const tabs = Array.from({ length: SESSION_TAB_LIMIT }, (_, i) =>
      session(`s-${i}`),
    );
    expect(tabsOverLimit(tabs, empty)).toBeNull();
  });

  it("drops the oldest tabs once the cap is exceeded", () => {
    const tabs = Array.from({ length: SESSION_TAB_LIMIT + 3 }, (_, i) =>
      session(`s-${i}`),
    );
    const kept = tabsOverLimit(tabs, empty);
    expect(kept?.map((t) => t.sessionId)).toEqual(
      tabs.slice(3).map((t) => t.sessionId),
    );
  });

  it("never closes the active tab, a streaming one, one stopped on the user, a draft or a split pane", () => {
    const tabs = Array.from({ length: SESSION_TAB_LIMIT + 5 }, (_, i) =>
      session(`s-${i}`),
    );
    tabs[0] = { ...tabs[0] }; // s-0: active
    const draft: ActiveSession = { engine: "claude", sessionId: null, workspacePath: WS };
    tabs.push(draft);
    setSplitSessionKeysProvider(() => new Set([tabKey(session("s-3"))]));

    const kept = tabsOverLimit(tabs, {
      active: session("s-0"),
      streamingByKey: { [tabKey(session("s-1"))]: true },
      waitingByKey: { [tabKey(session("s-2"))]: true },
    });
    const keptIds = kept?.map((t) => t.sessionId);
    // s-0..s-3 and the draft survive; s-4 and s-5 are the oldest cold ones.
    expect(keptIds).toContain("s-0");
    expect(keptIds).toContain("s-1");
    expect(keptIds).toContain("s-2");
    expect(keptIds).toContain("s-3");
    expect(keptIds).toContain(null);
    expect(keptIds).not.toContain("s-4");
    expect(keptIds).not.toContain("s-5");
  });

  it("keeps a tab a plugin locked", () => {
    const tabs = Array.from({ length: SESSION_TAB_LIMIT + 2 }, (_, i) =>
      session(`s-${i}`),
    );
    const kept = tabsOverLimit(tabs, {
      ...empty,
      closeBlocked: (tab) => tab.sessionId === "s-1",
    });
    const ids = kept?.map((t) => t.sessionId) ?? [];
    expect(ids).toHaveLength(SESSION_TAB_LIMIT);
    expect(ids).toContain("s-1");
    expect(ids).not.toContain("s-0");
    expect(ids).not.toContain("s-2");
  });

  it("closes nothing when every candidate is locked", () => {
    const tabs = Array.from({ length: SESSION_TAB_LIMIT + 2 }, (_, i) =>
      session(`s-${i}`),
    );
    expect(tabsOverLimit(tabs, { ...empty, closeBlocked: () => true })).toBeNull();
  });
});

describe("the strip stays bounded while sessions are opened", () => {
  beforeEach(resetStore);

  it("opening the session past the cap closes the oldest tab", async () => {
    const open = Array.from({ length: SESSION_TAB_LIMIT }, (_, i) =>
      session(`s-${i}`),
    );
    useChatStore.setState({ openTabs: open, active: open[open.length - 1] });

    await useChatStore.getState().selectSession("claude", "s-new", WS);

    const s = useChatStore.getState();
    expect(s.openTabs).toHaveLength(SESSION_TAB_LIMIT);
    expect(s.openTabs[0].sessionId).toBe("s-1");
    expect(s.openTabs[s.openTabs.length - 1].sessionId).toBe("s-new");
    expect(s.active?.sessionId).toBe("s-new");
    const persisted = JSON.parse(localStorage.getItem(OPEN_TABS_KEY) ?? "[]");
    expect(persisted).toHaveLength(SESSION_TAB_LIMIT);
  });

  it("leaves a streaming tab alone and closes the next cold one", async () => {
    const open = Array.from({ length: SESSION_TAB_LIMIT }, (_, i) =>
      session(`s-${i}`),
    );
    useChatStore.setState({
      openTabs: open,
      active: open[open.length - 1],
      streamingByKey: { [tabKey(open[0])]: true },
    });

    await useChatStore.getState().selectSession("claude", "s-new", WS);

    const ids = useChatStore.getState().openTabs.map((t) => t.sessionId);
    expect(ids).toHaveLength(SESSION_TAB_LIMIT);
    expect(ids).toContain("s-0");
    expect(ids).not.toContain("s-1");
  });

  it("trims a list an older build saved", async () => {
    const saved = Array.from({ length: SESSION_TAB_LIMIT + 5 }, (_, i) =>
      session(`s-${i}`),
    );
    localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(saved));
    vi.mocked(ipc.listWorkspaces).mockResolvedValueOnce([
      {
        id: "w-1",
        path: WS,
        name: "ws",
        lastOpenedAt: null,
        sortOrder: null,
        groupId: null,
      },
    ]);
    vi.mocked(ipc.listSessions).mockResolvedValueOnce(
      saved.map(
        (t, i): SessionMeta => ({
          engine: t.engine,
          sessionId: t.sessionId ?? "",
          workspacePath: WS,
          filePath: "",
          fileSize: 0,
          fileMtimeMs: 0,
          title: `s-${i}`,
          preview: "",
          createdAt: 1,
          updatedAt: 2,
          messageCount: 1,
          pinned: false,
          customTitle: null,
        }),
      ),
    );

    await useChatStore.getState().init();

    const s = useChatStore.getState();
    expect(s.openTabs).toHaveLength(SESSION_TAB_LIMIT);
    // The five oldest are gone; the newest one is still there.
    expect(s.openTabs[0].sessionId).toBe("s-5");
    expect(s.openTabs[s.openTabs.length - 1].sessionId).toBe(
      `s-${SESSION_TAB_LIMIT + 4}`,
    );
  });
});
