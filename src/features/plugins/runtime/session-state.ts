import { pluginBus, SESSION_STATE_TOPIC } from "./events";
import { resolveSessionTarget } from "./session-attention";
import type { ChatStore } from "@/features/chat/store/types";

/**
 * 会话状态旁路：把侧栏/页签那三个状态点（蓝色呼吸 = 正在跑、红色 =
 * 停在用户身上、绿色 = 结果没看过）转成总线话题 `session://state`。
 *
 * 为什么不是 `plugin-run://<pluginId>` 那一份：那个只认「插件自己发起、
 * 而且还在跑」的轮次（见 session-run-bridge.ts）。用户在插件起的会话里
 * 自己打字、或者轮次早就结束，插件就什么都收不到——面板上的任务行因此
 * 一颗点都不亮，而左边列表里同样的会话是亮的。这里说的是同一份状态，
 * 只是不管会话是谁起的、也不管轮次是否还活着。
 *
 * 载荷是整幅画面（只有非空闲的会话），不是单个翻转：插件晚加载时，
 * 保留话题会把这幅画面原样重放，绿色点不会因为一次热重载就消失。
 */

export type SessionLiveState = "running" | "waiting" | "unseen";

export interface SessionStateRow {
  /** 与 chat store 的 `sessionKey()` 同一套写法。 */
  key: string;
  engine: string;
  sessionId: string | null;
  workspacePath: string;
  state: SessionLiveState;
}

export interface SessionStatePayload {
  sessions: SessionStateRow[];
}

let bridged = false;
/** 上一次上总线的画面（按行比较，没变就不发）。 */
let lastSent = "";
/** 上一次非空闲的会话：有了它才知道哪个会话「不亮了」，要把新画面发出去。 */
const known = new Set<string>();

/** 一个会话的状态；和侧栏同一个优先级：先「停着等用户」，再「在跑」，
 *  最后「结束了没看过」。空闲（没有点）返回 null。 */
function liveStateOf(state: ChatStore, key: string): SessionLiveState | null {
  if (state.waitingByKey?.[key] === true) return "waiting";
  if (state.streamingByKey?.[key] === true) return "running";
  if (state.unseen?.[key] === true) return "unseen";
  return null;
}

function watchStates(state: ChatStore): void {
  const keys = new Set<string>([
    ...known,
    ...Object.keys(state.waitingByKey ?? {}),
    ...Object.keys(state.streamingByKey ?? {}),
    ...Object.keys(state.unseen ?? {}),
  ]);
  const rows: SessionStateRow[] = [];
  const next = new Set<string>();
  // 顺序固定：同一份画面永远编成同一个字符串，好做比较。
  for (const key of [...keys].sort()) {
    const live = liveStateOf(state, key);
    if (!live) continue;
    const target = resolveSessionTarget(state, key);
    if (!target) continue;
    next.add(key);
    rows.push({ key, ...target, state: live });
  }
  const serialized = JSON.stringify(rows);
  if (serialized === lastSent) return;
  lastSent = serialized;
  known.clear();
  for (const key of next) known.add(key);
  pluginBus.emit(SESSION_STATE_TOPIC, { sessions: rows } satisfies SessionStatePayload);
}

/**
 * 绑定一次（插件引导时调用，和 bridgeUsageEvents / bridgeSessionAttention
 * 同一处）。宿主 store 的每次写入都会走一遍比对，但只有画面变了才上总线。
 */
export function bridgeSessionState(): void {
  if (bridged) return;
  bridged = true;
  void import("@/features/chat/store").then((chat) => {
    // 单测把 chat store 换成桩：没有 subscribe 就安静退出。
    if (typeof chat.useChatStore?.subscribe !== "function") return;
    chat.useChatStore.subscribe((state) => watchStates(state));
  });
}

/** 单测用：解绑标志与记忆（话题本身由 pluginBus 的重置清理）。 */
export function resetSessionStateForTests(): void {
  bridged = false;
  lastSent = "";
  known.clear();
}

/** 单测用：直接喂一份 store 状态，不必真的 import chat store。 */
export function feedSessionStateForTests(state: ChatStore): void {
  watchStates(state);
}
