import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStore } from "@/features/chat/store/types";

/** Shared across `vi.resetModules()`: the factories re-run for a fresh module
 *  registry but keep pointing at these objects. */
const h = vi.hoisted(() => ({
  win: {
    label: "main",
    setBadgeCount: vi.fn(async () => {}),
  },
  listeners: [] as Array<(state: ChatStore) => void>,
  state: {} as ChatStore,
}));

vi.mock("./platform", () => ({ isWeb: false }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => h.win),
}));

vi.mock("@/features/chat/store", () => ({
  useChatStore: {
    getState: () => h.state,
    subscribe: (listener: (state: ChatStore) => void) => {
      h.listeners.push(listener);
      return () => {};
    },
  },
}));

import {
  attentionCount,
  initDockBadge,
  pushDockBadge,
  resetDockBadgeForTests,
  updateDockBadge,
} from "./dock-badge";

function storeState(patch: Partial<ChatStore> = {}): ChatStore {
  return { waitingByKey: {}, streamingByKey: {}, unseen: {}, ...patch } as unknown as ChatStore;
}

describe("dock badge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.listeners.length = 0;
    h.win.label = "main";
    h.state = storeState();
    resetDockBadgeForTests();
  });

  it("counts the dots the sidebar draws: waiting plus unseen, running never", () => {
    expect(attentionCount(storeState())).toBe(0);

    // A red dot and a green dot: two sessions need the user.
    expect(attentionCount(storeState({ waitingByKey: { "pi/s1": true }, unseen: { "pi/s2": true } }))).toBe(2);

    // A running turn is not a session waiting for the user.
    expect(attentionCount(storeState({ streamingByKey: { "pi/s3": true } }))).toBe(0);

    // Running with a finished result behind it is still nothing to answer.
    expect(
      attentionCount(storeState({ streamingByKey: { "pi/s4": true }, unseen: { "pi/s4": true } })),
    ).toBe(0);

    // Waiting wins over running, and the session is counted once.
    expect(
      attentionCount(
        storeState({ waitingByKey: { "pi/s5": true }, streamingByKey: { "pi/s5": true }, unseen: { "pi/s5": true } }),
      ),
    ).toBe(1);
  });

  it("pushes the number, stays quiet on an unchanged one, removes the badge at zero", () => {
    pushDockBadge(3);
    expect(h.win.setBadgeCount).toHaveBeenCalledWith(3);

    // Every streamed token writes the store; the number is what matters.
    pushDockBadge(3);
    pushDockBadge(3);
    expect(h.win.setBadgeCount).toHaveBeenCalledTimes(1);

    pushDockBadge(0);
    // No argument: the native side takes Option<i64>, and a literal zero would
    // be drawn as a "0" badge instead of clearing the icon.
    expect(h.win.setBadgeCount).toHaveBeenLastCalledWith();
    expect(h.win.setBadgeCount).toHaveBeenCalledTimes(2);
  });

  it("badges the store on every change and starts from what is already there", () => {
    h.state = storeState({ waitingByKey: { "pi/s1": true } });
    initDockBadge();

    expect(h.win.setBadgeCount).toHaveBeenCalledWith(1);

    // One more session finished unseen: the count follows the store.
    updateDockBadge(storeState({ waitingByKey: { "pi/s1": true }, unseen: { "pi/s2": true } }));
    expect(h.win.setBadgeCount).toHaveBeenLastCalledWith(2);

    // The user opened the session: the dot went out, so did the badge.
    updateDockBadge(storeState({ waitingByKey: { "pi/s1": true } }));
    expect(h.win.setBadgeCount).toHaveBeenLastCalledWith(1);

    // Answered: nothing needs the user.
    updateDockBadge(storeState());
    expect(h.win.setBadgeCount).toHaveBeenLastCalledWith();
  });

  it("subscribes once and lets the store drive the number", () => {
    initDockBadge();
    initDockBadge();
    expect(h.listeners).toHaveLength(1);

    h.listeners[0](storeState({ unseen: { "pi/s9": true } }));
    expect(h.win.setBadgeCount).toHaveBeenLastCalledWith(1);
  });

  it("never touches the icon from the pet overlay window", () => {
    h.win.label = "pet-overlay";
    h.state = storeState({ waitingByKey: { "pi/s1": true } });
    initDockBadge();
    updateDockBadge(storeState({ waitingByKey: { "pi/s1": true } }));
    expect(h.win.setBadgeCount).not.toHaveBeenCalled();
  });

  it("keeps the app alive when the native call fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.win.setBadgeCount.mockRejectedValueOnce(new Error("not allowed"));
    pushDockBadge(2);
    // The rejection is handled, not thrown at the store subscriber.
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();

    // A failed push is retried on the next change of the number.
    pushDockBadge(2);
    expect(h.win.setBadgeCount).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
