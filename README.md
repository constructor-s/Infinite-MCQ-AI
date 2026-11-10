# IWorld

IWorld is a local-first MCCQE clinical reasoning PWA. It generates one question at a time with Gemini, keeps three fresh questions in IndexedDB, and falls back to missed-first review when generation is unavailable.

## Local setup

1. Install Node.js 22 or newer and run `npm install`.
2. Copy `.env.example` to `.env.local` and set a Google AI Studio `GEMINI_API_KEY` with access to the selected model and search grounding.
3. Run `npm run dev`. Vite binds to all network interfaces; open the printed **Network** URL on a phone connected to the same LAN.

If the phone shows a cached page but generation cannot connect, confirm the terminal still shows the dev server running, reload the Network URL, and ensure the operating-system firewall permits incoming Node.js connections.

No study questions are shipped in the queue. A first launch requires a working Gemini key and network connection. Generation uses the checked-in MCC objective snapshot and blueprint configuration described below; editing these requires a rebuild. Generation is zero-shot: the source objective sets the content, and the JSON schema plus short style instructions set the format. Clinical exemplars are not included in generation prompts.

## Blueprint and question generation

`curriculum/blueprint.json` defines the MCCQE marginal targets: assessment/diagnosis 45%, management 35%, communication 10%, and professional behaviours 10%; acute 35%, chronic 30%, prevention 20%, and psychosocial 15%. The official tolerances are ±5 percentage points. Six equal discipline weights are approximate study-guide guidance, not official fixed quotas. There is no official joint distribution; independence products are used only as a fallback after eligibility filtering.

Before calling Gemini, the browser chooses an eligible discipline/activity/care combination that minimizes target-weighted squared deviation in the next rolling 200-question window. Successfully generated questions count once, including queued and currently displayed questions. Reviews and failed generations do not count. Objective abundance cannot change category weights.

Within the chosen combination, 70% of objective draws use baseline priorities and 30% use bounded weakness, spacing and coverage multipliers. Weakness uses the latest 20 first-attempt outcomes per objective, with Beta(1,1) smoothing; revealing an unanswered question counts as a miss. Spacing reaches its maximum at 30 days; unseen objectives receive neutral weakness and high coverage priority. The least recently used eligible cognitive task is selected next. Personalization stays within the selected blueprint combination.

The server validates the assignment against `curriculum/crosswalk.json` and generates a paragraph question from the objective, enabling clause, task/care instructions and recent scenarios. Local schema, paragraph, answer-leak, duplicate and task-alignment checks run first. Two separate calls then review a valid candidate once: a clinical reviewer solves shuffled options without seeing the key or teaching, and an editorial reviewer sees the complete item with nine annotated examples. Reasonable disagreement, uncertainty, imperfect distractors and minor wording concerns are advisory; a different answer alone is not a demonstrated defect. Both reviewers reserve advisories for actionable observations specifying what could improve and where. They return empty findings when there are no concerns, rather than praise or general approval.

The v8 workflow is **initial draft → two parallel reviews → final refinement → deliver**. Four model calls are normal: one initial draft, one clinical reviewer, one editorial reviewer and one final editor. An invalid initial draft can receive one repair before review, for a maximum of five calls. That repair does not consume final refinement. There is no repeated review or recursive final repair. The selected model is used throughout with high thinking effort and model-default sampling.

The final editor always receives the actual draft, assignment/objective, both available reviews, every advisory, mapped clinical answer IDs, optional grounding and reviewer-failure diagnostics. It evaluates feedback on its merits, prioritizing clinical consistency, one defensible answer, plausible distractors and absence of wording/hint giveaways. It can make targeted improvements or preserve the draft when changes are unsupported or unnecessary. Reviewers have no expected verdict and explicitly distinguish harmless nuance from missing facts that could affect the answer. The editorial examples include an explanation assuming a condition was stable/treated without those facts appearing in the vignette, a failing communication item with four conspicuously inappropriate responses versus one supportive response, and a passing item with a believable competing approach separated by an explicit case fact. The editorial reviewer mentally hides the vignette to assess whether tone or wording alone reveals the key; this uses the existing full-question call, not a separate model request. Material giveaways receive an `answer_giveaway` correction. Ordinary length variation and a clear answer with plausible alternatives remain acceptable.

