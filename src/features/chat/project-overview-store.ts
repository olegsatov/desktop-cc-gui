/**
 * Per-project layout of the overview page: the order of its blocks and which
 * of them are folded. Persisted in localStorage beside the panel stack, per
 * workspace path, so the page comes back the way it was left.
 */

import { readStoredJson, writeStored } from "@/lib/storage";

/** Block ids the overview knows; unknown ids are dropped on read. */
const KNOWN = ["rules", "memory", "todos", "tasks", "skills", "repos"] as const;
export type OverviewBlockId = (typeof KNOWN)[number];

const KNOWN_IDS = new Set<string>(KNOWN);

const OVERVIEW_KEY_PREFIX = "ccgui-next.projectOverview:v1:";
/** Default order: agreements first, housekeeping last. */
export const DEFAULT_OVERVIEW_ORDER: OverviewBlockId[] = [
  "rules",
  "memory",
  "todos",
  "tasks",
  "skills",
  "repos",
];

export interface ProjectOverviewLayout {
  order: OverviewBlockId[];
  folded: Record<string, boolean>;
}

const DEFAULT_LAYOUT: ProjectOverviewLayout = {
  order: [...DEFAULT_OVERVIEW_ORDER],
  folded: {},
};

function keyFor(workspacePath: string): string {
  return `${OVERVIEW_KEY_PREFIX}${workspacePath}`;
}

/** Read the saved layout, falling back to the default order. */
export function readProjectOverview(workspacePath: string): ProjectOverviewLayout {
  const parsed = readStoredJson<ProjectOverviewLayout>(keyFor(workspacePath), (value) => {
    if (typeof value !== "object" || value === null) return null;
    const record = value as { order?: unknown; folded?: unknown };
    const order = Array.isArray(record.order)
      ? record.order.filter(
          (id): id is OverviewBlockId => typeof id === "string" && KNOWN_IDS.has(id),
        )
      : [];
    const folded: Record<string, boolean> = {};
    if (typeof record.folded === "object" && record.folded !== null) {
      for (const [id, flag] of Object.entries(record.folded)) {
        if (KNOWN_IDS.has(id) && flag === true) folded[id] = true;
      }
    }
    return { order, folded };
  });
  if (!parsed) return { ...DEFAULT_LAYOUT, order: [...DEFAULT_LAYOUT.order] };
  return parsed;
}

export function saveProjectOverview(
  workspacePath: string,
  layout: ProjectOverviewLayout,
): void {
  writeStored(keyFor(workspacePath), JSON.stringify(layout));
}
