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

## Always-on final refinement v7 — October 31, 2026

The normal workflow is now **initial draft → two parallel checks → final refinement → deliver**, using four model calls. An invalid initial draft can receive one structural repair before the checks, for at most five calls. The repair does not consume final refinement. Reviewers run once; the final envelope is checked deterministically without another model review or recursive repair.

Reviewer prompts no longer predict that valid questions should remain unchanged. They ask for balanced observations and distinguish harmless nuance from missing facts that could change the answer or make another option defensible. The seventh editorial example covers explanations assuming a condition was stable, controlled or treated without those facts appearing in the vignette. Prose findings should name options rather than reference shuffled letters.

The final editor always receives the validated original draft and assignment/objective, both available reviews with clinical IDs mapped to the draft, every advisory, optional grounding and reviewer-failure diagnostics. It can make targeted changes or preserve the question when feedback is unsupported. It must not silently invent missing case facts to rationalize the intended answer. Search remains optional and available only to the clinical reviewer; citation gaps do not gate delivery.

Final output uses a private `{question, summary}` envelope. Only the validated question is returned publicly. `stage=refinement` call logs retain the raw envelope when verbose logging is enabled. A separate verbose `refinement_result` event and local trace retain the validated outcome and summary. `refined_changed` versus `refined_unchanged` is computed from schema-normalized question fields, ignoring the internal vignette signature; it does not trust a model-reported change flag. If refinement fails, `fallback` is allowed only when no completed review identified a demonstrated correctness defect. Cancellation and overall deadlines still stop the request.

### Live smoke test

A single held-out medicine/laboratory-interpretation assignment completed successfully with Gemini 3.5 Flash-Lite in **four calls and approximately 24 seconds**. Both reviewers completed with empty correction arrays and one advisory each. The final editor received those advisories and changed a distractor from “Hereditary spherocytosis with an aplastic crisis” to “Hereditary spherocytosis,” alongside related hint/explanation edits. The initial case and intended answer were preserved. The local artifact is `/tmp/iworld-refinement-smoke-v7.json`.

This run demonstrates that advisory-only feedback now reaches an actual refinement pass; in v6 it would have been logged without triggering revision. The before/after trace confirms the option-text edit described in the summary. The summary imprecisely attributes the motivating observation to the editorial reviewer; the raw trace shows it came from the clinical reviewer. Summaries remain model-written descriptions, not verified provenance or independent clinical validation. No extra model calls were spent adjudicating the item or its summary.

### Verification and reporting

All 175 tests across 22 files pass with `npm test -- --maxWorkers=1`. Focused tests cover four-call delivery with corrections/advisories/no findings, independent reviewer failures, all feedback and mapped IDs in final-editor input, the five-call initial-repair limit, changed/unchanged detection, signature-only changes, private summaries, invalid envelopes, fallback restrictions, cancellation and verbose logging. Typecheck and production build are checked before committing.

Offline evaluation version 5 now separates initial-repair counts, final-refinement passes, actual changed-question counts and refinement summaries. Prompt version `mccqe-refined-v7` prevents reuse of earlier cached results. User ratings remain local leads for later investigation, without automatic prompt or answer updates. No UI, public question schema, database migration, queue size, retry schedule or persistent-error behavior changes were introduced.


## Actionable feedback and distractor review v8 — October 31, 2026

Prompt version `mccqe-distractors-v8` keeps the four-call workflow and five-call allowance for one initial structural repair. It changes review/editor instructions and adds two compact construction examples, without new calls, rejection gates or citation requirements. Public schemas, database, three-question queue, optional thumbs, retries and persistent Settings errors are unchanged. Adaptive three-versus-four-call generation remains deferred.

Both reviewers now use advisories only for actionable observations identifying what could improve and where. They return empty lists when there are no concerns; praise and general approval are not useful refinement feedback. This is a prompt/schema-description requirement, not a keyword filter. Server-generated disagreement and missing-competitor observations also give the final editor a concrete next action while remaining non-blocking.

The editorial reviewer assesses whether the intended key is inferable from the stem/options without using the vignette, especially when conspicuously inappropriate alternatives contrast with the only empathetic, comprehensive or professionally phrased response. A material giveaway requests an `answer_giveaway` correction. Credible misconceptions remain useful alternatives, and a legitimate longest correct answer or a clear clinical answer with plausible alternatives should not be penalized. The nine annotated examples now include the user-reported communication pattern and a passing communication item whose explicit wage/schedule barrier distinguishes two respectful approaches. These are construction illustrations, not generation templates.

