# Generation evaluation — October 16, 2026

Implemented sampling and prompt validation were checked separately from generated clinical content. The final automated run passed 63 tests, typecheck and production build. Two seeded simulations each generated 10,000 selections, checked every complete 200-question window, and reached all 198 objectives. Activity/care weights stayed within ±5 percentage points and each discipline stayed within five points of 1/6. Separate tests covered uneven objective abundance and adaptive objective selection.

The local API generated 12 held-out items covering six disciplines, four activities and four care dimensions using Gemini 3.5 Flash-Lite. All 12 returned valid tagged paragraph questions. An agent manually reviewed stems, options, rationales and pearls. This review found the limitations below; the content and application-authored crosswalk still require clinical review.

| Held-out assignment | Review finding |
| --- | --- |
| Medicine / acute / laboratory interpretation | Laboratory pattern and selected answer aligned. A three-week presentation left the acute/chronic distinction less clear than requested. |
| Surgery / acute / procedural intervention | Task aligned. Open versus laparoscopic options and a 12-hour conservative trial left the best intervention ambiguous; the pearl referred to 24–48 hours. |
| Pediatrics / chronic / history priorities | Additional hearing history was a reasonable diagnostic priority; the item used history options rather than treatment options. |
| OBGYN / prevention / informed-consent discussion | Tested discussion of screening benefits, limitations and alternatives. Several distractors were too obviously inappropriate. |
| Psychiatry / psychosocial / capacity and consent | Tested decision-specific capacity and adapted communication. The vignette could be shorter. |
| PHELO / prevention / statistical interpretation | The PPV calculation and answer were correct. The pearl incorrectly described PPV and NPV as varying in the same direction with prevalence. |
| Medicine / chronic / counselling | Tested an explanation of atopy and avoidance of unverified dietary restrictions. Distractors were relatively easy. |
| Surgery / acute / difficult news | The selected response supported continued care; another response was also plausibly empathic, reducing single-best-answer clarity. |
| Pediatrics / psychosocial / health literacy | Tested teach-back/show-me in the presence of language and literacy barriers. |
| OBGYN / acute / treatment choice | Isolated an antenatal-treatment decision with a distinguishable answer. Some clinical detail was unnecessary. |
| Psychiatry / psychosocial / diagnostic criteria | Used symptom count, duration and impairment to distinguish depression from an adjustment response. |
| PHELO / prevention / Canadian obligations | Stem specified Ontario and tested adverse-event reporting. The explanation generalized beyond the stated jurisdiction. |

Earlier iterations exposed a procedure forced into a scenario requiring medical treatment, history questions requesting facts already supplied, nearly identical rounding distractors, and a stray “mock chart” reference. Changes from these reviews include:

- Explicit task instructions to choose a scenario where the assigned decision is clinically indicated, distinguish concurrent treatments and operative approaches, and keep historical answers out of the vignette.
- Stronger acute-care framing, scope limits for legal details, statistical definitions and opposing PPV/NPV prevalence directions, and distinct communication distractors.
- Rejection of mock-chart artifacts, markup, changed blueprint tags and explanations that explicitly justify forcing an answer to fit the assigned task.
- Source import preserving nested enabling-objective context instead of isolated child fragments.

The last three task-instruction additions were informed by this review and have automated validation; they have not undergone another independent clinical evaluation. Deterministic rules cannot resolve all of the clinical or semantic issues recorded above. No second model reviewer runs during normal generation.

Reproduce the evaluation with `node scripts/evaluate-generation.mjs https://localhost:5173 /tmp/iworld-generation-evaluation.json`. The script resumes successful saved requests and accepts an optional comma-separated list of case IDs as its third argument. It consumes configured Gemini quota and leaves a JSON artifact for review. The rubric and requests live in `curriculum/evaluation.json`; `curriculum/practice-calibration.json` records structural observations for all 55 supplied official examples without reproducing them.

Browser automation was unavailable because no browser was connected. Component tests verified paragraph rendering, hints, answer disclosure, explanations and Next controls. Keyboard and scrolling handlers were unchanged.


## Prompt v3 evaluation — October 26, 2026

The prompt now defines the graduating-student MCCQE target, requires one best answer and four distractors including a strong alternative, and asks for an explicit distinguishing explanation and an internal ambiguity check. Difficulty 3 remains an intended target, not a measured difficulty. The evaluation rubric was advanced to v2 to prevent reuse of the earlier sample.

Validation passed all 83 tests and the production build (including TypeScript). A fresh live run using Gemini 3.5 Flash-Lite returned 12/12 HTTP 200 responses across all six disciplines and 12 cognitive tasks. All items carried prompt version `mccqe-paragraph-v3`, five choices and a single correct-option identifier. The local artifact is `/tmp/iworld-mccqe-v3-evaluation.json`; it is temporary and is not committed. Reproduce with the evaluation command above using a fresh output path and a configured local server.

