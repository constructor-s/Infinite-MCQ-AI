# IWorld

IWorld is a local-first MCCQE clinical reasoning PWA. It generates one question at a time with Gemini, keeps ten fresh questions in IndexedDB, and falls back to missed-first review when generation is unavailable.

## Local setup

1. Install Node.js 22 or newer and run `npm install`.
2. Copy `.env.example` to `.env.local` and set a Google AI Studio free-tier `GEMINI_API_KEY`.
3. Run `npm run dev`. Vite binds to all network interfaces; open the printed **Network** URL on a phone connected to the same LAN.

If the phone shows a cached page but generation cannot connect, confirm the terminal still shows the dev server running, reload the Network URL, and ensure the operating-system firewall permits incoming Node.js connections.

No study questions are shipped in the queue. A first launch requires a working Gemini key and network connection. Generation uses the checked-in MCC objective snapshot and blueprint configuration described below; editing these requires a rebuild. The prompt includes one original style exemplar, not an official MCC practice item.

## Blueprint and question generation

`curriculum/blueprint.json` defines the MCCQE marginal targets: assessment/diagnosis 45%, management 35%, communication 10%, and professional behaviours 10%; acute 35%, chronic 30%, prevention 20%, and psychosocial 15%. The official tolerances are ±5 percentage points. Six equal discipline weights are approximate study-guide guidance, not official fixed quotas. There is no official joint distribution; independence products are used only as a fallback after eligibility filtering.

Before calling Gemini, the browser chooses an eligible discipline/activity/care combination that minimizes target-weighted squared deviation in the next rolling 200-question window. Successfully generated questions count once, including queued and currently displayed questions. Reviews and failed generations do not count. Objective abundance cannot change category weights.

Within the chosen combination, 70% of objective draws use baseline priorities and 30% use bounded weakness, spacing and coverage multipliers. Weakness uses the latest 20 first-attempt outcomes per objective, with Beta(1,1) smoothing; revealing an unanswered question counts as a miss. Spacing reaches its maximum at 30 days; unseen objectives receive neutral weakness and high coverage priority. The least recently used eligible cognitive task is selected next. Personalization stays within the selected blueprint combination.

The server validates the assignment against `curriculum/crosswalk.json`, then assembles a shared prompt with the source objective, a specific enabling clause, task/care instructions, recent scenarios to avoid, and one rotating task-matched original example. New vignettes are single paragraphs. Every question and encounter records blueprint tags; questions and generation events also record blueprint, curriculum, crosswalk and prompt versions. Questions retain the selected enabling-clause identifier. No second model call is used for validation: schema, paragraph, answer-leak, duplicate and obvious task-mismatch rules run locally on the server. One correction retry retains the same assignment. These rules cannot prove clinical correctness or semantic alignment.

Only schema-version-2 paragraph questions are supported. Pre-existing browser records are left untouched but older question formats are excluded from the active queue and review. Settings and new study history continue using the same IndexedDB database. `curriculum/topics.json` is the original starter reference and no longer controls generation.

## MCC source snapshot and maintenance

`curriculum/objectives.json` contains 192 medical-expert objectives and six CanMEDS role objectives imported on October 16, 2026. Official IDs (including child IDs), group metadata, source wording, versions, URLs and retrieval dates are preserved. Non-expert pages lack official IDs and revision dates: their `role:` IDs are explicitly local/source-derived and their source version is null. `curriculum/catalogue.json` carries browser-safe metadata; full source text is server-only. No live MCC fetch is needed while studying.

Refresh the snapshot and rebuild the eligibility crosswalk with Python's standard library:

```sh
python3 scripts/import-mcc-objectives.py --retrieved-at YYYY-MM-DD
python3 scripts/build-mcc-crosswalk.py
```

The crosswalk is application-authored, starting from the study guide's discipline lists and extending omitted objectives. Explicit tuples bind an objective, discipline, activity, care dimension, task and enabling clause. The authoring script uses selective care profiles, source-clause matching, and explicit role overrides; inspect its output after any refresh. It is not an official MCC mapping or a substitute for clinical review. Its review status is recorded in the JSON. A content-hash version detects inconsistent snapshots, catalogues and crosswalks in tests.

`curriculum/exemplars.json` contains two original micro-exemplars per cognitive task, calibrated to the official practice set's prose and answer styles. The official 55-item set is a style reference, not an estimate of blueprint frequencies. `curriculum/practice-calibration.json` records structural observations for all 55 supplied questions. `curriculum/evaluation.json` reserves separate requests and a manual review rubric for offline evaluation; it is never injected into generation prompts. Recorded results and unresolved content-quality findings are in [the evaluation review](docs/generation-evaluation.md). Run the local evaluation against an already running development server:

```sh
node scripts/evaluate-generation.mjs https://localhost:5173 /tmp/iworld-generation-evaluation.json
```

This command makes billable/quota-consuming Gemini calls. Review each saved item for blueprint/task alignment, factual accuracy, one best answer, original scenario, homogeneous distractors and concise prose. Deterministic sampling tests independently simulate 10,000 selections and check every 200-item window, including concentrated weaknesses and uneven objective counts.

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

## Current boundaries

The objective source snapshot is complete for its import date; eligibility mappings are application-authored and require clinical review. AI-generated educational content may be wrong and must not replace clinical guidance. Authentication-backed sync, cloud storage, analytics UI, and data export/import remain deferred.
