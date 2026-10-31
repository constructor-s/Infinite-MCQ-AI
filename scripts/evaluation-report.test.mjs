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
      { stage: 'decision', data: { accepted: true, issues: [] } }
    ] }, { id: 'two', status: 502, body: { error: { code: 'QUALITY_REJECTED' } } }];
    expect(summarizeResults(results)).toMatchObject({
      attempted: 2, accepted: 1, failed: 1, revisedItems: 1,
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

});
