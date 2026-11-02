import { pluginBus } from "./events";
import type { ChatStore } from "@/features/chat/store/types";

/**
 * 「会话停在用户身上」旁路（侧栏红点的同一份状态）。
 *
 * 红点读的是 chat store 的 `waitingByKey`（未回答的提问卡 / 待批准的方案卡 /
 * 待决定的授权卡），插件看不到这份状态：它既不在 SDK 里，也不在事件总线
 * 上。这里把翻转转成总线话题 `session://attention`，插件（系统通知、面板
 * 徽标等）据此知道「这个会话停下了，等你说句话」。
 *
 * 只在真的翻转时发一次（和 `waitingByKey` 的写入时机一致），不跟每一次流式
 * 更新；`waiting: false` 表示用户已经答了。
 */

/** 话题：`{ key, engine, sessionId, workspacePath, waiting }`。 */
export const SESSION_ATTENTION_TOPIC = "session://attention";

export interface SessionAttentionPayload {
  /** 与 chat store 的 `sessionKey()` 同一套写法。 */
  key: string;
  engine: string;
  sessionId: string | null;
  workspacePath: string;
  /** true = 停下了等用户；false = 用户已经答了。 */
  waiting: boolean;
}

/** 会话 key → 引擎 / 原生编号 / 工作区：key 自己带着前两项，工作区要从
 *  打开着的页签或会话表中找（`session://attention` 的消费者需要人读的
 *  项目名）。`session://state` 用同一套解析，导出给那边复用。 */
export function resolveSessionTarget(
  state: ChatStore,
  key: string,
): { engine: string; sessionId: string | null; workspacePath: string } | null {
  if (key.startsWith("new:")) {
    const rest = key.slice(4);
    const sep = rest.indexOf(":");
    if (sep <= 0) return null;
    return { engine: rest.slice(0, sep), sessionId: null, workspacePath: rest.slice(sep + 1) };
  }
  const slash = key.indexOf("/");
  if (slash <= 0) return null;
  const engine = key.slice(0, slash);
  const sessionId = key.slice(slash + 1);
  if (!sessionId) return null;
  const tab = state.openTabs?.find((t) => t.engine === engine && t.sessionId === sessionId);
  if (tab?.workspacePath) return { engine, sessionId, workspacePath: tab.workspacePath };
  const meta = state.sessions?.find((s) => s.engine === engine && s.sessionId === sessionId);
  return { engine, sessionId, workspacePath: meta?.workspacePath ?? "" };
}

let bridged = false;
/** 每个会话上一次的等待状态；只在翻转时上总线。 */
const lastWaiting = new Map<string, boolean>();

function watchWaiting(state: ChatStore): void {
  const waiting = state.waitingByKey ?? {};
  const keys = new Set<string>([...lastWaiting.keys(), ...Object.keys(waiting)]);
  for (const key of keys) {
    const now = waiting[key] === true;
    const before = lastWaiting.get(key) === true;
    if (before === now) continue;
    if (now) lastWaiting.set(key, true);
    else lastWaiting.delete(key);
    const target = resolveSessionTarget(state, key);
    if (!target) continue;
    const payload: SessionAttentionPayload = { key, ...target, waiting: now };
    pluginBus.emit(SESSION_ATTENTION_TOPIC, payload);
  }
}

/**
 * 绑定一次（插件引导时调用，和 bridgeUsageEvents 同一处）。宿主 store 的
 * 每次写入都会走一遍比对，但只有翻转才上总线——等待状态本来就不跟流式
 * 更新走。
 */
export function bridgeSessionAttention(): void {
  if (bridged) return;
  bridged = true;
  void import("@/features/chat/store").then((chat) => {
    // 单测把 chat store 换成桩：没有 subscribe 就安静退出。
    if (typeof chat.useChatStore?.subscribe !== "function") return;
    chat.useChatStore.subscribe((state) => watchWaiting(state));
  });
}

/** 单测用：解绑标志与记忆（话题本身由 pluginBus 的重置清理）。 */
export function resetSessionAttentionForTests(): void {
  bridged = false;
  lastWaiting.clear();
}

/** 单测用：直接喂一份 store 状态，不必真的 import chat store。 */
export function feedSessionAttentionStateForTests(state: ChatStore): void {
  watchWaiting(state);
}
