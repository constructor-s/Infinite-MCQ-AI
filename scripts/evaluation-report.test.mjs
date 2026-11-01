import { describe, it, expect } from 'vitest';
import { reusableResults, summarizeResults } from './evaluation-report.mjs';

const evaluation = { version: 'review-v3', cases: [{ id: 'one', request: { model: 'selected' } }] };
const item = { id: 'one', assignment: { model: 'selected' }, status: 200, body: { promptVersion: 'new', correctOptionId: 'A', options: [{ id: 'A', text: 'An appropriately longer choice' }, { id: 'B', text: 'Another choice' }] } };

describe('offline evaluation reports', () => {
  it('does not reuse results from stale prompts, assignments, failed calls or missing traces', () => {
    const previous = { evaluationVersion: evaluation.version, promptVersion: 'new', results: [item, { ...item, id: 'failed', status: 502 }] };
    expect(reusableResults(previous, evaluation, 'new')).toEqual([item]);
    expect(reusableResults(previous, evaluation, 'old')).toEqual([]);
    expect(reusableResults(previous, evaluation, 'new', { direct: true })).toEqual([]);
    expect(reusableResults(previous, evaluation, 'new', { optionsOnly: true })).toEqual([]);
    expect(reusableResults(previous, { ...evaluation, cases: [{ id: 'one', request: { model: 'changed' } }] }, 'new')).toEqual([]);
  });

  it('preserves failure counts and reports length without changing acceptance', () => {
    const results = [{ ...item, trace: [
      { stage: 'candidate', round: 2, data: {} },
      { stage: 'decision', data: { accepted: false, issues: ['editorial.noAnswerGiveaways'] } },
      { stage: 'refinement', data: { changed: true, summary: 'Clarified the decisive case fact.' } },
      { stage: 'decision', data: { accepted: true, outcome: 'refined_changed', changed: true, refinementSummary: 'Clarified the decisive case fact.', issues: [] } }
    ] }, { id: 'two', status: 502, body: { error: { code: 'QUALITY_REJECTED' } } }];
    expect(summarizeResults(results)).toMatchObject({
      attempted: 2, accepted: 1, failed: 1, revisedItems: 1, initialRepairItems: 1, refinementPasses: 1,
      refinementSummaries: [{ id: 'one', outcome: 'refined_changed', changed: true, summary: 'Clarified the decisive case fact.' }],
      correctionRequests: { 'editorial.noAnswerGiveaways': 1 },
      lengthSignals: [{ id: 'one', uniquelyLongestKey: true }]
    });
  });
  it('separates best-effort warnings and advisories from actual request failures', () => {
    const results = [{ ...item, trace: [{ stage: 'decision', data: {
      accepted: true, outcome: 'unchanged', reviewIncomplete: true,
      reviewFailures: ['clinical.INVALID_REVIEW'], advisories: ['A minor wording suggestion.'], issues: []
    } }] }];
    expect(summarizeResults(results)).toMatchObject({
      accepted: 1, failed: 0, deliveryOutcomes: { unchanged: 1 },
      reviewIncompleteItems: 1, advisoryItems: 1, reviewFailures: { 'clinical.INVALID_REVIEW': 1 }, correctionRequests: {}
    });
  });

  it('reports the enforced median threshold separately from a uniquely longest key', () => {
    const words = (count) => Array(count).fill('word').join(' ');
    const row = { ...item, body: { ...item.body, options: [11, 2, 9, 11, 30].map((count, i) => ({ id: 'ABCDE'[i], text: words(count) })) } };
    expect(summarizeResults([row]).lengthSignals[0]).toMatchObject({ correctWords: 11, distractorMedianWords: 10, exceedsLengthLimit: false });
    row.body.options[0].text = words(12);
    expect(summarizeResults([row]).lengthSignals[0]).toMatchObject({ correctWords: 12, distractorMedianWords: 10, exceedsLengthLimit: true, uniquelyLongestKey: false });
  });

  it('does not count a preserved refinement or a failed refinement as changed content', () => {
    const rows = [
      { ...item, trace: [{ stage: 'refinement', data: { changed: false, summary: 'Preserved after considering both reviews.' } },
        { stage: 'decision', data: { accepted: true, outcome: 'refined_unchanged', changed: false, refinementSummary: 'Preserved after considering both reviews.' } }] },
      { ...item, id: 'fallback', trace: [{ stage: 'refinement', data: { unavailable: true, changed: false } },
        { stage: 'decision', data: { accepted: true, outcome: 'fallback' } }] }
    ];
    expect(summarizeResults(rows)).toMatchObject({
      revisedItems: 0, initialRepairItems: 0, refinementPasses: 2,
      deliveryOutcomes: { refined_unchanged: 1, fallback: 1 }
    });
  });

  it('reports deterministic core changes and provider metrics without requiring a model summary', () => {
    const usage = { promptTokenCount: 100, candidatesTokenCount: 80, thoughtsTokenCount: 200 };
    const row = { ...item, durationMs: 1250, trace: [
      { stage: 'call', data: { stage: 'candidate', call: 1, durationMs: 400, usage } },
      { stage: 'decision', data: { accepted: true, outcome: 'refined_changed', changed: true, changedFields: ['correctAnswer', 'distractors'] } }
    ] };
    expect(summarizeResults([row])).toMatchObject({ refinementSummaries: [],
      refinementChanges: [{ id: 'one', changed: true, fields: ['correctAnswer', 'distractors'] }],
      timings: [{ id: 'one', durationMs: 1250, calls: [{ stage: 'candidate', durationMs: 400, usage }] }] });
  });

});
