import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PANEL_STACK_MIN_PANE_PX,
  entryTabId,
  evenColumnSizes,
  groupPanelColumns,
  readColumnSizes,
  resizeColumnSizes,
  visiblePanelTabs,
  writeColumnSizes,
} from "./panel-stack";

/** Tabs as the registry hands them over: display order, files/changes builtin,
 *  two stacked plugin tabs (the tasks panel on top, the to-do list below). */
const tabs = [
  { id: "files" },
  { id: "changes" },
  { id: "plugin:scheduled-tasks/overview", stack: "chat-right-column" },
  { id: "plugin:todo-lists/todos", stack: "chat-right-column" },
];

describe("groupPanelColumns", () => {
  it("gives a lone tab its own column and stacks tabs sharing a key", () => {
    expect(groupPanelColumns(tabs).map((column) => [column.key, column.tabs.map((tab) => tab.id)])).toEqual([
      ["files", ["files"]],
      ["changes", ["changes"]],
      ["chat-right-column", ["plugin:scheduled-tasks/overview", "plugin:todo-lists/todos"]],
    ]);
  });

  it("keeps display order of the columns and of the panes in them", () => {
    const reversed = [...tabs].reverse();
    const columns = groupPanelColumns(reversed);
    expect(columns.map((column) => column.key)).toEqual([
      "chat-right-column",
      "changes",
      "files",
    ]);
    // The pane order follows the strip order, not the registration order.
    expect(columns[0].tabs.map((tab) => tab.id)).toEqual([
      "plugin:todo-lists/todos",
      "plugin:scheduled-tasks/overview",
    ]);
  });

  it("treats a stack of one as an ordinary tab (the other plugin disabled)", () => {
    const alone = [tabs[0], tabs[1], tabs[3]];
    const columns = groupPanelColumns(alone);
    expect(columns.map((column) => column.key)).toEqual([
      "files",
      "changes",
      "chat-right-column",
    ]);
    expect(columns[2].tabs).toHaveLength(1);
  });
});

describe("visiblePanelTabs", () => {
  it("keeps one pill per column — the stacked tab has none of its own", () => {
    expect(visiblePanelTabs(tabs).map((tab) => tab.id)).toEqual([
      "files",
      "changes",
      "plugin:scheduled-tasks/overview",
    ]);
  });

  it("keeps the pill of a stack member that stands alone", () => {
    expect(visiblePanelTabs([tabs[0], tabs[3]]).map((tab) => tab.id)).toEqual([
      "files",
      "plugin:todo-lists/todos",
    ]);
  });
});

describe("entryTabId", () => {
  it("resolves a stacked tab to the pill its column is entered by", () => {
    expect(entryTabId(tabs, "plugin:todo-lists/todos")).toBe("plugin:scheduled-tasks/overview");
    expect(entryTabId(tabs, "files")).toBe("files");
  });

  it("falls back to the first tab for an id that is gone", () => {
    expect(entryTabId(tabs, "plugin:gone/panel")).toBe("files");
  });
});

describe("column sizes", () => {
  const key = "chat-right-column";

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("starts with equal panes and remembers what was dragged", () => {
    expect(readColumnSizes(key, 2)).toEqual(evenColumnSizes(2));
    writeColumnSizes(key, [0.7, 0.3]);
    expect(readColumnSizes(key, 2)).toEqual([0.7, 0.3]);
  });

  it("ignores a stored split that belongs to another pane count", () => {
    writeColumnSizes(key, [0.7, 0.3]);
    expect(readColumnSizes(key, 3)).toEqual(evenColumnSizes(3));
  });

  it("ignores stored rubbish", () => {
    writeColumnSizes(key, [0.7, 0.3]);
    localStorage.setItem("ccgui-next.panelStack." + key, "[0.7,0]");
    expect(readColumnSizes(key, 2)).toEqual(evenColumnSizes(2));
    localStorage.setItem("ccgui-next.panelStack." + key, "not json");
    expect(readColumnSizes(key, 2)).toEqual(evenColumnSizes(2));
  });

  it("gives a single-pane column the whole height", () => {
    expect(readColumnSizes("files", 1)).toEqual([1]);
  });

  it("trades height between the two panes the divider sits between", () => {
    const grown = resizeColumnSizes([0.5, 0.5], 0, 60, 600);
    expect(grown[0]).toBeCloseTo(0.6, 6);
    expect(grown[1]).toBeCloseTo(0.4, 6);
    const back = resizeColumnSizes(grown, 0, -120, 600);
    expect(back[0]).toBeCloseTo(0.4, 6);
    expect(back[1]).toBeCloseTo(0.6, 6);
  });

  it("stops at the pane floor instead of hiding a pane", () => {
    const squeezed = resizeColumnSizes([0.5, 0.5], 0, 1000, 600);
    expect(squeezed[1] * 600).toBeCloseTo(PANEL_STACK_MIN_PANE_PX, 6);
    expect(squeezed[0] + squeezed[1]).toBeCloseTo(1, 6);
    const other = resizeColumnSizes([0.5, 0.5], 0, -1000, 600);
    expect(other[0] * 600).toBeCloseTo(PANEL_STACK_MIN_PANE_PX, 6);
  });

  it("leaves the sizes alone when the drag cannot move anything", () => {
    expect(resizeColumnSizes([0.5, 0.5], 5, 40, 600)).toEqual([0.5, 0.5]);
    expect(resizeColumnSizes([0.5, 0.5], 0, 40, 0)).toEqual([0.5, 0.5]);
    // The upper pane is already at the floor: the divider has nowhere to go.
    expect(resizeColumnSizes([0.16, 0.84], 0, -50, 600)).toEqual([0.16, 0.84]);
  });
});