An agent inspected the generated cases, options, hints and explanations against the revised rubric. This was a qualitative prompt-adherence review, not independent clinical validation or a measured difficulty study. Findings:

| Held-out assignment | Prompt-adherence finding |
| --- | --- |
| Medicine / laboratory interpretation | Contains a plausible competing cause with a stated discriminator, but describes a “45-week-old” patient who reports her own history. Fails internal coherence. |
| Surgery / procedural intervention | Contrasts operative intervention with a conservative trial using explicit imaging findings; hints disclose the distinguishing finding. |
| Pediatrics / history priorities | Tests developmental trajectory, but the explanation and pearl need clinical review; convincing-alternative quality is not established. |
| OBGYN / informed consent | Distractors remain conspicuously inappropriate; an answer-letter reference becomes incorrect after shuffling. |
| Psychiatry / capacity and consent | States the decision-specific comprehension problem, but legal claims lack an explicit jurisdiction and distractors are weak. |
| PHELO / statistical interpretation | Calculation gives 180/(180+80), approximately 69%; an 80% distractor explanation incorrectly describes subtracting a 10% false-positive rate from 100%. |
| Medicine / counselling | Distractors are conspicuously inappropriate; explanation uses letters that no longer match shuffled options. |
| Surgery / difficult news | Most alternatives are conspicuously dismissive; hints reveal evaluations of the choices and explanation uses an answer letter. |
| Pediatrics / health literacy | Weak alternatives and hints that reveal their flaws; explanation refers to incorrect letters after shuffling. |
| OBGYN / treatment choice | Includes a competing action that its own explanation says is indicated. Single-best-answer priority is insufficiently established; needs clinical review. |
| Psychiatry / diagnostic criteria | Uses duration and symptom pattern to distinguish alternatives; explanation claims five symptoms while the vignette lists six. |
| PHELO / Canadian obligations | Includes a plausible reporting alternative, but several other choices are implausible and legal/clinical accuracy remains unverified. |

The live sample does not pass the full content rubric. Strong-distractor quality, non-revealing hints, prose free of answer-letter references, and consistent explanations remain unreliable despite the explicit instructions. No semantic acceptance gate or second reviewer was added; successful schema validation must not be interpreted as proof of clinical correctness, single-best-answer validity or calibrated difficulty. Independent clinical review and learner-performance data remain outstanding.


## Prompt v4 simplification

Numeric difficulty was removed from generation requests, prompts and question schemas. The graduating-student MCCQE target and answer-quality instructions remain. Legacy saved questions retain any stored difficulty property, which is ignored and stripped when parsed; the database and question schema versions are unchanged. Historical v3 results above describe the prompt used at that time. No new live evaluation was run for this metadata removal.

## Reviewed generation v5 — October 30, 2026

Generation now uses the objective and schema without a clinical exemplar. Each structurally valid candidate receives separate clinical and editorial reviews. The clinical reviewer solves a shuffled item without its key, hints or explanations. Its answer is mapped back to the candidate IDs. The editorial reviewer receives the full draft and six original annotated construction examples. Blocking defects trigger revision; advisory polish does not. Three candidate calls cap a request at nine top-level model calls. No failed review permits an item to enter the queue.

Search grounding is available only to the clinical reviewer, with required verification for current recommendations, answer-determining doses/thresholds/intervals, jurisdictional duties and uncertain/disputed clinical conclusions. Referenced chunk indexes must resolve to actual retrieved metadata; verification-required claims also require search activity. These checks establish provenance, not medical truth or source authority. Reviewer agreement and successful schemas do not constitute independent clinical validation.

The ready-queue target is now three in mixed and focused practice. Existing larger queues drain naturally. Optional thumbs are shown after resolution, persisted per question in a separate IndexedDB version-2 table, and can be switched or cleared. They never alter study sampling, prompts or answers automatically. Local repository review queries join ratings to model/prompt provenance and encounter context; no feedback is uploaded.

### Live integration attempt

The finite evaluation runner was invoked in direct mode for the held-out medicine/laboratory-interpretation assignment, using the configured Gemini 3.5 Flash-Lite key. Candidate generation succeeded and the two review requests started. Gemini returned `429 QUOTA_EXHAUSTED` during review. The request returned an error, no question was accepted, and the runner stopped on quota instead of attempting the remaining eleven assignments.

The local artifact is `/tmp/iworld-reviewed-evaluation.json`; it contains one unaccepted draft and no completed reviewer verdicts. The draft has not received independent clinical review. No conclusions about distractor improvement, reviewer calibration or clinical correctness can be drawn from this interrupted sample. The nine-call bound, review acceptance, reference provenance, cancellation and feedback behavior are verified with mocked-provider and component/repository tests. A fresh full live run remains necessary when quota is available.

### Reproduction and future checks

```sh
node scripts/evaluate-generation.mjs direct /tmp/iworld-reviewed-evaluation.json
node scripts/evaluate-generation.mjs direct /tmp/iworld-reviewed-options-evaluation.json medicine-laboratory_interpretation --options-only
```

