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
