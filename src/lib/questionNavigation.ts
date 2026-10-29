export type HistoryAction = "push" | "replace";
export type QuestionRoute = { kind: "home" } | { kind: "question"; questionId: string } | { kind: "unavailable" };

export function questionUrl(questionId: string): string {
  return `/questions/${encodeURIComponent(questionId)}`;
}

export function parseQuestionRoute(pathname: string): QuestionRoute {
  if (pathname === "/") return { kind: "home" };
  const match = /^\/questions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(pathname);
  return match ? { kind: "question", questionId: match[1].toLowerCase() } : { kind: "unavailable" };
}

export function historyEncounterId(state: unknown): string | undefined {
  if (state && typeof state === "object" && "iworldEncounterId" in state && typeof state.iworldEncounterId === "string") {
    return state.iworldEncounterId;
  }
}

export function writeQuestionHistory(action: HistoryAction, questionId: string, encounterId: string): void {
  const state = action === "replace" && history.state && typeof history.state === "object" ? history.state : {};
  history[action === "push" ? "pushState" : "replaceState"](
    { ...state, iworldEncounterId: encounterId }, "", questionUrl(questionId)
  );
}
