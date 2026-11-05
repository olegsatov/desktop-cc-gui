/**
 * Sessions stopped on the user (sidebar red dot).
 *
 * Three things count as "the user has to answer": an unanswered ask card, a
 * plan card still waiting for approval, and a grant card still waiting for a
 * decision. All three live in the session timeline (bySession[key].messages),
 * and the sidebar must not scan messages — it sits outside the per-token
 * update path on purpose. So the answer is mirrored into one flat map,
 * `waitingByKey`, the same way streamingByKey / retryingByKey are: written
 * only when the flag flips.
 */
import type { Message } from "@/lib/ipc";
import { PLAN_REVIEW_ROLE, isPlanActionable } from "./plan-review";
import type { ChatStore } from "./types";

/** Whether the session is stopped on the user: an unanswered question, a plan
 *  awaiting approval, or a pending grant. */
export function hasPendingAsk(messages: Message[]): boolean {
  for (const message of messages) {
    if (message.role === "question" && message.question?.status === "pending") {
      return true;
    }
    if (message.role === "grant" && message.grant?.status === "pending") {
      return true;
    }
    if (
      message.role === PLAN_REVIEW_ROLE &&
      message.planReview &&
      isPlanActionable(message.planReview.status)
    ) {
      return true;
    }
  }
  return false;
}

/** The waitingByKey patch for one session's new message list; empty when the
 *  flag did not flip, so callers can spread it into their own store patch. */
export function waitingPatch(
  s: ChatStore,
  key: string,
  messages: Message[],
): Partial<ChatStore> {
  const waiting = hasPendingAsk(messages);
  // Часть тестов приложения собирает состояние без наших полей: нет карты —
  // значит, ничего и не ждёт.
  const known = s.waitingByKey ?? {};
  if ((known[key] === true) === waiting) return {};
  const next = { ...known };
  if (waiting) next[key] = true;
  else delete next[key];
  return { waitingByKey: next };
}
