import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectOverview, type ProjectOverviewData } from "./use-project-overview";

/**
 * Проектные навыки владельца лежат в `<проект>/.pi/skills` — этого пути нет в
 * списке самого приложения, поэтому обзор обязан смотреть и туда, иначе блок
 * «Навыки проекта» пропадает совсем (на это и жаловались 03.11.2026).
 */
const ROOT = "/ws/one";

const DIRS: Record<string, { name: string; isDir: boolean }[]> = {
  [`${ROOT}/.pi/skills`]: [
    { name: "ccgui-plugin-creator", isDir: true },
    { name: "README.md", isDir: false },
  ],
  [`${ROOT}/.claude/skills`]: [{ name: "club-style", isDir: true }],
  [`${ROOT}/.agents/skills`]: [{ name: "ccgui-plugin-creator", isDir: true }],
  [`${ROOT}/.operator`]: [{ name: "operator.md", isDir: false }],
};

vi.mock("@/lib/ipc", () => ({
  ipc: {
    listWorkspaces: vi.fn(async () => [
      { id: "w1", path: ROOT, name: "one", lastOpenedAt: null, sortOrder: 0, groupId: null },
    ]),
    listSessions: vi.fn(async () => []),
    listDir: vi.fn(async (path: string) => DIRS[path] ?? []),
    readFile: vi.fn(async () => ({ kind: "text", text: null, dataUrl: null, truncated: false })),
    gitRepositorySummaries: vi.fn(async () => []),
    gitStatus: vi.fn(async () => ({ branch: "", staged: [], unstaged: [], untracked: [] })),
    pluginStorageGet: vi.fn(async () => null),
  },
}));

let node: HTMLDivElement;
let root: Root;
let latest: ProjectOverviewData | null = null;

function Probe({ path }: { path: string }) {
  latest = useProjectOverview(path);
  return null;
}

/** Дождаться, пока загрузка данных закончится. */
async function settle() {
  for (let i = 0; i < 20 && latest?.loading; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  latest = null;
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});

describe("project overview skills", () => {
  it("reads the project's own skill folders, .pi/skills included", async () => {
    await act(async () => {
      root.render(<Probe path={ROOT} />);
    });
    await settle();
    const skills = latest?.skills ?? [];
    expect(skills.map((skill) => skill.name).sort()).toEqual([
      "ccgui-plugin-creator",
      "club-style",
    ]);
    expect(skills.find((skill) => skill.name === "club-style")?.root).toBe(".claude/skills");
    // Скилл, лежащий в двух папках, показывается один раз — за первым по старшинству.
    expect(skills.find((skill) => skill.name === "ccgui-plugin-creator")?.root).toBe(
      ".pi/skills",
    );
    // Файл рядом с папками навыков навыком не считается.
    expect(skills.some((skill) => skill.name === "README.md")).toBe(false);
    expect(latest?.counts.skills).toBe(2);
  });

  it("has no skills block to show when the project keeps none", async () => {
    await act(async () => {
      root.render(<Probe path="/ws/empty" />);
    });
    await settle();
    expect(latest?.skills).toEqual([]);
    expect(latest?.counts.skills).toBe(0);
  });
});
