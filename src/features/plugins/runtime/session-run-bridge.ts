import { listenEngineEvents, type EngineEventPayload } from "@/lib/events";
import { markPluginOwnedSession } from "./owned-sessions";
import { pluginBus } from "./events";

/**
 * 插件发起的「聊天会话轮次」宿主实现（SDK 0.3.18，权限 host:session）。
 *
 * 与 `ctx.agent.start`（插件自有后台轮次，事件只回插件）的分工：
 * 这里把轮次交给宿主聊天管线跑——会话立刻进侧栏（带运行中状态）、打开就是
 * 实时流式输出、聊天里的停止按钮照常可用，插件的模型/强度/渠道选择通过
 * per-tab 覆盖传递（不改用户的全局默认）。
 *
 * 回执：轮次终止时把 `{ runId, sessionId, engine, workspacePath, kind, error }`
 * emit 到 `plugin-run://<pluginId>` 总线话题，插件据此收尾自己的任务表。
 *
 * 独立成模块而不是内联进 context.ts：会话管线依赖链重（chat store / 引擎
 * 事件流），runtime/context 的单测只 mock 本模块（workspace-bridge 同款理由）。
 */

export interface PluginChatRunDef {
  engine: string;
  prompt: string;
  workspacePath: string;
  model?: string | null;
  effort?: string | null;
  providerId?: string | null;
}

export interface PluginChatRunHandle {
  runId: string;
  sessionId: string | null;
}

interface RunRecord {
  pluginId: string;
  engine: string;
  workspacePath: string;
  sessionId: string | null;
}

/** runId → 属主插件与工作区；只在轮次存活期间有记录。 */
const runs = new Map<string, RunRecord>();

/** 终止事件里的原因文本（data 形状由引擎定义，逐种兜底）。 */
function errorTextOf(event: EngineEventPayload): string | null {
  const data = event.data as unknown;
  if (typeof data === "string" && data) return data;
  if (data && typeof data === "object") {
    for (const key of ["message", "error", "text"] as const) {
      const value = (data as Record<string, unknown>)[key];
      if (typeof value === "string" && value) return value;
    }
  }
  return null;
}

let bridged = false;
let stateWatched = false;

/**
 * 会话状态旁路：插件看不到宿主会话的「正在跑 / 停在用户身上」，
 * 而侧栏红点用的就是同一份状态（chat store 的 streamingByKey / waitingByKey）。
 * 这里把它转给发起轮次的插件：`kind: "state"`，state 为 "running" | "waiting" | null。
 * 只在状态真的翻转时发一次，不跟每一条流式增量。
 */
function ensureRunStateWatch(): void {
  if (stateWatched) return;
  stateWatched = true;
  void import("@/features/chat/store").then((chat) => {
    // 单测会把这个模块换成桩；没有 subscribe 就安静退出。
    if (typeof chat.useChatStore?.subscribe !== "function") return;
    const last = new Map<string, string>();
    chat.useChatStore.subscribe((state) => {
      for (const [runId, record] of runs) {
        const key = ownedSessionKey(record.engine, record.sessionId ?? "", record.workspacePath);
        const next =
          state.waitingByKey[key] === true
            ? "waiting"
            : state.streamingByKey[key] === true
              ? "running"
              : "";
        if (last.get(runId) === next) continue;
        last.set(runId, next);
        pluginBus.emit(`plugin-run://${record.pluginId}`, {
          runId,
          sessionId: record.sessionId,
          engine: record.engine,
          workspacePath: record.workspacePath,
          kind: "state",
          state: next === "" ? null : next,
          error: null,
        });
      }
    });
  });
}

/** 会话键，和 chat store 的 `sessionKey()` 同一套写法（那里带着侧栏的语义，
 *  这里只需要一致；单独写是为了不让插件运行时静态依赖聊天 store）。 */
function ownedSessionKey(engine: string, sessionId: string, workspacePath: string): string {
  return sessionId ? `${engine}/${sessionId}` : `new:${engine}:${workspacePath}`;
}

/** 会话 id 一学到就记下来：它属于插件，不进用户的侧栏列表。 */
function rememberSession(record: RunRecord, sessionId: string | null): void {
  if (!sessionId) return;
  markPluginOwnedSession(ownedSessionKey(record.engine, sessionId, record.workspacePath));
}