The always-on final editor independently checks option plausibility and wording clues even when reviewers report no defects. Agreement is not proof of quality. It prefers a targeted distractor replacement with matching hint/explanation changes, distinguishing reasonable alternatives by an explicit case fact or priority. It must avoid unsupported assumptions, gratuitous restrictions that merely make a distractor unreasonable, and two equally defensible answers. Summaries should identify actual edits or explain why a credible competitor remains distinguishable, rather than offer generic approval.

### Known-regression replay

`src/test/fixtures/obvious-communication-distractors.json` preserves the supplied log's original draft. Its labels concern wording/distractor construction only; clinical and legal content are explicitly unreviewed. The full fixture is not included in production prompts. The opt-in `scripts/evaluate-review-fixture.mjs` uses the production editorial and final-editor prompts/schemas for a finite two-call replay, with no clinical reviewer or search. It saves before/after content, findings and summary locally. This is a known-regression calibration, not a held-out quality estimate or a new production evaluation cycle.

Two local replays completed with Gemini 3.5 Flash-Lite, two calls each. Both editorial reviews returned an `answer_giveaway` correction and empty advisories, and both final editors changed the draft. In the first replay, several replacement options still relied on conspicuously unreasonable restrictions; the final-editor instruction was clarified to ask for an independently reasonable competing response separated by the stated priority. The follow-up replaced border-enforcement/confrontation alternatives with shelter/police-referral and transition-home approaches, whose hints/explanations discuss the distinction between general safety resources and the stated immigration concern. These replacements provide more credible competitors than the original alternatives. Some remaining choices still use delay/prerequisite cues, and teaching prose still refers to an answer letter despite existing instructions. The model's summary overstates the consistency of the improvement; it is not a verified assessment.

Artifacts: `/tmp/iworld-review-fixture-evaluation.json` (first replay) and `/tmp/iworld-review-fixture-evaluation-final.json` (follow-up). Their successful schemas and wording edits do not validate claims about immigration status, shelter access, policing or clinical safety. No clinical/legal review was performed, and neither artifact establishes single-best-answer validity. Future changes should follow actual failures and local thumbs feedback rather than add blanket strictness or automatic prompt learning.

### Verification

All 177 tests across 22 files pass with `npm test -- --maxWorkers=1`; typecheck, script syntax checks and production build pass. The build retains its existing dependency annotation and bundle-size warnings. Regression tests verify that the fixture's `answer_giveaway` correction and actionable advisory reach the final editor, and that a mocked replacement's text, hint and explanation remain together through final option shuffling. Empty findings still receive the independent final pass. Positive context controls retain legitimate answer-length variation, a clear clinical answer with a plausible alternative, and the passing communication example. Existing four/five-call limits, optional grounding, reviewer failures, cancellation, fallback restrictions and public-schema compatibility remain covered.

Prompt tests establish instruction delivery and feedback routing. The live inspection above assesses observed model behavior on one known wording regression; neither is clinical validation.


## Compact generation and measured option length v9 — October 31, 2026

Prompt version `mccqe-near-misses-v9` retains four calls normally and at most five with initial structural repair. For keys longer than five words, code measures whitespace-separated words (hyphenated terms count as one) against the median of the four distractors. The key must be at most 110% of that median. A violation creates a construction-origin `answer_giveaway` correction even with empty or unavailable reviewers. Final merged content is checked again. Failure to repair a known length giveaway rejects delivery rather than returning it unchanged. A refinement introducing a new violation is discarded; an acceptable original may still be the fallback. There is no recursive repair or extra review cycle.

The generator returns study content without echoing the assigned blueprint; the server attaches it. Refinement returns `{edits, summary}`, with only changed fields and a one-sentence private summary capped at 300 characters. Omitted fields retain their original values. Options, when replaced, must include all five complete choices with hints/explanations, and the full merged question is schema-validated. Blueprint changes are excluded from edits. Public response fields, database and UI remain compatible.

Instructions are shorter. Assigned objective title and enabling text replace the full parent-objective dump. Compact construction examples replace the longer editorial set. Refinement receives corrections/advisories once and a mapped clinical decision, without duplicated raw review arrays, raw grounding metadata or the entire generator prompt. Grounding remains available in clinical traces. User-facing hints, option explanations, short explanation and pearl remain because the study UI uses them. The blind clinical answer, closest competitor and deciding fact remain useful checks. Thinking effort is unchanged.

