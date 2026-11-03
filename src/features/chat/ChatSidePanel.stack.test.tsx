import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The panel mounts plugin tabs inside PluginBoundary and imports the builtin
// files/changes panels; neither is what this test is about.
vi.mock("@/features/plugins/runtime/loader", () => ({
  bootstrapPlugins: vi.fn(async () => []),
  getPluginStatesSnapshot: () => [],
  ipcBackend: {},
  loadPlugin: vi.fn(async () => {}),
  reloadPlugin: vi.fn(async () => {}),
  pluginsBootstrapped: () => true,
  prunePluginRuntimeState: vi.fn(),
  subscribePluginStates: () => () => {},
  unloadPlugin: vi.fn(),
  notePluginRenderOk: vi.fn(),
  reportPluginCrash: vi.fn(),
}));
vi.mock("@/features/plugins/builtin", () => ({ BUILTIN_PLUGINS: [] }));
vi.mock("@/features/files/FilesPanel", () => ({ FilesPanel: () => null }));
vi.mock("@/features/git/ChangesPanel", () => ({ ChangesPanel: () => null }));

import "@/lib/i18n";
import { panelTabRegistry } from "@ccgui/plugin-sdk";
import { ChatSidePanel } from "./ChatSidePanel";
import type { ActiveSession } from "./store";
// Side-effect import: registers the builtin files/changes tabs.
import "./panel-tabs";

// React 18's act() requires this flag to be set by the test environment.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const STACK_KEY = "chat-right-column";

/** Two plugin tabs sharing one column — the tasks panel on top, the to-do
 *  list below (what the scheduled-tasks and todo-lists plugins register). */
function registerStack() {
  return [
    panelTabRegistry.register({
      id: "plugin:scheduled-tasks/overview",
      label: () => "Scheduled Tasks",
      order: 10,
      stack: STACK_KEY,
      component: () => <div data-testid="pane-tasks" />,
    }),
    panelTabRegistry.register({
      id: "plugin:todo-lists/todos",
      label: () => "Todo",
      order: 11,
      stack: STACK_KEY,
      component: () => <div data-testid="pane-todos" />,
    }),
  ];
}

const active = { workspacePath: "/tmp/ws" } as unknown as ActiveSession;

describe("ChatSidePanel stacked column", () => {
  let container: HTMLDivElement;
  let root: Root;
  let disposers: Array<() => void>;

  function panel(panelTab: string) {
    return (
      <ChatSidePanel
        active={active}
        panelRef={{ current: null }}
        panelWidth={300}
        panelCollapsed={false}
        dragging={null}
        panelTab={panelTab}
        onResizeStart={() => {}}
      />
    );
  }

  beforeEach(() => {
    localStorage.clear();
    disposers = registerStack();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      for (const dispose of disposers) dispose();
      root.unmount();
    });
    container.remove();
    localStorage.clear();
  });

  function render(panelTab = "plugin:scheduled-tasks/overview") {
    act(() => {
      root.render(panel(panelTab));
    });
  }

  function panes(): HTMLDivElement[] {
    return Array.from(container.querySelectorAll<HTMLDivElement>('[data-testid^="pane-"]'));
  }

  it("renders both tabs of the column, one above the other, with a divider", () => {
    render();
    expect(panes().map((pane) => pane.dataset.testid)).toEqual(["pane-tasks", "pane-todos"]);
    const dividers = container.querySelectorAll('[role="separator"][aria-orientation="horizontal"]');
    expect(dividers).toHaveLength(1);
    // The divider sits between the two panes, not at an end of the column.
    expect(panes()[0].compareDocumentPosition(dividers[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the same column when the persisted tab is the stacked one", () => {
    // The to-do tab has no pill of its own, but a stored id may still point at
    // it (it was selected before the plugins were stacked).
    render("plugin:todo-lists/todos");
    expect(panes()).toHaveLength(2);
  });

  it("keeps the stacked column mounted but hidden while another tab is shown", () => {
    act(() => {
      root.render(panel("files"));
    });
    // The app mounts every panel and hides the ones that are not selected —
    // the stacked column keeps that behaviour instead of unmounting.
    expect(panes()[0].closest("div.hidden")).not.toBeNull();
    render();
    expect(panes()[0].closest("div.hidden")).toBeNull();
  });

  it("starts the panes even and uses the remembered split", () => {
    render();
    const [top, bottom] = panes().map((pane) => pane.parentElement as HTMLElement);
    expect(top.style.flexGrow).toBe("0.5");
    expect(bottom.style.flexGrow).toBe("0.5");
    act(() => {
      root.unmount();
    });
    localStorage.setItem("ccgui-next.panelStack." + STACK_KEY, "[0.7,0.3]");
    root = createRoot(container);
    render();
    const grown = panes().map((pane) => (pane.parentElement as HTMLElement).style.flexGrow);
    expect(grown).toEqual(["0.7", "0.3"]);
  });
});
