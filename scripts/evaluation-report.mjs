// Pure report helpers shared by the finite evaluator and offline regression tests.
export function reusableResults(previous, evaluation, promptVersion, { optionsOnly = false, direct = false } = {}) {
  if (previous?.evaluationVersion !== evaluation.version || previous?.promptVersion !== promptVersion) return [];
  return previous.results.filter((result) => result.status === 200 && result.body?.promptVersion === promptVersion &&
    (!optionsOnly || result.optionsOnly) && (!direct || Array.isArray(result.trace)) &&
    evaluation.cases.some((item) => item.id === result.id && JSON.stringify(item.request) === JSON.stringify(result.assignment)));
}

export function summarizeResults(results) {
  const accepted = results.filter((r) => r.status === 200);
  const decisions = results.flatMap((r) => (r.trace ?? []).filter((e) => e.stage === "decision"));
  const correctionRequests = {};
  for (const event of decisions) for (const issue of event.data.issues ?? []) correctionRequests[issue] = (correctionRequests[issue] ?? 0) + 1;
  const deliveryOutcomes = {};
  const reviewFailures = {};
  let reviewIncompleteItems = 0;
  let advisoryItems = 0;
  for (const result of results) {
    const finalDecision = (result.trace ?? []).filter((e) => e.stage === "decision").at(-1)?.data;
    if (!finalDecision) continue;
    if (finalDecision.accepted && finalDecision.outcome) deliveryOutcomes[finalDecision.outcome] = (deliveryOutcomes[finalDecision.outcome] ?? 0) + 1;
    if (finalDecision.reviewIncomplete) reviewIncompleteItems += 1;
    if (finalDecision.advisories?.length) advisoryItems += 1;
    for (const failure of finalDecision.reviewFailures ?? []) reviewFailures[failure] = (reviewFailures[failure] ?? 0) + 1;
  }
  const lengthSignals = accepted.map((r) => {
    const lengths = r.body.options.map((o) => ({ id: o.id, words: o.text.trim().split(/\s+/).length }));
    const maximum = Math.max(...lengths.map((o) => o.words));
    const longest = lengths.filter((o) => o.words === maximum);
    return { id: r.id, uniquelyLongestKey: longest.length === 1 && longest[0].id === r.body.correctOptionId };
  });
  return {
    attempted: results.length, accepted: accepted.length, failed: results.length - accepted.length,
    revisedItems: results.filter((r) => (r.trace ?? []).some((e) => e.stage === "candidate" && e.round > 1)).length,
    correctionRequests, deliveryOutcomes, reviewIncompleteItems, advisoryItems, reviewFailures, lengthSignals, note: "Length and options-only signals are diagnostic, not automatic rejection rules."
  };
}
