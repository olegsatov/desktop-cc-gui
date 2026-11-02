import { beforeEach, describe, expect, it } from "vitest";
import type { ChatStore } from "@/features/chat/store/types";
import { SESSION_STATE_TOPIC, pluginBus, resetPluginBusForTests } from "./events";
import {
  feedSessionStateForTests,
  resetSessionStateForTests,
  type SessionStatePayload,
} from "./session-state";

function storeState(patch: Partial<ChatStore> = {}): ChatStore {
  return { waitingByKey: {}, streamingByKey: {}, unseen: {}, openTabs: [], sessions: [], ...patch } as ChatStore;
}

const TABS = [
  { engine: "pi", sessionId: "s1", workspacePath: "/repo/one" },
] as unknown as ChatStore["openTabs"];

describe("session state bridge", () => {
  beforeEach(() => {
    resetPluginBusForTests();
    resetSessionStateForTests();
  });

  it("reports the whole picture on every change, dots like the sidebar", () => {
    const seen: unknown[] = [];
    pluginBus.on(SESSION_STATE_TOPIC, (payload) => seen.push(payload));

    // 会话跑起来了：一条 running。
    feedSessionStateForTests(storeState({ openTabs: TABS, streamingByKey: { "pi/s1": true } }));
    expect(seen).toEqual([
      { sessions: [{ key: "pi/s1", engine: "pi", sessionId: "s1", workspacePath: "/repo/one", state: "running" }] },
    ]);

    // 每一条流式增量都会走一遍：画面没变就不重复发。
    feedSessionStateForTests(storeState({ openTabs: TABS, streamingByKey: { "pi/s1": true } }));
    expect(seen).toHaveLength(1);

    // 停在用户身上：红点优先于「在跑」。
    feedSessionStateForTests(
      storeState({ openTabs: TABS, streamingByKey: { "pi/s1": true }, waitingByKey: { "pi/s1": true } }),
    );
    expect(seen[1]).toEqual({
      sessions: [{ key: "pi/s1", engine: "pi", sessionId: "s1", workspacePath: "/repo/one", state: "waiting" }],
    });

    // 用户答了、轮次结束、结果没看过：绿色。
    feedSessionStateForTests(storeState({ openTabs: TABS, unseen: { "pi/s1": true } }));
    expect(seen[2]).toEqual({
      sessions: [{ key: "pi/s1", engine: "pi", sessionId: "s1", workspacePath: "/repo/one", state: "unseen" }],
    });

    // 打开看过了：画面空了，也要说一声，插件才会把点熄掉。
    feedSessionStateForTests(storeState({ openTabs: TABS }));
    expect(seen[3]).toEqual({ sessions: [] });
    expect(seen).toHaveLength(4);
  });

  it("takes the workspace from the session table or the pending-tab key", () => {
    const seen: SessionStatePayload[] = [];
    pluginBus.on(SESSION_STATE_TOPIC, (payload) => seen.push(payload as SessionStatePayload));

    // 用户没打开这个会话（页签里没有）：工作区从会话表里拿。
    feedSessionStateForTests(
      storeState({
        sessions: [{ engine: "pi", sessionId: "s9", workspacePath: "/repo/nine" }] as never,
        streamingByKey: { "pi/s9": true },
      }),
    );
    expect(seen[0].sessions).toEqual([
      { key: "pi/s9", engine: "pi", sessionId: "s9", workspacePath: "/repo/nine", state: "running" },
    ]);

    // 还没发出编号的待发会话：工作区就在 key 里。
    feedSessionStateForTests(
      storeState({
        sessions: [{ engine: "pi", sessionId: "s9", workspacePath: "/repo/nine" }] as never,
        streamingByKey: { "pi/s9": true },
        unseen: { "new:pi:/repo/fresh": true },
      }),
    );
    expect(seen[1].sessions).toEqual([
      { key: "new:pi:/repo/fresh", engine: "pi", sessionId: null, workspacePath: "/repo/fresh", state: "unseen" },
      { key: "pi/s9", engine: "pi", sessionId: "s9", workspacePath: "/repo/nine", state: "running" },
    ]);

    // 认不出来 key 的（形状不认识）：不上总线。
    feedSessionStateForTests(
      storeState({
        streamingByKey: { "pi/s9": true, broken: true },
        sessions: [{ engine: "pi", sessionId: "s9", workspacePath: "/repo/nine" }] as never,
      }),
    );
    expect(seen[2].sessions).toHaveLength(1);
    expect(seen[2].sessions[0].key).toBe("pi/s9");
  });

  it("replays the current picture to a plugin that subscribes late", () => {
    feedSessionStateForTests(storeState({ openTabs: TABS, streamingByKey: { "pi/s1": true } }));

    // 热重载/晚加载的插件：话题是保留的，订阅时立刻拿到当前画面。
    const seen: unknown[] = [];
    pluginBus.on(SESSION_STATE_TOPIC, (payload) => seen.push(payload));
    expect(seen).toEqual([
      { sessions: [{ key: "pi/s1", engine: "pi", sessionId: "s1", workspacePath: "/repo/one", state: "running" }] },
    ]);
  });
});