The final editor independently checks option plausibility and wording clues even when reviewers report no defects. Reviewer agreement does not establish quality. It prefers a targeted distractor replacement, keeps the associated hint/explanation consistent, and uses the stated case priority to distinguish reasonable alternatives without unsupported assumptions or two equally correct answers. Summaries describe the actual edit or why a credible competitor remains distinguishable rather than generic approval.

Final output uses a server-only `{question, summary}` envelope. The summary explains changes or preservation and is retained in verbose logs/evaluation traces, never in the public question response. Changed/unchanged is computed from validated question content, ignoring its internal scenario signature, rather than trusting the editor's description. The refined question receives deterministic schema, assignment, paragraph, duplication and leakage checks without another model review.

Only the clinical reviewer has optional Google Search grounding. Search, successful retrieval and citations are never required; missing metadata and citation gaps never reject questions or consume a revision. Available grounding metadata is retained in private evaluation traces, without asking the model to supply indexes into provider metadata. No extra service credentials are required.

Reviewer results are independent and best-effort: one failed or malformed review does not discard the other, and the final editor still runs if one or both reviews are unavailable. If final refinement fails, the original valid draft is a fallback only when no completed review identified a demonstrated correctness defect. Otherwise the request returns a clear error. The system does not certify clinical correctness, and a refinement summary is not independent verification.

The generation function retains a 285-second application deadline, a 300-second Vercel limit (requires a deployment supporting that duration, such as Fluid Compute), and a 305-second browser timeout. Best-effort reviewers have a shared 90-second time limit; the overall request deadline and cancellation still stop the request. Background queue retries and the three-question target are unchanged. Settings keeps the latest real generation failure visible through retries/offline periods, clearing it after a saved question or a model/focus change. Review warnings alone do not pause generation.

Routine logs report delivery outcome (`refined_changed`, `refined_unchanged` or `fallback`), review completeness, advisory counts, model, timing and calls, without question text. An opt-in internal trace hook retains private drafts and reviewer findings for local evaluation. Set `QUESTION_GENERATION_LOG_LEVEL=verbose` (or `debug`) in `.env.local` and restart the server to print each call's full result with `console.debug`. Default `info` omits these payloads. Verbose output uses one JSON line per completed call with the prefix `[question-generation:verbose]`, request ID, stage (including `refinement`), round, stable call number, model, duration, result, and available usage/grounding/finish metadata. A separate `refinement_result` verbose event records the validated change flag, outcome and summary, including fallback explanations. Malformed JSON is logged as raw result text; provider errors expose safe codes/status instead of raw exception bodies. A successful call log means the provider returned, not that the draft passed validation. Prompts, headers, SDK request objects and private reasoning are not logged; the configured API key is defensively redacted. Model outputs include answer keys, so verbose logging is opt-in and server-only.

For a temporary local run and only verbose results:

```sh
QUESTION_GENERATION_LOG_LEVEL=verbose npm run dev 2>&1 | rg '\[question-generation:verbose\]'
```

Remove the pipe to see all logs, or use `rg -v '\[question-generation:verbose\]'` to hide payload lines. An explicit value in `.env.local` takes precedence in the current Vite configuration.

Every question and encounter records blueprint tags; questions and generation events also record blueprint, curriculum, crosswalk and prompt versions. Questions retain the selected enabling-clause identifier. Historical questions are preserved, including those generated before model review was introduced.

Only schema-version-2 paragraph questions are supported. Pre-existing browser records are left untouched but older question formats are excluded from the active queue and review. Settings and new study history continue using the same IndexedDB database. `curriculum/topics.json` is the original starter reference and no longer controls generation.

## MCC source snapshot and maintenance

`curriculum/objectives.json` contains 192 medical-expert objectives and six CanMEDS role objectives imported on October 16, 2026. Official IDs (including child IDs), group metadata, source wording, versions, URLs and retrieval dates are preserved. Non-expert pages lack official IDs and revision dates: their `role:` IDs are explicitly local/source-derived and their source version is null. `curriculum/catalogue.json` carries browser-safe metadata; full source text is server-only. No live MCC fetch is needed while studying.

Refresh the snapshot and rebuild the eligibility crosswalk with Python's standard library:

