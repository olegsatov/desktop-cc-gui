/**
 * Sessions a plugin started on the user's behalf (scheduled runs and the
 * like). They belong to the plugin's own list — its panel tab — not to the
 * user's sidebar: the sidebar shows only what the user opened themselves.
 *
 * The host knows every session it started through `sessions.startRun`, so
 * nothing has to be asked of the plugin; the keys are remembered across
 * restarts so yesterday's task runs do not reappear in the sidebar either.
 */

const STORAGE_KEY = "ccgui-next.pluginOwnedSessions:v1";

const listeners = new Set<() => void>();

function readStored(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

let owned: Set<string> = typeof localStorage === "undefined" ? new Set() : readStored();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...owned]));
  } catch {
    /* storage full or unavailable: the list still works for this run */
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Remember one session as plugin-owned; no-op when it is already known. */
export function markPluginOwnedSession(key: string): void {
  if (!key || owned.has(key)) return;
  owned = new Set(owned);
  owned.add(key);
  persist();
  notify();
}

/** Whether the sidebar should skip this session (`sessionKey()` string). */
export function isPluginOwnedSessionKey(key: string): boolean {
  return owned.has(key);
}

/** Subscribe for React: the sidebar re-renders when a run adds a session. */
export function subscribePluginOwnedSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPluginOwnedSessions(): ReadonlySet<string> {
  return owned;
}
