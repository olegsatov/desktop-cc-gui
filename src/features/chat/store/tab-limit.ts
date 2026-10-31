import { sessionKey, type ActiveSession } from "./persistence";

/**
 * Session-tab cap (local patch).
 *
 * Every session opened from the sidebar adds a tab, and closing one is a
 * manual move, so the strip only grows — 496 tabs in storage by 30.10.2026,
 * all of them restored on the next start. Above the cap the leftmost (oldest)
 * tabs are closed automatically.
 *
 * Only cold tabs are taken. Never closed: the tab in view, one that is
 * streaming, one stopped on the user (waitingByKey), a draft that still holds
 * unsent text, one standing in a split pane, and one a plugin has locked
 * (conversation mode). When what is left cannot get the list under the cap,
 * nothing more is closed — overshooting beats closing something the user is
 * working in.
 */

/** How many session tabs stay open. */
export const SESSION_TAB_LIMIT = 20;

/** Sessions standing in split panes. Their tabs must survive: the app drops
 *  a pane together with its tab (see reconcileLayout). The provider is
 *  installed by split/store.ts, which already imports this store — injecting
 *  it keeps the import direction one-way. */
let splitSessionKeys: (() => Set<string>) | null = null;

export function setSplitSessionKeysProvider(provider: () => Set<string>): void {
  splitSessionKeys = provider;
}

export interface TabLimitContext {
  active: ActiveSession | null;
  streamingByKey: Record<string, boolean>;
  waitingByKey: Record<string, boolean>;
  /** A plugin locked this tab (conversation mode) — closing it is refused. */
  closeBlocked?: (tab: ActiveSession) => boolean;
}

export function tabKey(tab: ActiveSession): string {
  return sessionKey(tab.engine, tab.sessionId, tab.workspacePath);
}

/**
 * The tabs to keep once the cap is exceeded, or null when the list is
 * already within it (callers keep the existing array identity then).
 */
export function tabsOverLimit(
  tabs: ActiveSession[],
  context: TabLimitContext,
): ActiveSession[] | null {
  if (tabs.length <= SESSION_TAB_LIMIT) return null;

  const keep = new Set<string>();
  if (context.active) keep.add(tabKey(context.active));
  for (const tab of tabs) {
    const key = tabKey(tab);
    // Drafts hold unsent text and back the sidebar's "new chat" rows.
    if (
      tab.sessionId === null ||
      context.streamingByKey[key] ||
      context.waitingByKey[key] ||
      context.closeBlocked?.(tab)
    ) {
      keep.add(key);
    }
  }
  for (const key of splitSessionKeys?.() ?? []) keep.add(key);

  const kept = [...tabs];
  let excess = kept.length - SESSION_TAB_LIMIT;
  for (let i = 0; i < kept.length && excess > 0; ) {
    if (keep.has(tabKey(kept[i]))) {
      i++;
      continue;
    }
    kept.splice(i, 1);
    excess--;
  }
  return kept.length === tabs.length ? null : kept;
}
