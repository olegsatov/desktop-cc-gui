/**
 * Data behind the project overview: sessions, git repositories, to-dos,
 * schedules, the project's own skills and its memory files.
 *
 * Everything but the memory files comes from host IPC. The memory files are
 * read through `git ls-files` / `git status` (the host has no directory
 * listing on this surface), which also keeps the panel honest: only files
 * that are actually part of the project show up.
 */

import { useCallback, useEffect, useState } from "react";
import { ipc, type RepositorySummary, type SessionMeta } from "@/lib/ipc";

/** One row of the agreements file, already stripped of markdown noise. */
export interface RuleLine {
  text: string;
}

/** One memory file: path relative to the project + its own one-line note. */
export interface MemoryFile {
  path: string;
  summary: string;
}

export interface TodoRow {
  id: string;
  text: string;
  done: boolean;
  depth: number;
}

export interface TaskRow {
  id: string;
  title: string;
  nextAt: string | null;
  enabled: boolean;
}

export interface RepoRow {
  name: string;
  path: string;
  branch: string;
  dirty: number;
  ahead: number;
  behind: number;
}

export interface ProjectOverviewData {
  loading: boolean;
  error: string | null;
  name: string;
  path: string;
  branch: string;
  sessions: SessionMeta[];
  repos: RepoRow[];
  rules: { source: string | null; lines: string[] };
  memory: MemoryFile[];
  todos: { items: TodoRow[]; left: number };
  tasks: TaskRow[];
  /** Навыки в папках самого проекта: имя и папка, откуда он. */
  skills: { name: string; root: string }[];
  /** One entry per overview block, plus `sessions` for the cover chip.
   *  «Дела и расписания» is a single block (`work`); its two columns still
   *  count separately in `todos.left` / `tasks.length`. */
  counts: Record<"rules" | "memory" | "work" | "skills" | "repos" | "sessions", number>;
}

const EMPTY: ProjectOverviewData = {
  loading: true,
  error: null,
  name: "",
  path: "",
  branch: "",
  sessions: [],
  repos: [],
  rules: { source: null, lines: [] },
  memory: [],
  todos: { items: [], left: 0 },
  tasks: [],
  skills: [],
  counts: { rules: 0, memory: 0, work: 0, skills: 0, repos: 0, sessions: 0 },
};

