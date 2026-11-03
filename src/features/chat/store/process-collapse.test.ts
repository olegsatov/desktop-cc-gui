/**
 * 工作区级的「过程折叠」开关：思考与工具调用默认折叠（缺省即折叠，只记例外），
 * 键是工作区路径——同一个仓库看的时候想安静，别人想看清过程，一台机器上两种
 * 都需要。存储坏了只当没有例外，不能让面板崩掉。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStore } from "./types";
import { createPreferenceActions } from "./preferences";
import {
  PROCESS_EXPANDED_WORKSPACES_KEY,
  readProcessExpandedWorkspaces,
  writeProcessExpandedWorkspaces,
} from "./persistence";

vi.mock("@/lib/ipc", () => ({ ipc: {} }));

/** Store slice the fold action touches; other preference actions keep the
 *  defaults they need, so the harness stays a plain object. */
function harness() {
  let state = {
    processExpandedByWorkspace: {} as Record<string, true>,
    thinkingAutoCollapse: true,
    threadLimit: 10,
    sendShortcut: "enter",
    wideLayout: false,
    active: null,
  } as unknown as ChatStore;
  const set = (patch: Partial<ChatStore>) => {
    state = { ...state, ...patch };
  };
  const actions = createPreferenceActions({
    set: set as never,
    get: (() => state) as never,
    stampActiveTab: () => {},
  });
  return { actions, state: () => state };
}

beforeEach(() => {
  localStorage.clear();
});

describe("process fold per workspace", () => {
  it("keeps the folded default and stores only the exceptions", () => {
    const h = harness();
    expect(h.state().processExpandedByWorkspace).toEqual({});
    expect(readProcessExpandedWorkspaces()).toEqual({});

    h.actions.toggleProcessCollapse("/ws/one");
    expect(h.state().processExpandedByWorkspace).toEqual({ "/ws/one": true });
    expect(readProcessExpandedWorkspaces()).toEqual({ "/ws/one": true });

    // A second workspace does not disturb the first one's choice.
    h.actions.toggleProcessCollapse("/ws/two");
    expect(readProcessExpandedWorkspaces()).toEqual({ "/ws/one": true, "/ws/two": true });

    // Toggling back folds that workspace again and drops it from storage.
    h.actions.toggleProcessCollapse("/ws/one");
    expect(h.state().processExpandedByWorkspace).toEqual({ "/ws/two": true });
    expect(localStorage.getItem(PROCESS_EXPANDED_WORKSPACES_KEY)).toBe(
      JSON.stringify(["/ws/two"]),
    );
  });

  it("ignores an empty workspace path", () => {
    const h = harness();
    h.actions.toggleProcessCollapse("");
    expect(h.state().processExpandedByWorkspace).toEqual({});
    expect(localStorage.getItem(PROCESS_EXPANDED_WORKSPACES_KEY)).toBeNull();
  });

  it("falls back to the folded default on broken stored data", () => {
    localStorage.setItem(PROCESS_EXPANDED_WORKSPACES_KEY, "{not json");
    expect(readProcessExpandedWorkspaces()).toEqual({});

    localStorage.setItem(
      PROCESS_EXPANDED_WORKSPACES_KEY,
      JSON.stringify(["", "/ws/one", 7, null]),
    );
    expect(readProcessExpandedWorkspaces()).toEqual({ "/ws/one": true });

    writeProcessExpandedWorkspaces({});
    expect(localStorage.getItem(PROCESS_EXPANDED_WORKSPACES_KEY)).toBe("[]");
    expect(readProcessExpandedWorkspaces()).toEqual({});
  });
});
