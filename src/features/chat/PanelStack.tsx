import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "@/utils/cx";
import { PANEL_STACK_DIVIDER_PX, readColumnSizes, resizeColumnSizes, writeColumnSizes } from "./panel-stack";

/**
 * One right-panel column holding several panes (see panel-stack.ts): the panes
 * stack vertically, a draggable divider sits between each pair, and the
 * split is remembered per column. Panes are handed in ready-made — the caller
 * keeps the plugin crash boundary and the `visible` bookkeeping.
 */

export interface PanelStackPane {
  /** Stable pane identity (the tab id) — React keys and pane order. */
  key: string;
  node: ReactNode;
}

export function PanelStack({ columnKey, panes }: { columnKey: string; panes: PanelStackPane[] }) {
  const { t } = useTranslation();
  const count = panes.length;
  const [sizes, setSizes] = useState(() => readColumnSizes(columnKey, count));
  const [dragging, setDragging] = useState<number | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const paneRefs = useRef<Array<HTMLDivElement | null>>([]);
  const dragRef = useRef<{
    index: number;
    startY: number;
    startSizes: number[];
    sizes: number[];
    usablePx: number;
  } | null>(null);

  // A plugin can be enabled or disabled while the panel is open: the pane set
  // changes and the remembered split belongs to the previous one.
  useEffect(() => {
    setSizes(readColumnSizes(columnKey, count));
  }, [columnKey, count]);

  const applySizes = useCallback((values: number[]) => {
    values.forEach((value, index) => {
      const pane = paneRefs.current[index];
      if (pane) pane.style.flexGrow = String(value);
    });
  }, []);

  const startDrag = (index: number) => (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const host = hostRef.current;
    if (!host) return;
    const startSizes = sizes;
    dragRef.current = {
      index,
      startY: event.clientY,
      startSizes,
      sizes: startSizes,
      usablePx: host.getBoundingClientRect().height - PANEL_STACK_DIVIDER_PX * Math.max(0, count - 1),
    };
    setDragging(index);
  };

  useEffect(() => {
    if (dragging === null) return;
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      drag.sizes = resizeColumnSizes(drag.startSizes, drag.index, event.clientY - drag.startY, drag.usablePx);
      // The panes are resized directly under the pointer: a state update per
      // pointermove would re-render the plugin panes with every pixel (the
      // panel edges are dragged the same way).
      applySizes(drag.sizes);
    };
    const finish = (commit: boolean) => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragging(null);
      if (!drag) return;
      if (commit) {
        setSizes(drag.sizes);
        writeColumnSizes(columnKey, drag.sizes);
        return;
      }
      // Cancelled: the DOM had already moved, the state never did.
      applySizes(drag.startSizes);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [dragging, columnKey, applySizes]);

  if (count < 2) return <>{panes[0]?.node ?? null}</>;

  return (
    <div ref={hostRef} className="flex min-h-0 flex-1 flex-col">
      {panes.map((pane, index) => {
        const isDragged = dragging === index - 1;
        return (
          <Fragment key={pane.key}>
            {index > 0 && (
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label={t("chat.resizePanelStack")}
                title={t("chat.resizePanelStack")}
                onPointerDown={startDrag(index - 1)}
                className="group relative z-10 h-2.5 shrink-0 cursor-row-resize touch-none"
              >
                <span
                  className={cx(
                    "pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2",
                    isDragged
                      ? "h-0.5 bg-accent-300"
                      : "h-px bg-separator-border group-hover:bg-accent-300",
                  )}
                />
                <span
                  className={cx(
                    "pointer-events-none absolute left-1/2 top-1/2 h-[3px] w-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full",
                    isDragged
                      ? "bg-accent-300 opacity-100"
                      : "bg-text-tertiary opacity-40 group-hover:bg-accent-300 group-hover:opacity-100",
                  )}
                />
              </div>
            )}
            <div
              ref={(element) => {
                paneRefs.current[index] = element;
              }}
              className="flex min-h-0 flex-col overflow-hidden"
              style={{ flexGrow: sizes[index] ?? 1, flexBasis: 0 }}
            >
              {pane.node}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
