/**
 * Project overview — the page a workspace opens when its *name* is clicked in
 * the left sidebar (the caret beside it still unfolds the session list).
 *
 * It answers "what is this project right now" without opening a session:
 * the agreements the project runs by, the memory files that hold them, its own
 * to-do list, the schedules pointing at it, the skills available in it, and —
 * last, and only when there are any — its git repositories.
 *
 * Layout (block order and folded state) is per project and persisted, so the
 * page comes back the way it was left.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import CircleCheck from "lucide-react/dist/esm/icons/circle-check";
import Clock from "lucide-react/dist/esm/icons/clock";
import FileText from "lucide-react/dist/esm/icons/file-text";
import FolderSymlink from "lucide-react/dist/esm/icons/folder-symlink";
import GripVertical from "lucide-react/dist/esm/icons/grip-vertical";
import Square from "lucide-react/dist/esm/icons/square";
import { WorkspaceAvatar } from "@/components/application/ai-chat/workspace-avatar";
import { cx } from "@/utils/cx";
import { timelineColumnClass } from "./chat-column";
import { useProjectOverview, type ProjectOverviewData } from "./use-project-overview";
import {
  readProjectOverview,
  saveProjectOverview,
  type OverviewBlockId,
} from "./project-overview-store";
import { useChatStore } from "./store";

interface BlockDef {
  id: OverviewBlockId;
  title: string;
  /** Hidden entirely while it has nothing to show. */
  optional?: boolean;
}

const BLOCKS: readonly BlockDef[] = [
  { id: "rules", title: "Правила проекта" },
  { id: "memory", title: "Договорённости и разборы" },
  { id: "work", title: "Дела и расписания" },
  { id: "skills", title: "Навыки" },
  { id: "repos", title: "Репозитории", optional: true },
];

/** Rows shown before the "show the rest" link, per block. */
const PEEK: Record<OverviewBlockId, number> = {
  rules: 4,
  memory: 6,
  work: 12,
  skills: 40,
  repos: 12,
};

