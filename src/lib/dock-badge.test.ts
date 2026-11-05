import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStore } from "@/features/chat/store/types";

/** Shared across `vi.resetModules()`: the factories re-run for a fresh module
 *  registry but keep pointing at these objects. */
const h = vi.hoisted(() => ({
  win: {
    label: "main",
    setBadgeCount: vi.fn(async () => {}),
    isFocused: vi.fn(async () => true),
    onFocusChanged: vi.fn(),
  },
  focusHandlers: [] as Array<(event: { payload: boolean }) => void>,
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

/** Let the focus setup (async IPC) settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The app window loses or regains the focus. */
function focus(next: boolean) {
  for (const handler of h.focusHandlers) handler({ payload: next });
}

describe("dock badge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.listeners.length = 0;
    h.focusHandlers.length = 0;
    h.win.label = "main";
    h.win.isFocused.mockResolvedValue(true);
    h.win.onFocusChanged.mockImplementation(async (handler: (event: { payload: boolean }) => void) => {
      h.focusHandlers.push(handler);
      return () => {};
    });
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

  it("counts a turn that ended while the user was in another program", async () => {
    h.state = storeState({ streamingByKey: { "pi/s1": true } });
    initDockBadge();
    await flush();
    expect(h.win.setBadgeCount).toHaveBeenLastCalledWith();

    // The user switches to another application: the session sits in the open
    // tab, so the app itself flags nothing at all.
    focus(false);

    // …and the answer arrives. That is what the badge is for.
    updateDockBadge(storeState());
    expect(h.win.setBadgeCount).toHaveBeenLastCalledWith(1);

    // Back at the app: seen, the number goes away.
    focus(true);
    expect(h.win.setBadgeCount).toHaveBeenLastCalledWith();
  });

  it("ignores a turn that ended in the open window", async () => {
    h.state = storeState({ streamingByKey: { "pi/s1": true } });
    initDockBadge();
    await flush();
    // Only the startup "no badge" push has happened so far.
    h.win.setBadgeCount.mockClear();

    updateDockBadge(storeState());
    expect(h.win.setBadgeCount).not.toHaveBeenCalled();
  });

  it("counts a session that finished while the app was in the background at start", async () => {
    // Launched behind another window: the listener alone would never say so.
    h.win.isFocused.mockResolvedValue(false);
    h.state = storeState({ streamingByKey: { "pi/s7": true } });
    initDockBadge();
    await flush();

    updateDockBadge(storeState());
    expect(h.win.setBadgeCount).toHaveBeenLastCalledWith(1);
  });

  it("never counts the same session twice, whatever mix of states it has", async () => {
    h.state = storeState({ streamingByKey: { "pi/s1": true } });
    initDockBadge();
    await flush();
    focus(false);
    updateDockBadge(storeState({ unseen: { "pi/s1": true } }));

    expect(h.win.setBadgeCount).toHaveBeenLastCalledWith(1);
  });

  it("keeps working when the window cannot report its focus", async () => {
    h.win.onFocusChanged.mockRejectedValueOnce(new Error("no permission"));
    h.win.isFocused.mockRejectedValueOnce(new Error("no permission"));
    h.state = storeState({ unseen: { "pi/s1": true } });
    initDockBadge();
    await flush();
    expect(h.win.setBadgeCount).toHaveBeenLastCalledWith(1);
  });
});