```sh
python3 scripts/import-mcc-objectives.py --retrieved-at YYYY-MM-DD
python3 scripts/build-mcc-crosswalk.py
```

The crosswalk is application-authored, starting from the study guide's discipline lists and extending omitted objectives. Explicit tuples bind an objective, discipline, activity, care dimension, task and enabling clause. The authoring script uses selective care profiles, source-clause matching, and explicit role overrides; inspect its output after any refresh. It is not an official MCC mapping or a substitute for clinical review. Its review status is recorded in the JSON. A content-hash version detects inconsistent snapshots, catalogues and crosswalks in tests.

`curriculum/exemplars.json` retains two historical micro-exemplars per cognitive task as offline references. They are not supplied to the generator or used as reviewer calibration labels. The editorial reviewer uses a separate set in `src/server/questionReview.ts`. The official 55-item set is a style reference, not an estimate of blueprint frequencies. `curriculum/practice-calibration.json` records structural observations for all 55 supplied questions. `curriculum/evaluation.json` reserves separate requests and a manual review rubric for offline evaluation; it is never injected into generation prompts. Recorded results and unresolved content-quality findings are in [the evaluation review](docs/generation-evaluation.md). Run the local evaluation against an already running development server:

```sh
node scripts/evaluate-generation.mjs https://localhost:5173 /tmp/iworld-generation-evaluation.json
```

For draft/review traces without an HTTP server, run:

```sh
node scripts/evaluate-generation.mjs direct /tmp/iworld-generation-evaluation.json
```

For one manually assigned question, import the callable debug bench from Node. It writes a timestamped report under `/tmp/iworld-question-debug-bench/`:

```sh
node --input-type=module <<'NODE'
import { runQuestionDebugBench } from "./scripts/question-debug-bench.mjs";

const run = await runQuestionDebugBench({
  topicId: "mcc.78-2",
  blueprint: {
    discipline: "phelo",
    physicianActivity: "assessment_diagnosis",
    careDimension: "prevention",
    cognitiveTask: "evidence_statistical_interpretation",
    mccObjectiveIds: ["78-2"]
  },
  enablingObjectiveId: "enabling-7",
  model: "gemini-3.5-flash-lite",
  avoidSignatures: []
});

console.log(run.report.outcome, run.reportPath);
NODE
```

Run this from the project root; set `GEMINI_API_KEY` in the shell or `.env.local` first. Each call trace includes its full model request under `data.request` and returned non-text parts under `data.nonTextParts`, including executable code and tool results; credentials, headers and abort signals are excluded. Reports contain complete generation content for local diagnosis and should remain local.

Append a comma-separated list of case IDs to select a subset. Append `--options-only` for an extra wording-clue diagnostic on accepted items. That diagnostic sees the stem and options without the vignette or answer key; its guesses do not change acceptance. Reports include prompt/evaluation versions, actual failed requests, correction requests, delivery outcomes, initial repair/refinement counts and summaries, incomplete-review warnings, advisory counts and descriptive answer-length signals. Successful results are reused only for matching versions and assignments. Actual request failures do not abort the finite case list; missing credentials or quota exhaustion (including reviewer-only quota warnings) stop it to avoid wasted calls.

For a targeted replay of the user-reported wording regression, run:

```sh
node scripts/evaluate-review-fixture.mjs
```

This opt-in script makes only two calls: the production editorial check followed by the final editor. It defaults to the checked-in construction fixture, Gemini 3.5 Flash-Lite, and `/tmp/iworld-review-fixture-evaluation.json`. Optional positional arguments are fixture path, output path, and model. It records the expected `answer_giveaway` finding, before/after questions and summary; inspect the actual edits rather than trusting the summary. The full fixture is never supplied to production generation. This is a known-regression calibration, not held-out evaluation or clinical/legal validation. It adds no production evaluation cycle.

These commands make billable/quota-consuming Gemini calls, including search operations. Direct-mode reports contain complete draft/review content and should remain local. Review each saved item for blueprint/task alignment, factual accuracy, one best answer, original scenario, homogeneous distractors and concise prose. Deterministic sampling tests independently simulate 10,000 selections and check every 200-item window, including concentrated weaknesses and uneven objective counts.

