import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/ipc";
import { useChatStore } from "./store";
import { PLAN_REVIEW_ROLE } from "./store/plan-review";
import { hasPendingAsk, waitingPatch } from "./store/waiting";

const KEY = "claude/s-1";

function row(role: string, extra: Partial<Message> = {}): Message {
  return { seq: 1, role, text: "", ts: null, ...extra };
}

function questionRow(status: "pending" | "answered" | "cancelled"): Message {
  return row("question", {
    question: {
      requestId: "req-1",
      runId: "run-1",
      toolUseId: null,
      questions: [],
      status,
    },
  });
}

function grantRow(status: "pending" | "granted" | "declined"): Message {
  return row("grant", { path: "/tmp/x", grant: { status } });
}

function planRow(status: string): Message {
  return row(PLAN_REVIEW_ROLE, {
    planReview: { planId: "p-1", revision: 1, status } as never,
  });
}

describe("hasPendingAsk", () => {
  it("is false for an ordinary timeline", () => {
    expect(hasPendingAsk([row("user"), row("assistant"), row("tool")])).toBe(false);
  });

  it("is true while a question card waits for an answer", () => {
    expect(hasPendingAsk([questionRow("pending")])).toBe(true);
    expect(hasPendingAsk([questionRow("answered")])).toBe(false);
    expect(hasPendingAsk([questionRow("cancelled")])).toBe(false);
  });

  it("is true while a grant card waits for a decision", () => {
    expect(hasPendingAsk([grantRow("pending")])).toBe(true);
    expect(hasPendingAsk([grantRow("granted")])).toBe(false);
    expect(hasPendingAsk([grantRow("declined")])).toBe(false);
  });

  it("is true while a plan card waits for approval", () => {
    expect(hasPendingAsk([planRow("awaiting_review")])).toBe(true);
    expect(hasPendingAsk([planRow("deferred")])).toBe(true);
    expect(hasPendingAsk([planRow("approved")])).toBe(false);
    expect(hasPendingAsk([planRow("changes_requested")])).toBe(false);
    // A draft is not yet a decision the user has to make.
    expect(hasPendingAsk([planRow("draft")])).toBe(false);
  });

  it("is true when any one row waits, even next to answered rows", () => {
    expect(
      hasPendingAsk([questionRow("answered"), row("assistant"), grantRow("pending")]),
    ).toBe(true);
  });
});

describe("waitingPatch", () => {
  it("sets the flag when a row starts waiting", () => {
    useChatStore.setState({ waitingByKey: {} });
    expect(waitingPatch(useChatStore.getState(), KEY, [questionRow("pending")])).toEqual({
      waitingByKey: { [KEY]: true },
    });
  });

  it("clears the flag once nothing waits", () => {
    useChatStore.setState({ waitingByKey: { [KEY]: true } });
    expect(waitingPatch(useChatStore.getState(), KEY, [questionRow("answered")])).toEqual({
      waitingByKey: {},
    });
  });

  it("is empty when the flag did not flip, so the store write is skipped", () => {
    useChatStore.setState({ waitingByKey: { [KEY]: true } });
    expect(waitingPatch(useChatStore.getState(), KEY, [grantRow("pending")])).toEqual({});
    useChatStore.setState({ waitingByKey: {} });
    expect(waitingPatch(useChatStore.getState(), KEY, [row("assistant")])).toEqual({});
  });
});