export function ProjectOverview({ workspacePath }: { workspacePath: string }) {
  const wide = useChatStore((s) => s.wideLayout);
  const data = useProjectOverview(workspacePath);
  const [layout, setLayout] = useState(() => readProjectOverview(workspacePath));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dragging, setDragging] = useState<OverviewBlockId | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: OverviewBlockId; before: boolean } | null>(
    null,
  );
  const dragRef = useRef<{
    id: OverviewBlockId;
    over: OverviewBlockId | null;
    before: boolean;
  } | null>(null);

  // The tab can swap project without remounting; layout is per path.
  const lastPath = useRef(workspacePath);
  useEffect(() => {
    if (lastPath.current === workspacePath) return;
    lastPath.current = workspacePath;
    setLayout(readProjectOverview(workspacePath));
    setExpanded({});
  }, [workspacePath]);

  const update = useCallback(
    (next: Partial<{ order: OverviewBlockId[]; folded: Record<string, boolean> }>) => {
      setLayout((current) => {
        const merged = { ...current, ...next };
        saveProjectOverview(workspacePath, merged);
        return merged;
      });
    },
    [workspacePath],
  );

  /** Saved order, with unknown/duplicate ids dropped and new blocks appended. */
  const ordered = useMemo(() => {
    const byId = new Map(BLOCKS.map((b) => [b.id, b]));
    const seen = new Set<OverviewBlockId>();
    const list: BlockDef[] = [];
    for (const id of layout.order) {
      const def = byId.get(id);
      if (!def || seen.has(id)) continue;
      seen.add(id);
      list.push(def);
    }
    for (const def of BLOCKS) if (!seen.has(def.id)) list.push(def);
    return list;
  }, [layout.order]);

  const orderIds = ordered.map((b) => b.id).join(",");

  const moveBlock = useCallback(
    (id: OverviewBlockId, target: OverviewBlockId, before: boolean) => {
      if (id === target) return;
      const current = orderIds.split(",").filter(Boolean) as OverviewBlockId[];
      const without = current.filter((item) => item !== id);
      const at = without.indexOf(target);
      if (at < 0) return;
      without.splice(before ? at : at + 1, 0, id);
      update({ order: without });
    },
    [orderIds, update],
  );

  /** Pointer events, not HTML5 drag-and-drop: WKWebView never delivers
   *  dragover/drop (the to-do tree drags by hand for the same reason). The
   *  listener reads `moveBlock` from this render, which is the one the drag
   *  started in. */
  const startDrag = (id: OverviewBlockId) => {
    if (dragRef.current) return;
    dragRef.current = { id, over: null, before: true };
    setDragging(id);
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>("[data-overview-block]"),
      );
      let next: { id: OverviewBlockId; before: boolean } | null = null;
      for (const node of nodes) {
        const blockId = node.dataset.overviewBlock as OverviewBlockId | undefined;
        if (!blockId || blockId === drag.id) continue;
        const box = node.getBoundingClientRect();
        if (event.clientY < box.top || event.clientY > box.bottom) continue;
        // Side-by-side blocks split left/right instead of top/bottom.
        const sideBySide = box.width < 320;
        const after = sideBySide
          ? event.clientX > box.left + box.width / 2
          : event.clientY > box.top + box.height / 2;
        next = { id: blockId, before: !after };
        break;
      }
      const changed =
        (drag.over ?? null) !== (next?.id ?? null) || drag.before !== (next?.before ?? true);
      drag.over = next?.id ?? null;
      drag.before = next?.before ?? true;
      if (changed) setDropTarget(next);
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      const drag = dragRef.current;
      dragRef.current = null;
      setDragging(null);
      setDropTarget(null);
      if (!commit || !drag || !drag.over) return;
      moveBlock(drag.id, drag.over, drag.before);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
  };

  // Folded blocks keep their row; folded-by-default blocks (none today)
  // would start here.
  const folded = layout.folded;

  const visible = ordered.filter((block) => {
    if (!block.optional) return true;
    return data.counts[block.id] > 0 || data.loading;
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background-primary-default">
      <div className={cx(timelineColumnClass(wide), "px-4 pb-10 pt-5")}>
        <OverviewHeader data={data} />

        {visible.map((block) => {
          const isFolded = folded[block.id] === true;
          const target = dropTarget?.id === block.id ? dropTarget : null;
          return (
            <div
              key={block.id}
              data-overview-block={block.id}
              className={cx(
                "overview-block",
                dragging === block.id && "overview-block-dragging",
                target && (target.before ? "overview-drop-before" : "overview-drop-after"),
              )}
            >
              <BlockHead
                title={block.title}
                hint={hintFor(block.id, data)}
                folded={isFolded}
                onToggle={() =>
                  update({ folded: { ...folded, [block.id]: !isFolded } })
                }
                onDragStart={() => startDrag(block.id)}
              />
              {!isFolded && (
                <div className="overview-body">
                  <BlockBody
                    id={block.id}
                    data={data}
                    expanded={expanded[block.id] === true}
                    onExpand={() => setExpanded((state) => ({ ...state, [block.id]: true }))}
                  />
                </div>
              )}
            </div>
          );
        })}

        {data.error && (
          <p className="mt-3 text-caption-1-regular text-text-tertiary">{data.error}</p>
        )}
      </div>
    </div>
  );
}

/** Cover: avatar, project name, path, and the few numbers worth knowing. */
function OverviewHeader({ data }: { data: ProjectOverviewData }) {
  const chips: string[] = [];
  if (data.branch) chips.push(`ветка ${data.branch}`);
  if (data.counts.repos) chips.push(`${data.counts.repos} репозиториев`);
  if (data.counts.sessions) chips.push(`${data.counts.sessions} сессий`);
  if (data.loading) chips.push("читаю…");

  return (
    <header className="mb-5">
      <div className="flex items-center gap-2">
        <WorkspaceAvatar
          path={data.path}
          fallback={
            <FolderSymlink className="size-4 text-foreground-icon-secondary" aria-hidden />
          }
        />
        <h1 className="min-w-0 truncate text-heading-3 text-text-primary">
          {data.name || "Проект"}
        </h1>
      </div>
      <p className="mt-1 truncate text-caption-1-regular text-text-tertiary">{data.path}</p>
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded-2lg bg-background-secondary-default px-2 py-0.5 text-caption-2-regular text-text-tertiary"
            >
              {chip}
            </span>
          ))}
        </div>
      )}
    </header>
  );
}

