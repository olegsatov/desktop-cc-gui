import { useTranslation } from "react-i18next";
import { PluginBoundary } from "@/features/plugins/boundary/PluginBoundary";
import { pluginIdFromRegistryKey } from "@ccgui/plugin-sdk";
import { cx } from "@/utils/cx";
import { ChangesTab } from "./panel-tabs";
import { PanelStack } from "./PanelStack";
import { resolveActivePanelTab, usePanelColumns } from "./use-panel-tabs";
import type { ActiveSession } from "./store";

export function ChatSidePanel({
  active,
  panelRef,
  panelWidth,
  panelCollapsed,
  dragging,
  panelTab,
  onResizeStart,
  overlay = false,
}: {
  active: ActiveSession | null;
  panelRef: React.RefObject<HTMLDivElement>;
  panelWidth: number;
  panelCollapsed: boolean;
  dragging: "sidebar" | "panel" | null;
  panelTab: string;
  onResizeStart: (e: React.PointerEvent) => void;
  overlay?: boolean;
}) {
  const { t } = useTranslation();
  const columns = usePanelColumns();
  // Persisted tab may point at an unloaded plugin tab; fall back to the
  // first tab so the sidebar never renders fully hidden (read-side only).
  const activeTab = active ? resolveActivePanelTab(columns.flatMap((column) => column.tabs), panelTab) : undefined;
  if (!active) return null;
  const workspacePath = active.workspacePath;
  const activeColumn = columns.find((column) => column.tabs.some((tab) => tab.id === activeTab)) ?? columns[0];

  /** One tab's pane: the crash boundary of its plugin and — for the builtin
   *  changes tab — the `visible` flag it needs to poll only while shown. */
  function pane(tab: (typeof columns)[number]["tabs"][number], shown: boolean) {
    const TabComponent = tab.component;
    const panel = tab.id === "changes" && TabComponent === ChangesTab ? (
      <ChangesTab workspacePath={workspacePath} visible={!panelCollapsed && shown} />
    ) : (
      <TabComponent workspacePath={workspacePath} />
    );
    return tab.id.startsWith("plugin:") ? (
      // Plugin tabs get a crash boundary scoped to their plugin id.
      <PluginBoundary pluginId={pluginIdFromRegistryKey(tab.id)}>{panel}</PluginBoundary>
    ) : (
      panel
    );
  }
  return (
    <div
      ref={panelRef}
      className={cx(
        overlay
          ? "absolute inset-y-0 right-0 z-20 max-w-full shadow-xl"
          : "relative",
        "flex shrink-0 overflow-hidden",
        // Width transition for collapse/expand; disabled mid-drag
        // since resizes mutate style.width imperatively.
        !dragging &&
          "transition-[width] duration-200 ease-out motion-reduce:transition-none",
      )}
      style={{
        width: panelCollapsed ? 0 : panelWidth,
        maxWidth: overlay ? "100%" : undefined,
      }}
    >
      {/* Panel resize strip: full height, straddling the border. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("chat.resizePanel")}
        title={t("chat.resizePanel")}
        onPointerDown={onResizeStart}
        className={cx(
          "group absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize touch-none",
          panelCollapsed && "hidden",
        )}
      >
        <span
          className={cx(
            "absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-accent-300 opacity-0 transition-opacity group-hover:opacity-100",
            dragging === "panel" && "opacity-100",
          )}
        />
      </div>
      <div
        className={cx(
          "flex h-full w-full flex-col overflow-hidden border-separator-border bg-background-primary-default",
          !panelCollapsed && "border-l",
        )}
      >
        {columns.map((column) => {
          const shown = activeColumn?.key === column.key;
          return (
            <div
              key={column.key}
              className={cx("min-h-0 flex-1", shown ? "flex flex-col" : "hidden")}
            >
              {column.tabs.length > 1 ? (
                <PanelStack
                  columnKey={column.key}
                  panes={column.tabs.map((tab) => ({ key: tab.id, node: pane(tab, shown) }))}
                />
              ) : (
                pane(column.tabs[0], shown)
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