/** 一次绑定的引擎事件旁路：只转发属于插件轮次的终态。 */
function ensureRunBridge(): void {
  if (bridged) return;
  bridged = true;
  void listenEngineEvents((events) => {
    for (const event of events) {
      const record = runs.get(event.runId);
      if (!record) continue;
      // 原生 session id 常常不在 spawn 返回里，而是随首个事件 announce。
      // 一学到就转给插件：它的「打开会话」按钮依赖这个 id。
      if (event.sessionId && !record.sessionId) {
        record.sessionId = event.sessionId;
        rememberSession(record, event.sessionId);
        pluginBus.emit(`plugin-run://${record.pluginId}`, {
          runId: event.runId,
          sessionId: event.sessionId,
          engine: record.engine,
          workspacePath: record.workspacePath,
          kind: "session",
          error: null,
        });
      }
      if (event.kind !== "done" && event.kind !== "error") continue;
      runs.delete(event.runId);
      pluginBus.emit(`plugin-run://${record.pluginId}`, {
        runId: event.runId,
        sessionId: event.sessionId ?? record.sessionId,
        engine: record.engine,
        workspacePath: record.workspacePath,
        kind: event.kind,
        error: event.kind === "error" ? errorTextOf(event) : null,
      });
    }
  });
}

export async function startPluginChatRun(
  pluginId: string,
  def: PluginChatRunDef,
): Promise<PluginChatRunHandle> {
  const engine = def.engine?.trim();
  const prompt = def.prompt?.trim();
  const workspacePath = def.workspacePath?.trim();
  if (!engine) throw new Error(`invalid_args: ${pluginId} sessions.startRun: empty engine`);
  if (!prompt) throw new Error(`invalid_args: ${pluginId} sessions.startRun: empty prompt`);
  if (!workspacePath) {
    throw new Error(`invalid_args: ${pluginId} sessions.startRun: empty workspacePath`);
  }
  ensureRunBridge();

  // 动态引入：chat store 依赖链重，且本模块被 context.ts 静态引用。
  const chat = await import("@/features/chat/store");
  const store = chat.useChatStore.getState();
  const target = {
    engine,
    sessionId: null,
    workspacePath,
    ...(def.model ? { model: def.model } : {}),
    ...(def.effort ? { effort: def.effort as never } : {}),
    ...(def.providerId ? { provider: def.providerId } : {}),
  };
  let handle: PluginChatRunHandle | null = null;
  try {
    // send 走宿主聊天发送路径：会话进侧栏、流式进 bySession、可停。
    await store.send(prompt, [], {
      onStarted: (info) => {
        handle = info;
        const record: RunRecord = { pluginId, engine, workspacePath, sessionId: info.sessionId };
        runs.set(info.runId, record);
        ensureRunStateWatch();
        rememberSession(record, info.sessionId);
        // started 先于 send 返回发出：插件在 startRun resolve 前就能把轮次
        // 认领到自己的任务上，之后不会漏掉紧跟的 done/error。
        pluginBus.emit(`plugin-run://${pluginId}`, {
          runId: info.runId,
          sessionId: info.sessionId,
          engine,
          workspacePath,
          kind: "started",
          error: null,
        });
      },
    }, target);
  } catch (error) {
    if (handle) runs.delete((handle as PluginChatRunHandle).runId);
    throw error;
  }
  if (!handle) {
    // 理论上不可达：send 成功返回时 onStarted 已经跑过。
    throw new Error(`${pluginId}: host did not report the run identity`);
  }
  return handle;
}

export async function interruptPluginChatRun(
  pluginId: string,
  def: { engine: string; workspacePath: string; sessionId?: string | null },
): Promise<void> {
  const engine = def.engine?.trim();
  const workspacePath = def.workspacePath?.trim();
  if (!engine || !workspacePath) {
    throw new Error(`invalid_args: ${pluginId} sessions.interruptRun: engine and workspacePath are required`);
  }
  // Ownership gate: the store's interrupt is session-scoped, so forwarding
  // blindly would let any plugin with host:session stop the user's or a
  // sibling plugin's turn. Only a live run this plugin started may be
  // stopped. `sessionId: null` matches any live run of this plugin in the
  // scope because the native id is often announced after startRun resolves.
  const sessionId = def.sessionId ?? null;
  const owned = [...runs.values()].some(
    (record) =>
      record.pluginId === pluginId &&
      record.engine === engine &&
      record.workspacePath === workspacePath &&
      (sessionId === null || record.sessionId === sessionId),
  );
  if (!owned) {
    throw new Error(
      `${pluginId}: sessions.interruptRun may only stop a run started by this plugin`,
    );
  }
  const chat = await import("@/features/chat/store");
  // 等价于聊天里的停止：sessionId 未知（尚未 announce）时按待发键停，
  // 与聊天栏在 spawn 前就能点停止是同一条路径。
  await chat.useChatStore.getState().interrupt({
    engine,
    sessionId: def.sessionId ?? null,
    workspacePath,
  });
}
