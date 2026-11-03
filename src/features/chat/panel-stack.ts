import { readStoredJson, writeStored } from "@/lib/storage";

/**
 * Right-panel columns: registry tabs may share one panel column through
 * PanelTabDef.stack (our patch — the host stacks them vertically with a
 * draggable divider instead of giving each tab a full-height pane). Here live
 * the pure rules of that layout: which tabs form a column, which pill the
 * header strip keeps, and the remembered pane sizes. The rendering and the
 * drag itself are in PanelStack.tsx / ChatSidePanel.tsx.
 */

/** Every pane keeps at least this much height: a drag can never hide one. */
export const PANEL_STACK_MIN_PANE_PX = 96;
/** Height of the divider between two panes — its grabbable strip. */
export const PANEL_STACK_DIVIDER_PX = 10;

const COLUMN_SIZE_KEY_PREFIX = "ccgui-next.panelStack.";

/** Registry fields the column rules read (PanelTabDef matches this shape). */
export interface StackablePanelTab {
  id: string;
  /** Shared column key; undefined = the tab owns a whole column. */
  stack?: string;
}

export interface PanelColumn<T extends StackablePanelTab> {
  /** Column identity: the stack key, or the lone tab's id. */
  key: string;
  /** Tabs of the column in display order — the first one is the entry. */
  tabs: T[];
}

/**
 * Which column each tab renders in. Tabs sharing a `stack` value become one
 * column; a stack that ends up with a single member behaves exactly like an
 * ordinary tab (a plugin can be enabled on its own), so nothing special is
 * needed for that case. Input order is display order and is preserved.
 */
export function groupPanelColumns<T extends StackablePanelTab>(tabs: T[]): PanelColumn<T>[] {
  const columns: PanelColumn<T>[] = [];
  const stacks = new Map<string, PanelColumn<T>>();
  for (const tab of tabs) {
    if (!tab.stack) {
      columns.push({ key: tab.id, tabs: [tab] });
      continue;
    }
    const column = stacks.get(tab.stack);
    if (column) {
      column.tabs.push(tab);
      continue;
    }
    const created: PanelColumn<T> = { key: tab.stack, tabs: [tab] };
    stacks.set(tab.stack, created);
    columns.push(created);
  }
  return columns;
}

/**
 * Tabs that keep a pill in the header strip: one per column. The rest of a
 * column is reached through the column itself (their pill would just repeat
 * the same pane), which is why anything a stacked tab showed on its pill has
 * to live inside its pane instead.
 */
export function visiblePanelTabs<T extends StackablePanelTab>(tabs: T[]): T[] {
  return groupPanelColumns(tabs).map((column) => column.tabs[0]);
}

/**
 * The tab a column is entered by — the entry pill of the column that holds
 * `tabId`. Used as a read-side fallback: a persisted active id may point at a
 * stacked tab whose pill is gone, and the column it belongs to is the one to
 * show and to mark as selected.
 */
export function entryTabId<T extends StackablePanelTab>(tabs: T[], tabId: string): string | undefined {
  const columns = groupPanelColumns(tabs);
  const column = columns.find((one) => one.tabs.some((tab) => tab.id === tabId)) ?? columns[0];
  return column?.tabs[0]?.id;
}

/** Equal shares — the split a column starts with before it is ever dragged. */
export function evenColumnSizes(count: number): number[] {
  return new Array(count).fill(1 / Math.max(1, count));
}

/** A stored pane share we are willing to use: a sane fraction of the column. */
function usableShare(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1;
}

/**
 * Pane shares of one column, read from storage. A stored set counts only when
 * it matches the column's pane count (a plugin may have been disabled or
 * enabled since) and every share is a usable fraction; anything else falls
 * back to equal panes.
 */
export function readColumnSizes(key: string, count: number): number[] {
  if (count <= 1) return [1];
  const stored = readStoredJson(`${COLUMN_SIZE_KEY_PREFIX}${key}`, (value) =>
    Array.isArray(value) && value.length === count && value.every(usableShare)
      ? (value as number[])
      : null,
  );
  return stored ? [...stored] : evenColumnSizes(count);
}

/** Remember a column's pane shares (called once, on drag release). */
export function writeColumnSizes(key: string, sizes: number[]): void {
  writeStored(`${COLUMN_SIZE_KEY_PREFIX}${key}`, JSON.stringify(sizes));
}

/**
 * Drag the divider that sits after pane `index`: the two neighbours trade
 * height and nothing else moves. Both keep PANEL_STACK_MIN_PANE_PX — a pane
 * the drag cannot shrink further simply stops the divider. `usablePx` is the
 * column height without the dividers, `deltaPx` how far the divider moved
 * down (negative = up).
 */
export function resizeColumnSizes(
  sizes: number[],
  index: number,
  deltaPx: number,
  usablePx: number,
): number[] {
  const next = [...sizes];
  if (index < 0 || index + 1 >= next.length || usablePx <= 0 || !Number.isFinite(deltaPx)) {
    return next;
  }
  const pixels = next.map((share) => share * usablePx);
  const room = Math.max(0, pixels[index] - PANEL_STACK_MIN_PANE_PX);
  const take = Math.max(0, pixels[index + 1] - PANEL_STACK_MIN_PANE_PX);
  const delta = Math.max(-room, Math.min(take, deltaPx));
  if (delta === 0) return next;
  pixels[index] += delta;
  pixels[index + 1] -= delta;
  return pixels.map((value) => value / usablePx);
}