/** Where a project keeps its standing agreements, in priority order. */
const RULES_FILES = [
  ".operator/operator.md",
  "AGENTS.md",
  ".operator-shared/operator.md",
  "CLAUDE.md",
];
/** `description:` / `read_if:` frontmatter, or `# Title` — as the files are. */
function summarise(content: string): string {
  const front = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (front) {
    const description = front[1].match(/^description:\s*(.+)$/m);
    if (description) return description[1].trim().replace(/^["']|["']$/g, "");
  }
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  const first = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && !line.startsWith("---"));
  return first ?? "";
}

/** Bullet lines of the operating rules: `- text`, without code fences. */
function ruleLines(content: string): string[] {
  const lines: string[] = [];
  let inFence = false;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (!bullet) continue;
    const text = bullet[1].replace(/\*\*/g, "").replace(/`/g, "").trim();
    // Multi-line bullets wrap onto an indented continuation line.
    if (text) lines.push(text);
  }
  return lines;
}

/** Read a project file as text; null when it does not exist (or is binary).
 *  `read_file` is the host's reader — the same one the editor uses. */
async function readText(path: string): Promise<string | null> {
  try {
    const content = await ipc.readFile(path);
    if (content.kind !== "text" || content.text === null) return null;
    return content.text;
  } catch {
    return null;
  }
}

/** Files git knows about under `dir` (tracked or untracked), one level deep. */
async function listMemoryFiles(
  root: string,
): Promise<{ path: string; content: string }[]> {
  const dirs = [
    ".operator/specs",
    ".operator/plans",
    ".operator/guides",
    ".operator",
    "docs/specs",
  ];
  const found = new Map<string, string>();
  for (const dir of dirs) {
    const entries = await ipc.listDir(`${root}/${dir}`).catch(() => []);
    for (const entry of entries) {
      if (entry.isDir) continue;
      if (!entry.name.endsWith(".md")) continue;
      // The catalog is a directory listing of the brain, not a document.
      if (entry.name === "catalog.md" || entry.name === "operator.md") continue;
      const relative = `${dir}/${entry.name}`;
      if (found.has(relative)) continue;
      const content = await readText(`${root}/${relative}`);
      if (content === null) continue;
      found.set(relative, content);
    }
  }
  return [...found.entries()]
    .map(([path, content]) => ({ path, content }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Папки навыков **проекта** (относительно его корня), в порядке старшинства.
 *  Тот же список, что приложение обходит для подсказок в поле ввода —
 *  `src-tauri/src/slash_commands.rs`, `WORKSPACE_SKILL_SUBPATHS`. Общий набор
 *  машины в обзор намеренно не идёт (просьба владельца 03.11.2026). */
const PROJECT_SKILL_DIRS = [
  // pi-bolt: скиллы проекта (наша договорённость — новый навык кладётся в
  // `<проект>/.pi/skills/<имя>/SKILL.md`; у приложения этого пути в списке нет,
  // а у владельца все проектные навыки лежат именно здесь).
  ".pi/skills",
  ".claude/skills",
  ".agents/skills",
  ".codex/skills",
  ".skills",
  "skills",
  ".agent/skills",
  ".cursor/skills",
  ".github/skills",
];

/** Навыки в папках проекта: имя и откуда оно. */
async function projectSkills(root: string): Promise<{ name: string; root: string }[]> {
  const out: { name: string; root: string }[] = [];
  const seen = new Set<string>();
  for (const dir of PROJECT_SKILL_DIRS) {
    const entries = await ipc.listDir(`${root}/${dir}`).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDir || seen.has(entry.name)) continue;
      seen.add(entry.name);
      out.push({ name: entry.name, root: dir });
    }
  }
  return out;
}

export function useProjectOverview(workspacePath: string): ProjectOverviewData {
  const [data, setData] = useState<ProjectOverviewData>(EMPTY);

  const load = useCallback(
    async (signal: { cancelled: boolean }) => {
      if (!workspacePath) return;
      setData((current) => ({ ...current, loading: true, error: null }));
      try {
        const [workspaces, sessions, skills] = await Promise.all([
          ipc.listWorkspaces(),
          ipc.listSessions(),
          projectSkills(workspacePath),
        ]);
        if (signal.cancelled) return;
        const workspace = workspaces.find((row) => row.path === workspacePath);
        const mine = sessions
          .filter((session) => session.workspacePath === workspacePath)
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

        const rulesFiles = await Promise.all(
          RULES_FILES.map(async (path) => ({ path, content: (await readText(`${workspacePath}/${path}`)) ?? "" })),
        );
        if (signal.cancelled) return;
        const rules = rulesFiles.find((file) => file.content.trim().length > 0) ?? null;

        const memory = await listMemoryFiles(workspacePath);
        if (signal.cancelled) return;

        const [repoSummaries, todoRows, taskRows] = await Promise.all([
          ipc.gitRepositorySummaries(childPaths(mine)),
          readTodos(workspacePath),
          readTasks(workspacePath),
        ]);
        if (signal.cancelled) return;

        const repoRows: RepoRow[] = repoSummaries.map((row: RepositorySummary) => ({
          name: basename(row.path),
          path: row.path,
          branch: row.branch,
          dirty: row.changed,
          ahead: 0,
          behind: 0,
        }));
        // Ahead/behind is not in the summary; the root repo is the one worth
        // asking about, so pay for a single extra call there.
        const rootRepo = repoRows.find((row) => row.path === workspacePath);
        if (rootRepo) {
          try {
            const status = await ipc.gitStatus(workspacePath);
            rootRepo.ahead = status.ahead ?? 0;
            rootRepo.behind = status.behind ?? 0;
            rootRepo.branch = status.branch || rootRepo.branch;
          } catch {
            /* not a repo root — the summary above already said so */
          }
        }

        const lines = rules ? ruleLines(rules.content) : [];
        setData({
          loading: false,
          error: null,
          name: workspace?.name ?? basename(workspacePath),
          path: workspacePath,
          branch: rootRepo?.branch ?? "",
          sessions: mine.slice(0, 8),
          repos: repoRows,
          rules: { source: rules?.path ?? null, lines },
          memory: memory.map((file) => ({ path: file.path, summary: summarise(file.content) })),
          todos: todoRows,
          tasks: taskRows,
          skills,
          counts: {
            rules: lines.length,
            memory: memory.length,
            work: todoRows.left + taskRows.length,
            skills: skills.length,
            repos: repoRows.length,
            sessions: mine.length,
          },
        });
      } catch (error) {
        if (signal.cancelled) return;
        setData((current) => ({
          ...current,
          loading: false,
          error: "Не удалось прочитать проект: " + String(error),
        }));
      }
    },
    [workspacePath],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  return data;
}

/** Repositories to ask about: the project itself plus any nested repo that
 *  a session of this project ran in (this project's shape: plugins live in
 *  their own repositories inside the folder). */
function childPaths(sessions: SessionMeta[]): string[] {
  const paths = new Set<string>();
  for (const session of sessions) paths.add(session.workspacePath);
  return [...paths];
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

// ── to-dos and schedules: the same plugin stores the side panels read ──────
// Both plugins keep their data in the host key-value store under their own
// plugin id, so the overview can show them without talking to the plugins.

interface StoredTodo {
  id: string;
  workspacePath: string;
  parentId: string | null;
  text: string;
  done: boolean;
  order: number;
}

/** Read one key of another plugin's store: the to-do and schedule plugins
 *  keep their rows in the host key-value table under their own id, so the
 *  overview reads them directly instead of going through the plugins. */
async function pluginValue(pluginId: string, key: string): Promise<string | null> {
  try {
    const value = await ipc.pluginStorageGet(pluginId, key);
    if (value === null || value === undefined) return null;
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return null;
  }
}

async function readTodos(
  workspacePath: string,
): Promise<{ items: TodoRow[]; left: number }> {
  const index = await pluginValue("todo-lists", "todos.index");
  if (!index) return { items: [], left: 0 };
  let ids: string[] = [];
  try {
    ids = JSON.parse(index) as string[];
  } catch {
    return { items: [], left: 0 };
  }
  const items: StoredTodo[] = [];
  for (const id of ids) {
    const raw = await pluginValue("todo-lists", `todo.${id}`);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as StoredTodo;
      if (parsed && parsed.workspacePath === workspacePath) items.push(parsed);
    } catch {
      /* a corrupt row is skipped, not fatal */
    }
  }
  const sorted = items.sort((a, b) => a.order - b.order);
  const out: TodoRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const item of sorted) {
      if ((item.parentId ?? null) !== parentId) continue;
      out.push({ id: item.id, text: item.text, done: item.done, depth });
      walk(item.id, depth + 1);
    }
  };
  walk(null, 0);
  return { items: out.slice(0, 12), left: sorted.filter((item) => !item.done).length };
}

interface StoredTask {
  id: string;
  title: string;
  workspace?: string | null;
  enabled?: boolean;
  nextAt?: string | null;
}

async function readTasks(workspacePath: string): Promise<TaskRow[]> {
  const index = await pluginValue("scheduled-tasks", "tasks.index");
  if (!index) return [];
  let ids: string[] = [];
  try {
    ids = JSON.parse(index) as string[];
  } catch {
    return [];
  }
  const out: TaskRow[] = [];
  for (const id of ids) {
    const raw = await pluginValue("scheduled-tasks", `task.${id}`);
    if (!raw) continue;
    try {
      const task = JSON.parse(raw) as StoredTask;
      // Untargeted tasks run in the app's default folder, which is not this
      // project — only an explicit match counts.
      if (task.workspace !== workspacePath) continue;
      out.push({
        id: task.id,
        title: task.title,
        nextAt: task.nextAt ?? null,
        enabled: task.enabled !== false,
      });
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => String(a.nextAt ?? "").localeCompare(String(b.nextAt ?? "")));
}