Distractor instructions now ask for an almost-correct plan with one case-relevant error in a fact, phrase, rule, timing or priority, retaining comparable tone, scope and professionalism. Shared care details belong in the vignette. Final editorial review prioritizes semantic plausibility and leaves length arithmetic to code; its compact near-miss example changes decision-specific to global capacity while retaining the rest of the plan. Refinement prioritizes rebuilding weak alternatives before prose polish and may preserve output only when all distractors are credible near-misses and length passes.

### Approved finite live checks and observed limits

Two full generations and two two-call replays used twelve approved Gemini calls. Fresh laboratory interpretation and capacity/consent items returned 200 in four calls each, taking 20.45 and 18.67 seconds. The laboratory editorial reviewer found an incorrect antiglobulin-test explanation, which refinement corrected. The capacity item passed the length limit but still had easy distractors. Both completed reviewers approved it; this remains evidence of the semantic review's limits.

The supplied failure is preserved in `src/test/fixtures/long-capacity-answer.json`. Both replay editorial checks flagged its 23-word key against an 18-word distractor median. First refinement only shortened the key. After strengthening distractor instructions, the second replay returned option lengths 16, 14, 14, 16, 15; the key is 14 words and the distractor median 15.5. It still preserved emergency-consent, court-order and support-worker choices. Thus the observed replay demonstrates length repair, while semantic distractor quality remains insufficient. The final semantic-first editorial/refinement instruction described above was added after those twelve calls and has not had another live replay. Do not read the model's summary as clinical validation or proof of quality.

Fresh capacity prompt tokens were 991/838/1708/1498 for candidate/clinical/editorial/refinement, versus 1655/1512/2768/2879 in the supplied v8 log. Its unchanged refinement output used 41 tokens versus 883 for the old full envelope. Different generated content and this small sample do not establish a reliable speed gain. Four high-effort calls still dominate latency.

Artifacts: `/tmp/iworld-near-misses-v9.md` contains the actual replay question/options and both fresh questions; `/tmp/iworld-capacity-replay-v9-final.json` retains the second replay; `/tmp/iworld-generation-v9.json` and `.log` retain fresh traces and timings. These are construction/workflow checks with no independent clinical or legal validation.

### Verification

Regression coverage includes the supplied length failure, exact and fractional 10% boundaries, the five-word exemption, whitespace/hyphen counting, empty/unavailable reviewers, required repair feedback, rejection of unchanged/broken repairs to a known length defect, introduced violations, sparse-edit merging, immutable metadata, complete/unique option validation, unchanged public schema and four/five-call bounds. Existing cancellation, fallback, logging and blind-ID mapping checks remain. Offline reports now show key and median word counts and the actual threshold result separately from the diagnostic uniquely-longest flag.

Final local verification: all 188 tests across 23 files pass; typecheck, production build, script syntax checks and `git diff --check` pass. One intervening full-suite run hit the existing queue-order test's equal-timestamp ordering race (two enqueue timestamps can match); the unchanged suite passed on rerun. No queue/repository changes were made. The build retains the existing dependency annotation and bundle-size warnings.


## Lean draft and complete final question v10 — October 31, 2026

Prompt version `mccqe-lean-draft-v10` implements **lean draft → parallel clinical/editorial reviews → complete refinement**. Initial provider output is exactly `vignette`, `stem`, five option strings and integer `correctIndex` 0–4. Code assigns IDs and assignment metadata. Initial output and both review inputs contain no teaching or signature. Clinical review remains blind; editorial review sees the intended key and targets construction. The clinical deciding fact is bounded to 300 characters. Model selection and high thinking effort are unchanged.

Refinement returns a complete question, answer index, main explanation, pearl and signature. Each distractor requires a hint and explanation; the key contains text only. Code reuses the main explanation for the correct option and supplies a neutral unused hint, preserving the public contract. Teaching is written once against final content and receives the finalizer's self-check; earlier reviewers have not seen it. No model-written summary or sparse-edit envelope is requested.