Sources: [MCCQE](https://mcc.ca/examinations-assessments/mccqe/), [MCC Examination Objectives](https://mcc.ca/objectives/), [Study smarter (2026)](https://mcc.ca/wp-content/uploads/Study-smarter-A-study-guide-for-the-MCCQE.pdf), and [55 practice questions (2026)](https://mcc.ca/wp-content/uploads/MCCQE-practice-questions-and-answers-2026.pdf).

## Checks

```sh
npm run typecheck
npm test
npm run build
```

## Vercel deployment

1. Import this directory into a Vercel project.
2. Add `GEMINI_API_KEY` to the project environment variables and redeploy.
3. Under **Settings → Deployment Protection**, enable **Vercel Authentication** for **All Deployments**. Do not expose the production deployment publicly: the server endpoint uses your Gemini key.
4. Confirm in a private browser window that Vercel requires sign-in, then verify first-question generation and background queue filling.

Questions, attempts, the queue, and the selected model remain in that browser's IndexedDB. Clearing site data removes them.

## Focused practice

In Settings, **Question focus** lets you switch from mixed practice to one of the six disciplines and optionally choose a searchable MCC objective. Click **Apply focus** to save it. The current question and answers stay open; the next question uses the selected focus. Focus persists in this browser until you select **Return to mixed practice**.

Each focus has its own fresh-question queue, filled to three while active. Existing larger queues drain naturally before refilling. Switching preserves inactive queues for later. Focused practice waits for fresh questions instead of automatically reviewing old ones; if none are ready, you can wait, retry generation, or return to mixed practice. Saved question links and Back/Forward continue to restore their original attempts regardless of focus.

Blueprint coverage is tracked separately for mixed practice and each focus, so drills do not cause compensating changes to the mixed distribution. Focused selections retain eligible activity, care and cognitive-task combinations; a restricted pool may not support the full blueprint distribution. Objective performance history remains shared, and first attempts on fresh focused questions contribute to correct rates. Invalid or obsolete saved focus selections reset to mixed practice with a notice. No free-text steering or additional subspecialty taxonomy is used.

## Optional question feedback

After an answer is revealed or correctly selected, two subtle thumb icons let you mark a question as good or needing improvement. Feedback is optional; click the selected icon again to clear it, or the other icon to switch. It never blocks Next or generation. Votes persist per question across attempts and work offline.

IndexedDB version 2 adds a separate feedback table while preserving questions, attempts, settings and queues. Ratings stay in this browser; nothing is uploaded or used to automatically alter prompts, answer keys, study sampling or saved questions. Storage failures leave studying usable and display a small local error.

For local developer review, `LocalStudyRepository.getQuestionFeedbackReviewData()` returns ratings joined to questions (including model/prompt provenance) and the associated encounters. It can be called from a local module/debug session importing the repository. Inspect negative ratings as leads, since they do not by themselves establish a defect. Compare them with actual review failures before adding checks; there is no dashboard or cloud feedback collection.

## Question links and history

Each displayed question has a stable `/questions/<uuid>` address. Back and Forward restore the attempt shown on that history entry, including saved answers and follow-up conversations. Refresh uses that same attempt when its history state is available; bookmarks, copied links, and new tabs open the question's latest saved attempt. Opening an existing attempt does not count as another attempt.

In Settings, titles under **Recent question topics** link to the completed attempt represented by each row. The list still contains the last 20 unique completed questions. **Next question** always resumes normal study from the queue or automatic review, including after opening an older question; it does not walk forward through visited questions.

Links work only with data retained in the same browser profile and site origin (protocol, hostname, and port). Another browser, device, or site address will show the question as unavailable. Existing locally stored questions can be reopened offline after the PWA is cached; generation and new follow-up replies require a connection. No cloud synchronization is used.

## Current boundaries

The objective source snapshot is complete for its import date; eligibility mappings are application-authored and require clinical review. AI-generated educational content may be wrong and must not replace clinical guidance. Authentication-backed sync, cloud storage, analytics UI, and data export/import remain deferred.

Generation targets graduating medical students entering supervised practice in Canada. Five choices include one best answer and four distractors, with at least one strong alternative distinguished by supplied case facts or priorities. Numeric difficulty ratings are not used. Deterministic checks and model reviews cannot establish clinical correctness or actual difficulty. Independent clinical calibration and learner-performance data remain outstanding; the held-out smoke test is not clinical certification.