The original local HTTP runner remains supported. Direct mode adds private draft/review traces; clinical traces include the blinded presentation and mapped answer for interpretation. Reports reject stale prompt/evaluation versions, retain failed cases, count revised items and failing criteria, and describe answer-length patterns. Quality rejection continues the finite case list; missing credentials/quota stops it. The optional stem-and-options-only diagnostic is not an acceptance gate, and a correct guess is not proof of a wording flaw.

For future quality changes, inspect actual rejected criteria and `LocalStudyRepository.getQuestionFeedbackReviewData()` first. Reproduce a suspected defect, add an appropriate regression case, and check accepted questions for false rejections. Preserve passing counterexamples such as a legitimate longest correct answer. There is no automatic prompt learning. Broader clinician calibration, example-versus-no-example comparisons and learner-based discrimination/distractor analysis remain outstanding.

### Verification

The full automated suite, TypeScript checks and production build pass. The build retains dependency annotation and bundle-size warnings. Chrome access was not approved, so visual inspection in light/dark and narrow layouts was unavailable. Component tests cover optional controls, accessible labels/state, restored ratings, late navigation reads, failed writes and keyboard interaction; an additive migration test preserves existing questions, settings and queued records. No production deployment was performed.

## Lenient review v6 — October 31, 2026

The earlier strict acceptance gate has been replaced with **generate → two parallel reviews → optionally revise once → deliver**. Three model calls are normal and four is the maximum: two candidate calls shared between structural repair and substantive revision, plus one call to each reviewer. Revised candidates receive deterministic validation without a second model-review cycle.

The clinical reviewer remains blind to the key and teaching; the editorial reviewer retains its annotated construction examples. Review schemas now separate concrete correction requests from advisory observations. Uncertainty, a different preferred answer, imperfect distractors and minor wording concerns do not by themselves trigger revision. Concrete wrong clinical teaching, genuine ambiguity, missing decisive information, topic mismatch or obvious wording/hint giveaways can request one correction. The generator remains zero-shot.

Google Search is still available only to the clinical reviewer, entirely optionally. Mandatory verification categories, forced searches, model-generated citation indexes and citation acceptance checks have been removed. Missing citations, unavailable sources and absent grounding metadata never reject an item or use a revision. Available grounding metadata remains in the local trace for inspection.

Reviewers complete independently with a shared 90-second review deadline. A malformed or unavailable reviewer no longer cancels or discards its counterpart. A valid draft is delivered with a diagnostic warning when review is incomplete, unless a completed reviewer identified a demonstrated correctness defect. If revision fails, the original valid draft is a fallback only when no correctness defect was identified. If structural repair already consumed the second candidate call, a demonstrated correctness defect returns an error; remaining editorial suggestions do not. Overall request cancellation and the existing 285-second application deadline still apply.

The selected model, high thinking effort, three-question queue, background retry schedule, optional local thumbs feedback and persistent Settings failure message are unchanged. Review warnings do not become user-facing generation failures. Ratings remain leads for subsequent investigation, without automatic prompt or answer changes.

### Live smoke test

One held-out medicine/laboratory-interpretation assignment was run through the direct evaluator using Gemini 3.5 Flash-Lite. It returned HTTP-equivalent status 200 after **three calls in approximately 15 seconds**. Both reviewers completed, with no correction requests or advisories, and the original valid candidate was delivered unchanged. The clinical answer was correctly mapped from the blinded option order back to the candidate IDs. No search metadata was returned or required.

The local artifact is `/tmp/iworld-lenient-smoke-v6.json`. This is a provider/workflow integration smoke test of one item, not an independent clinical validation, difficulty calibration, or representative quality study. The earlier v5 quota failure remains historical evidence; this successful v6 smoke test does not replace the outstanding broader evaluation.

### Diagnostics and regression coverage

Offline evaluation version 4 distinguishes actual request failures from correction requests, advisory items, incomplete-review warnings and delivery outcomes (unchanged, repaired, revised, fallback). A reviewer-only quota warning stops the finite offline batch to avoid wasting more calls, even if its valid question was delivered. Production delivery remains best-effort as described above. Prompt-version changes invalidate old cached evaluation results.

Regression tests cover the three/four-call bounds, structural repair sharing the same budget, no re-review cycle, advisory disagreement/uncertainty, absent grounding, retained optional metadata, independent reviewer failures, reviewer timeouts, preservation of usable corrections, invalid revisions and fallback restrictions. Feedback, queue and persistent-error regressions remain in the full suite. The production build and typecheck are also checked before committing. Further checks should be based on actual failure traces and local question ratings rather than reinstating strict citation or perfection gates.

Final validation for v6: all 162 tests across 22 files passed with `npm test -- --maxWorkers=1`; typecheck and production build passed. An earlier parallel test/build run encountered worker-startup and wall-clock timeouts; the serial rerun passed without changing tests or timeout limits.