Code supplies word counts, median and key-word budget, then rechecks the five-word exemption/110% median limit against final choices. Reviewers leave arithmetic to code. Alignment/structure are checked on the draft; final validation adds signature and hint checks. The signature is generated only in refinement, with recent signatures supplied. IDs and key are assigned from final positions and remapped together when shuffled. A failed/invalid refinement returns an error: there is no complete draft fallback, recursive final repair or extra review cycle. Reviewer failures remain independent/non-blocking. Four calls are normal; one initial structural repair permits five. Quota/cancellation handling, public API, stored format, UI, queue and application retries are preserved.

Traces now retain provider usage and call durations without requiring verbose logging. Deterministic change reports compare only vignette, stem, ordered option text and answer index; new teaching/signatures do not count as core rewrites. Offline readers retain legacy summaries but v10 requests none. Replay converts historical questions to lean core input, excludes old teaching, and reports model editorial detection separately from code-detected length issues.

### Finite live checks and limits

Two full generations and one two-call regression replay used **10 of the maximum 12 approved calls**, with no repairs. Both fresh generations returned 200: laboratory interpretation in 18.83 seconds and capacity/consent in 21.94 seconds. Replay completed in two calls with 17.06 seconds of provider time. All final schemas, required teaching and length checks passed. The replay key fell from 23 words against median 18 to 16 words against median 16.5.

Initial outputs used 287 and 280 tokens, versus 706 and 845 in the previously recorded v9 examples. Earlier whole-request times were 20.45/18.67 seconds; v10 times were 18.83/21.94 seconds. Scenarios differ and the sample is tiny; complete final regeneration replaces a potentially small patch, so there is no reliable overall speed gain established.

Semantic construction remains mixed. The fresh capacity editorial review flagged the irrelevant emergency choice and a weak support-manager alternative; refinement replaced the emergency choice with assent plus substitute consent but retained conspicuously wrong wording elsewhere. Its teaching asserts understanding of risks and acceptance/refusal consequences beyond what the vignette explicitly establishes. The known failure replay's editorial review returned empty findings, while code supplied its length correction; emergency-consent, court-order and support-worker alternatives remain easy. These are workflow/construction checks with no independent clinical/legal validation. Length/schema success does not establish good distractors or accurate teaching.

Artifacts: `/tmp/iworld-lean-draft-v10.md` contains all actual final questions, teaching, timings and observations. `/tmp/iworld-generation-v10.json` and `.log` retain fresh traces/provider outputs; `/tmp/iworld-capacity-replay-v10.json` retains the replay; `/tmp/iworld-lean-draft-v10-summary.json` holds derived metrics and explicit manual observations. No additional calls were spent polishing these examples.

### Local verification

All 194 tests across 23 files pass; the final focused run passed 70 tests. Typecheck, production build, script syntax checks and diff whitespace checks pass, with existing annotation/bundle-size warnings. Coverage includes minimal schemas, index bounds and generated IDs, blind mapping, review inputs without teaching, required final distractor teaching, canonical key explanation, changed/reordered/shuffled answers, code-counted length boundaries, signature/hint checks after lean generation, no fallback, public compatibility, core-change reporting, usage/timing traces, cancellation and four/five-call limits.


## Reduced thinking effort v11 — November 1, 2026

Prompt version `mccqe-lean-thinking-v11` uses one exported stage policy: MEDIUM for generation and structural repair, LOW for clinical review, editorial review and final refinement. Production and fixture replay share the policy. Call logs, verbose results and traces include the applied thinking level beside duration and usage. Prompts, schemas, model choices, validation, parallel reviews and public behavior are unchanged.

All 194 tests across 23 files pass. Tests verify the four-stage policy, MEDIUM structural repair and thinking levels in timing traces/verbose logs. Typecheck, production build, script syntax checks and whitespace checks pass, with existing build warnings.

One sequential live run per existing assignment used eight calls, below the maximum ten, with no repairs or failures. Laboratory interpretation took 7.310 seconds versus the historical all-HIGH 18.830 seconds: 11.520 seconds (61.2%) less. Capacity/consent took 8.176 seconds versus 21.940 seconds: 13.764 seconds (62.7%) less. Raw timings, usage and actual final questions are saved in `/tmp/iworld-generation-v11.json` and `.log`; `/tmp/iworld-generation-v11.md` contains the readable comparison and complete returned teaching. `/tmp/iworld-generation-v11-comparison.json` holds derived differences.

