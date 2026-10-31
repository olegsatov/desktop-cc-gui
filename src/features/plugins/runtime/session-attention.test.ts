import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStore } from "@/features/chat/store/types";

let storeListener: ((state: ChatStore) => void) | null = null;
vi.mock("@/features/chat/store", () => ({
  useChatStore: {
    subscribe: (cb: (state: ChatStore) => void) => {
      storeListener = cb;
      return () => {};
    },
  },
}));

import { pluginBus } from "./events";
import {
  SESSION_ATTENTION_TOPIC,
  bridgeSessionAttention,
  resetSessionAttentionForTests,
} from "./session-attention";

function storeState(patch: Partial<ChatStore> = {}): ChatStore {
  return { waitingByKey: {}, openTabs: [], sessions: [], ...patch } as ChatStore;
}

const TABS = [
  { engine: "pi", sessionId: "s1", workspacePath: "/repo/one" },
  { engine: "claude", sessionId: "s2", workspacePath: "/repo/two" },
] as unknown as ChatStore["openTabs"];

describe("session attention bridge", () => {
  beforeEach(() => {
    resetSessionAttentionForTests();
    storeListener = null;
  });

  async function bind(): Promise<(state: ChatStore) => void> {
    bridgeSessionAttention();
    // 模块是异步 import 进来的：等它真的订阅上。
    await vi.waitFor(() => {
      if (!storeListener) throw new Error("bridge did not subscribe to the chat store");
    });
    return storeListener as (state: ChatStore) => void;
  }

  it("emits once per flip, with the workspace the tabs know", async () => {
    const seen: unknown[] = [];
    const off = pluginBus.on(SESSION_ATTENTION_TOPIC, (payload) => seen.push(payload));
    const feed = await bind();

    // 停下等用户：发一次。
    feed(storeState({ openTabs: TABS, waitingByKey: { "pi/s1": true } }));
    expect(seen).toEqual([
      { key: "pi/s1", engine: "pi", sessionId: "s1", workspacePath: "/repo/one", waiting: true },
    ]);

    // 还是停着（别的会话有更新）：不重复。
    feed(storeState({ openTabs: TABS, waitingByKey: { "pi/s1": true } }));
    expect(seen).toHaveLength(1);

    // 用户答了：翻转回 false 也要说一声。
    feed(storeState({ openTabs: TABS }));
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatchObject({ key: "pi/s1", waiting: false });

    // 两个会话各自停下：两条。
    feed(
      storeState({
        openTabs: TABS,
        waitingByKey: { "pi/s1": true, "claude/s2": true },
      }),
    );
    expect(seen.slice(2)).toEqual([
      { key: "pi/s1", engine: "pi", sessionId: "s1", workspacePath: "/repo/one", waiting: true },
      { key: "claude/s2", engine: "claude", sessionId: "s2", workspacePath: "/repo/two", waiting: true },
    ]);
    off();
  });

  it("falls back to the session table and to the pending-tab key", async () => {
    const seen: unknown[] = [];
    const off = pluginBus.on(SESSION_ATTENTION_TOPIC, (payload) => seen.push(payload));
    const feed = await bind();

    // 页签里没有这个会话（用户没打开它，但时间线里出现了提问卡）：
    // 工作区从会话表里拿。
    feed(
      storeState({
        sessions: [{ engine: "pi", sessionId: "s9", workspacePath: "/repo/nine" }] as never,
        waitingByKey: { "pi/s9": true },
      }),
    );
    expect(seen).toEqual([
      { key: "pi/s9", engine: "pi", sessionId: "s9", workspacePath: "/repo/nine", waiting: true },
    ]);

    // 还没发出编号的待发会话：工作区就在 key 里（s9 还停着，不重复说）。
    feed(storeState({ waitingByKey: { "pi/s9": true, "new:pi:/repo/fresh": true } }));
    expect(seen[1]).toEqual({
      key: "new:pi:/repo/fresh",
      engine: "pi",
      sessionId: null,
      workspacePath: "/repo/fresh",
      waiting: true,
    });

    // 认不出来 key 的（形状不认识）：不上总线。
    feed(storeState({ waitingByKey: { "pi/s9": true, "new:pi:/repo/fresh": true, broken: true } }));
    expect(seen).toHaveLength(2);
    off();
  });
});
