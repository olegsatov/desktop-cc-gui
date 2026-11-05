import { getCurrentWindow } from "@tauri-apps/api/window";
import { useChatStore } from "@/features/chat/store";
import type { ChatStore } from "@/features/chat/store/types";
import { isWeb } from "./platform";

/**
 * Dock badge (our patch): one number on the app icon in the Dock — how many
 * sessions need the user. macOS has a single spot for it, so the number is a
 * sum of three things, two of which the sidebar already draws:
 *
 *  - a session stopped on the user: question, plan approval, folder grant
 *    (red dot);
 *  - a finished session whose result was never looked at (green dot) — the app
 *    only flags those that are not the open tab;
 *  - a session whose turn ended while the app was not focused. The app never
 *    flags this at all (the open tab counts as seen by definition), yet it is
 *    the everyday case: writing in another program while a session answers in
 *    the window behind. Checked 05.11.2026 — without it the badge stayed empty
 *    exactly there, and only appeared when switching to another session.
 *
 * A session counts once, and the same priority as the sidebar dot in
 * repo-tree's `ThreadStatusDot` applies (waiting beats running beats unseen),
 * so the badge can never contradict the dots on screen.
 *
 * The number goes away by itself: answering clears the red dot, opening a
 * session clears the green one, and returning to the app clears the third kind
 * — it means "you were away", not "you have not read it".
 */

/** The window that owns the chat sessions (src-tauri/src/lib.rs). The pet
 *  overlay loads the same page and has no session list of its own. */
const MAIN_WINDOW_LABEL = "main";

const NONE: ReadonlySet<string> = new Set();

/** Sessions that need the user, counted the way the dots count. */
export function attentionCount(state: ChatStore, away: ReadonlySet<string> = NONE): number {
  const waiting = state.waitingByKey ?? {};
  const streaming = state.streamingByKey ?? {};
  const unseen = state.unseen ?? {};
  // The three sources can name the same session (asked a question, turn ended
  // while away): the union counts it once.
  const keys = new Set([...Object.keys(waiting), ...Object.keys(unseen), ...away]);
  let count = 0;
  for (const key of keys) {
    if (waiting[key]) {
      count += 1;
      continue;
    }
    // A running turn is not a session waiting for the user — unless it is the
    // one that finished a moment ago, which is why `away` loses to running.
    if (streaming[key]) continue;
    if (unseen[key] || away.has(key)) count += 1;
  }
  return count;
}

/** Last number pushed: a state write that does not move the count stays quiet. */
let lastCount: number | null = null;
/** The latest store snapshot, so a focus change can be recounted without one. */
let latest: ChatStore | null = null;
/** Sessions whose turn was running at the last store write. */
const running = new Set<string>();
/** Sessions that finished a turn while the app was not focused. */
const away = new Set<string>();
/** Whether the app window holds the focus; the store outlives focus changes. */
let focused = true;
let installed = false;

/** Badge one store snapshot (the store subscription, focus changes, tests). */
export function updateDockBadge(state: ChatStore): void {
  latest = state;
  trackTurnEndings(state);
  pushDockBadge(attentionCount(state, away));
}

/** Push the number to the Dock; 0 removes the badge. */
export function pushDockBadge(count: number): void {
  if (count === lastCount) return;
  if (currentWindowLabel() !== MAIN_WINDOW_LABEL) return;
  lastCount = count;
  const win = getCurrentWindow();
  // 0 goes as "no value": the native side takes `Option<i64>`, and a literal
  // zero would be drawn on the icon as a "0" badge instead of removing it.
  const call = count > 0 ? win.setBadgeCount(count) : win.setBadgeCount();
  void call.catch((error) => {
    // Missing permission (core:window:allow-set-badge-count) or a platform
    // without a badge: decoration must never break the app, and the next
    // change of the number tries again.
    console.warn("[dock-badge] setBadgeCount failed", error);
    lastCount = null;
  });
}

/** Called once from bootstrap; a no-op off the main window and in the web build. */
export function initDockBadge(): void {
  if (installed || isWeb) return;
  // The overlay window runs the same bootstrap: only the main window owns the
  // session state, so only it may touch the icon (checked again in the push).
  if (currentWindowLabel() !== MAIN_WINDOW_LABEL) return;
  installed = true;
  updateDockBadge(useChatStore.getState());
  useChatStore.subscribe((state) => updateDockBadge(state));
  void trackFocus();
}

/** Unit tests: forget the subscription, the marks and the last pushed number. */
export function resetDockBadgeForTests(): void {
  installed = false;
  focused = true;
  lastCount = null;
  latest = null;
  running.clear();
  away.clear();
}

/**
 * A turn that ended while the app was not focused: the user did not see the
 * answer, even though the session sits in the open tab. A turn that ends while
 * the app is focused is left out on purpose — the window is right there.
 */
function trackTurnEndings(state: ChatStore): void {
  const streaming = state.streamingByKey ?? {};
  const next = new Set<string>();
  for (const key of Object.keys(streaming)) {
    if (streaming[key]) next.add(key);
  }
  if (!focused) {
    for (const key of running) {
      if (!next.has(key)) away.add(key);
    }
  }
  running.clear();
  for (const key of next) running.add(key);
}

function setFocused(next: boolean): void {
  if (next === focused) return;
  focused = next;
  // Back at the app: whatever finished in the meantime has been seen (the
  // sidebar dots of sessions the user never opened are untouched).
  if (next) away.clear();
  if (latest) pushDockBadge(attentionCount(latest, away));
}

async function trackFocus(): Promise<void> {
  const win = getCurrentWindow();
  try {
    // The app may well start behind another window, so ask once: the listener
    // only reports changes.
    setFocused(await win.isFocused());
  } catch {
    // No IPC (tests, web build): keep the optimistic default.
  }
  try {
    await win.onFocusChanged(({ payload }) => setFocused(payload));
  } catch {
    // Listening refused: the badge keeps the two dot kinds and nothing else.
  }
}

function currentWindowLabel(): string | null {
  try {
    return getCurrentWindow().label;
  } catch {
    return null;
  }
}
