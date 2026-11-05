import { getCurrentWindow } from "@tauri-apps/api/window";
import { useChatStore } from "@/features/chat/store";
import type { ChatStore } from "@/features/chat/store/types";
import { isWeb } from "./platform";

/**
 * Dock badge (our patch): one number on the app icon — how many sessions are
 * waiting for the user.
 *
 * macOS has a single spot for a badge, not two, so the number is the sum of
 * the two states the sidebar already draws as dots: a session stopped on the
 * user (red dot) and a finished session whose result was never looked at
 * (green dot). Same priority as the sidebar dot in repo-tree's
 * `ThreadStatusDot` — waiting wins, a running turn is not a session that
 * needs the user, unseen comes last — so the badge can never contradict the
 * dots on screen.
 *
 * The badge disappears by itself: opening a session clears its unseen mark,
 * answering clears the waiting one.
 */

/** The window that owns the chat sessions (src-tauri/src/lib.rs). The pet
 *  overlay loads the same page and has no session list of its own. */
const MAIN_WINDOW_LABEL = "main";

/** Sessions the user owes something to, counted the way the dots count. */
export function attentionCount(state: ChatStore): number {
  const waiting = state.waitingByKey ?? {};
  const streaming = state.streamingByKey ?? {};
  const unseen = state.unseen ?? {};
  // Both maps can hold the same session (asked a question, turn ended): the
  // union counts it once.
  const keys = new Set([...Object.keys(waiting), ...Object.keys(unseen)]);
  let count = 0;
  for (const key of keys) {
    if (waiting[key]) {
      count += 1;
      continue;
    }
    if (streaming[key]) continue;
    if (unseen[key]) count += 1;
  }
  return count;
}

/** Last number pushed: a state write that does not move the count stays quiet. */
let lastCount: number | null = null;

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

/** Badge one store snapshot (exported for tests and for a late first paint). */
export function updateDockBadge(state: ChatStore): void {
  pushDockBadge(attentionCount(state));
}

let installed = false;

/** Called once from bootstrap; a no-op off the main window and in the web build. */
export function initDockBadge(): void {
  if (installed || isWeb) return;
  // The overlay window runs the same bootstrap: only the main window owns the
  // session state, so only it may touch the icon (checked again in the push).
  if (currentWindowLabel() !== MAIN_WINDOW_LABEL) return;
  installed = true;
  updateDockBadge(useChatStore.getState());
  useChatStore.subscribe((state) => updateDockBadge(state));
}

/** Unit tests: forget the subscription and the last pushed number. */
export function resetDockBadgeForTests(): void {
  installed = false;
  lastCount = null;
}

function currentWindowLabel(): string | null {
  try {
    return getCurrentWindow().label;
  } catch {
    return null;
  }
}