Both blind clinical reviews agreed with their intended keys; both editorial reviews returned empty findings. Capacity distractors remain conspicuously easy, and a laboratory hint references an unprovided reticulocyte count. The laboratory pearl's broad diagnostic-test claim needs independent clinical verification. Different scenarios, historical baselines and one sample per assignment limit speed conclusions; these checks do not establish equivalent clinical or construction quality. LOW-stage usage omitted thoughtsTokenCount, so reports label it unreported rather than claiming a measured zero. No extra calls were used to polish these outputs.


## Correct-option teaching normalization v12 — November 1, 2026

Prompt version `mccqe-final-validation-v12` fixes the three supplied production failures without changing thinking levels: generation/repair remain MEDIUM, both reviewers and final refinement remain LOW. Structured output stays enabled via JSON MIME type and response JSON schema. All three failed responses completed normally but supplied empty hint/explanation strings on the correct option; the prior parser rejected them even though those fields are unused and replaced by code.

The provider-facing option schema now permits optional string-or-null hint/explanation values. Role-dependent teaching requirements remain server-side because a flat array cannot express them relative to a separate answer index. Correct-option teaching may be omitted, empty, null or populated; it is ignored during public-question normalization. The canonical explanation is still shortExplanation, with the existing neutral unused hint. Every distractor must still supply strings meeting the original 15-character minimum. Text, answer index, uniqueness, main teaching, signature, task, hint-leak and option-length checks are preserved. Prompts still instruct omission of correct-option teaching. There are no additional retries, fallback drafts, API/UI changes or live model calls.

Default server warnings now include a structured `[question-generation:validation]` event with request ID, stage, JSON/schema/quality category, safe failure code and field-level issues where available. Each event has at most 10 issues, at most eight path segments per issue, and messages bounded to 240 characters. Unknown property names, JSON parser source excerpts and arbitrary provider exception text are not emitted in these diagnostics; credentials are defensively redacted. Evaluation validation traces retain the same diagnostic record. Public delivery errors retain QUALITY_REJECTED and the existing message.

`src/test/fixtures/correct-option-empty-teaching.json` preserves the three exact supplied final responses, including original empty strings. Original assignment tags were absent, so deterministic replays use test tags only for structural normalization; this is not a clinical/legal or objective-alignment validation. All three pass normalization and the existing word-count rule; canonical key teaching is restored without changing question text. `/tmp/iworld-v12-local-replay.json` records the local outcomes and confirms zero model calls.

All 210 tests across 23 files pass. New coverage includes all correct-option placeholder forms, missing/null/empty/short distractor teaching, provider schema serialization, all three supplied responses, successful four-call normalization with JSON mode and thinking policy unchanged, JSON/schema/quality diagnostics, bounded error counts, field paths, credential redaction and suppression of unknown-field names. Typecheck, build, script syntax checks and diff whitespace checks pass. Existing bundle-size/dependency annotation warnings remain.

## Explicit answer roles v13 — November 1, 2026

Prompt version `mccqe-explicit-answers-v13` replaces positional model output with explicit answer roles. The lean draft contains only `vignette`, `stem`, a `correctAnswer` string and exactly four `distractors` strings. Complete refinement returns `correctAnswer: {text, explanation}`, exactly four `distractors: {text, hint, explanation}`, the final vignette/stem, high-yield pearl and vignette signature. Strict schemas reject the previous `options`/`correctIndex` provider format. All five texts must remain unique after trimming and case folding.

Teaching requirements now appear directly in the provider JSON schema: correct-answer explanation has the existing 25-character main-explanation minimum; every distractor hint and explanation has the existing 15-character minimum. No nullable/optional distractor teaching or correct-answer hint is requested. Code normalizes the key first and assigns A–E, reuses its explanation as `shortExplanation` and correct-option explanation, and supplies the existing neutral unused correct-option hint. Public question schemas, stored questions, UI and final shuffling remain unchanged; no migration is required.

Clinical review still receives shuffled, relabelled choices without roles, key or teaching. Its answer and strongest-alternative IDs map back to the normalized draft. Editorial review and final refinement receive the normalized ID-labelled draft with its intended key, keeping reviewer IDs and length-budget entries unambiguous. Refinement outputs the role-based schema. Core-change traces now use `vignette`, `stem`, `correctAnswer` and `distractors`, ignoring new teaching and signatures. Fixture replay uses the shared conversion/prompt helpers; historical public-format and failed-provider fixtures remain intact. Safe diagnostic paths include the new role fields while retaining bounded messages and redaction.