/** Block head: fold caret + spaced-out title on the left, hint and reorder
 *  grip on the right. The whole head toggles; the grip starts a drag. */
function BlockHead({
  title,
  hint,
  folded,
  onToggle,
  onDragStart,
}: {
  title: string;
  hint: string;
  folded: boolean;
  onToggle: () => void;
  onDragStart: () => void;
}) {
  return (
    <div className="overview-head group">
      <button
        type="button"
        aria-expanded={!folded}
        onClick={onToggle}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
      >
        {folded ? (
          <ChevronRight className="size-3.5 shrink-0 text-foreground-icon-tertiary" aria-hidden />
        ) : (
          <ChevronDown className="size-3.5 shrink-0 text-foreground-icon-tertiary" aria-hidden />
        )}
        <span className="overview-title">{title.toUpperCase()}</span>
      </button>
      {hint && <span className="overview-hint">{hint}</span>}
      <button
        type="button"
        aria-label="Перетащить блок"
        title="Перетащить блок"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          onDragStart();
        }}
        className="overview-grip cursor-grab opacity-0"
      >
        <GripVertical className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

function hintFor(id: OverviewBlockId, data: ProjectOverviewData): string {
  switch (id) {
    case "rules":
      return data.rules.source ?? "";
    case "memory":
      return data.memory.length ? `${data.memory.length} файлов` : "";
    case "work":
      // Подпись блока — про оба его столбца: сколько дел и сколько расписаний.
      return [
        data.todos.left ? `${data.todos.left} дел` : "",
        data.tasks.length ? `${data.tasks.length} расписаний` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    case "skills":
      return data.skills.length ? `${data.skills.length}` : "";
    case "repos":
      return data.repos.length ? `${data.repos.length}` : "";
    default:
      return "";
  }
}

function BlockBody({
  id,
  data,
  expanded,
  onExpand,
}: {
  id: OverviewBlockId;
  data: ProjectOverviewData;
  expanded: boolean;
  onExpand: () => void;
}) {
  const limit = PEEK[id];
  const more = (total: number) =>
    !expanded && total > limit ? { rest: total - limit, onExpand } : null;

  switch (id) {
    case "rules": {
      if (!data.rules.lines.length) return <Empty text="Правила проекта не найдены." />;
      const shown = expanded ? data.rules.lines : data.rules.lines.slice(0, limit);
      const rest = more(data.rules.lines.length);
      return (
        <>
          <ul className="overview-list">
            {shown.map((line, index) => (
              <li key={index} className="overview-rule">
                <span aria-hidden>•</span>
                <span className="min-w-0">{line}</span>
              </li>
            ))}
          </ul>
          {rest && <MoreButton label={`показать все ${data.rules.lines.length}`} onClick={rest.onExpand} />}
        </>
      );
    }
    case "memory": {
      if (!data.memory.length) return <Empty text="Файлов памяти нет." />;
      const shown = expanded ? data.memory : data.memory.slice(0, limit);
      const rest = more(data.memory.length);
      return (
        <>
          <ul className="overview-list">
            {shown.map((file) => (
              <li key={file.path} className="overview-memory">
                <FileText className="size-3.5 shrink-0 text-foreground-icon-tertiary" aria-hidden />
                <span className="overview-file">{file.path}</span>
                <span className="overview-desc">{file.summary || "—"}</span>
              </li>
            ))}
          </ul>
          {rest && <MoreButton label={`ещё ${rest.rest} файлов`} onClick={rest.onExpand} />}
        </>
      );
    }
    case "work": {
      const left = data.todos.left ? `${data.todos.left} дел` : "дел нет";
      const right = data.tasks.length ? `${data.tasks.length} задач` : "расписаний нет";
      return (
        <div className="overview-cols">
          <section className="overview-col">
            <h4 className="overview-col-title">Списки дел</h4>
            <TodoList data={data} />
          </section>
          <section className="overview-col">
            <h4 className="overview-col-title">Расписания</h4>
            <TaskList data={data} />
          </section>
          {/* Подписи держатся в самом блоке: наружу он отдаёт одной строкой,
              сколько там того и другого. */}
          <span className="sr-only">{`${left} ${right}`}</span>
        </div>
      );
    }
    case "skills": {
      if (!data.skills.length) return <Empty text="Навыков не найдено." />;
      return (
        <>
          <div className="flex flex-wrap gap-1.5">
            {data.skills.map((skill) => (
              <span key={skill} className="overview-skill" title={skill}>
                {skill}
              </span>
            ))}
          </div>
          <p className="overview-foot">
            {data.skillsOwn.length > 0
              ? `Проектных: ${data.skillsOwn.join(", ")}`
              : "Проектных навыков нет — это общий набор машины."}
          </p>
        </>
      );
    }
    case "repos": {
      if (!data.repos.length) return <Empty text="Репозиториев нет." />;
      return (
        <ul className="overview-list">
          {data.repos.map((repo) => (
            <li key={repo.path} className="overview-row">
              <span className="min-w-0 flex-1 truncate">{repo.name}</span>
              <span className="overview-meta">
                {repo.branch || "—"}
                {repo.dirty > 0 && ` · ${repo.dirty} изменений`}
                {repo.ahead > 0 && ` · +${repo.ahead}`}
                {repo.behind > 0 && ` · −${repo.behind}`}
              </span>
            </li>
          ))}
        </ul>
      );
    }
    default:
      return null;
  }
}

function Empty({ text }: { text: string }) {
  return <p className="overview-empty">{text}</p>;
}

/** Left column of the «Дела и расписания» block: this project's to-dos. */
function TodoList({ data }: { data: ProjectOverviewData }) {
  if (!data.todos.items.length) return <Empty text="Список дел пуст." />;
  return (
    <ul className="overview-list">
      {data.todos.items.map((item) => (
        <li key={item.id} className="overview-row" style={{ paddingLeft: item.depth * 14 }}>
          {item.done ? (
            <CircleCheck className="size-3.5 shrink-0 text-foreground-icon-tertiary" aria-hidden />
          ) : (
            <Square className="size-3.5 shrink-0 text-foreground-icon-tertiary" aria-hidden />
          )}
          <span
            className={cx("min-w-0 truncate", item.done && "text-text-tertiary line-through")}
          >
            {item.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Right column of the same block: the schedules pointing at this project. */
function TaskList({ data }: { data: ProjectOverviewData }) {
  if (!data.tasks.length) return <Empty text="Расписаний по проекту нет." />;
  return (
    <ul className="overview-list">
      {data.tasks.map((task) => (
        <li key={task.id} className="overview-row">
          <Clock
            className={cx(
              "size-3.5 shrink-0",
              task.enabled ? "text-foreground-icon-tertiary" : "text-text-tertiary",
            )}
            aria-hidden
          />
          <span
            className={cx(
              "min-w-0 flex-1 truncate",
              !task.enabled && "text-text-tertiary line-through",
            )}
          >
            {task.title}
          </span>
          <span className="overview-meta">{formatNextRun(task.nextAt)}</span>
        </li>
      ))}
    </ul>
  );
}

function MoreButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1 cursor-pointer text-caption-1-regular text-text-tertiary hover:text-text-primary"
    >
      {label}
    </button>
  );
}

/** "07.11, 10:00" — the shape the tasks panel shows, without the year. */
export function formatNextRun(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}, ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

export type { ProjectOverviewData };