The four-call workflow, five-call allowance for one initial structural repair, model/thinking policy, reviewer-failure handling and final quality checks are unchanged. Earlier evaluation results cannot be reused under the new prompt version. No live model calls were made; this refactor establishes schema and compatibility behavior, not improved distractor quality or clinical validity.

Validation: all 83 focused tests across schema/options, generation, review and evaluation-report files pass. The final full-suite run has 206 passing tests and one failing queue-order test across 23 files. The same `LocalStudyRepository > persists queue order and removes completed queue items` failure reproduced against a clean temporary copy of the original HEAD; that existing test can encounter equal creation timestamps and return the two queued items in reverse order. Queue implementation/tests were left unchanged. Typecheck, production build, affected script syntax checks and diff whitespace checks pass. The build retains existing dependency-annotation and bundle-size warnings. Coverage verifies strict role schemas, required provider teaching constraints, old-format rejection, cross-role uniqueness, blind answer/alternative ID mapping, correct/distractor teaching through changed-answer final shuffling, diagnostics, core-change reporting and existing workflow bounds.

## Consolidated review pipeline v16 — November 10, 2026

Prompt version `mccqe-text-review-v16` keeps answer identity out of generation, review, refinement and quality validation. Draft parsing returns `vignette`, `stem`, `correctAnswer` and four `distractors` directly; final parsing retains the role-based teaching schema. Assignment metadata is trusted context passed separately to validation. Neither parsing step adds option IDs. Candidate, clinical review and refinement traces retain role-based content.

One blind clinical review replaces the previous parallel clinical and editorial calls. It receives a code-shuffled array of five plain strings, with no key, roles, teaching, IDs or explicit answer positions. Its schema records an independently solved answer separately from the chosen option, with status `matched`, `none_defensible` or `uncertain`. A none-defensible result requires an independent answer and a clinical-error correction; refinement receives both and can rebuild the key and distractors. This is an internal verdict; learner questions still have exactly five choices. The reviewer also checks clinical consistency, distractor plausibility and wording giveaways. Candidate generation and refinement have no Python; clinical review retains Python and optional Google Search. For material arithmetic, a strict nullable `calculation` object records formula, substitution and result, and refinement receives this calculation with the clinical findings.

Matched answer selections must exactly equal supplied choice text; there is no case folding, trimming or fuzzy resolution. Inconsistent status/answer combinations and unknown selections invalidate the review and use `clinical.INVALID_REVIEW`, after which refinement still runs with review-failure diagnostics. Uncertainty and key disagreement remain distinct from a none-defensible finding. Length budgets expose `correctWords`, text-labelled distractor word counts, `distractorMedianWords`, `maximumKeyWords` and `exceedsLimit`. Existing alignment, length, signature and hint-leak checks run on role-based content before the delivery adapter. Core-change reporting retains `vignette`, `stem`, `correctAnswer` and `distractors`, excluding new teaching/signatures.

Only `toGeneratedQuestion` at the final delivery boundary shuffles complete choices, assigns A–E, derives `correctOptionId` and validates the public question schema. It reuses the correct explanation as both `shortExplanation` and correct-option explanation and retains the neutral correct-option hint. The immutable shuffle helper is shared with clinical blinding and accepts an injectable random source for tests. Database/UI schemas and saved answer order remain compatible. Historical fixtures are converted at test/replay input boundaries without modifying their stored content; fixture replay validates and reports the role-based final result. Assignment/request IDs and internal array operations are unaffected.

Three calls are normal: candidate, clinical review and refinement. One structural candidate repair raises the maximum to four. Removing the separate editorial request saves one model call per valid question; the exact token savings depend on prompt and response lengths. Models, thinking levels, cancellation and final quality checks remain unchanged. No live calls or database migration were performed. The prompt version invalidates reuse of prior evaluation results; this work does not establish improved clinical or distractor quality.

Validation: TypeScript typecheck passes. All 85 focused tests across generation, review, debug-bench traces and evaluation reporting pass; the offline regression script passes `node --check`, and `git diff --check` is clean. No live Gemini calls were made. Coverage checks the three-call tool policy, structured calculation handoff, independent answer and choice-status validation, none-defensible repair through refinement, single-review failure handling, blind answer selections, and immutable five-choice final conversion.
