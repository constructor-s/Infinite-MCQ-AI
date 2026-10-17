#!/usr/bin/env python3
"""Materialize application-authored eligibility tuples, never official MCC mappings.

Discipline lists start with Study smarter pp. 7-10, extended for omitted objectives.
Care profiles are deliberately selective. Task eligibility requires supporting source
wording, and stores that wording's enabling-clause ID for prompt grounding/review.
Inspect curriculum/crosswalk.json after every source refresh; clinical review remains
necessary. This script does not establish medical validity by keyword matching.
"""
import json
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Exact child IDs: legacy group numbers must never collapse distinct presentations.
DISCIPLINES = {
    "medicine": "1 2 3-2 3-3 4 6-1 7 8 9-1 9-2 10-1 12-2 13 14 15-1 15-2 16-1 18 22-1 22-2 23 24 25 26 27 29-1 29-2 30 31-1 32 33 35 38 39 40 41 42-1 42-2 44 45 49 50-1 50-2 50-3 50-4 51 52 53 54 58-1 58-2 60 62 63 66 67-1-2-1 67-2-2 68 74 74-3 76 77 79-1 79-2 84 85 89-1 89-2 92 94 97-2 98 99-1 99-2 100 106 107-1 107-4 107-5 108 109-12 110-1 110-2 111-1 115-1 116 117 118-1 118-2 120 125 129 130",
    "surgery": "1 2 2-4 3-1 3-2 3-3 3-4 6-1 6-2 7 10-1 10-2 11 15-1 18 22-2 25 26 27 27-3 28 30 32 33 38 39 40 41 47-1 50-1 50-4 50-5 53 54-1 63 66 68 74-3 77 90 91 107-1 109 109-1 109-3 109-4 109-6 109-8 109-10 109-11 109-12 109-13 109-14 109-15 110-1 111-1 115-2 116 117",
    "pediatrics": "2 3-1 4 5 6-2 8 9-1 9-2 11 13 15-1 16-2 18 19 20 21 21-1 22-1 22-2 22-3 27 27-3 28 29-1 30 31-2 35 36 36-2 38 39 40 42-1 47-3 49 49-1 50-1 54 56-2 60 61 64 71-1 71-2 74 74-1 74-2 74-3 74-5 77 78-6 79-1 79-2 84 85 89-2 90 91 92 93-1 94-1 97-2 98 100 101 102 103-1 104 106 107-1 107-4 107-5 108 109-3 109-6 109-12 110-1 110-2 114-1 116 117 118-1 118-2 129 130",
    "obgyn": "2 9-1 9-2 10-2 17 36 36-2 38 46 47-2 52 56-1 56-2 56-3 57 73 80-1 80-2 81 82 83 94-1 110-1 112 113 114-3 118-3",
    "psychiatry": "3-3 5 21 21-1 31-1 32 33 56-3 58-2 58-3 59-1 59-2 61 67-1-2-1 69 74-5 75 86 94 94-1 98 103 103-1 105 107-1 114-1 114-2 114-3 118-2 123 124 125 128",
    "phelo": "25 74 74-2 78-1 78-2 78-3 78-4 78-5 78-6 78-8 78-9 78-10 78-11 78-12 78-13 104-1 114-1 114-2 114-3 121-1 121-2 121-3 121-5 125 126 127",
}

# Application-authored care eligibility, intentionally not a Cartesian product.
CARE = {
    "acute": "1 2 2-4 3-1 3-2 3-4 4 6-1 6-2 7 8 9-1 9-2 10-1 10-2 11 12-2 13 14 15-1 16-1 16-2 18 19 20 22-1 22-3 23 24 25 26 27 27-3 28 29-1 29-2 30 32 33 35 38 39 40 41 42-1 42-2 44 45 47-1 47-2 49 49-1 50-1 50-2 50-3 50-4 50-5 52 53 54 54-1 56-2 58-1 58-2 59-1 59-2 60 61 62 63 64 66 68 69 71-1 71-2 73 76 77 78-5 78-10 79-1 79-2 80-2 81 82 84 85 86 89-1 90 91 92 97-2 98 99-1 99-2 100 103 103-1 104 104-1 105 106 107-1 107-4 107-5 108 109 109-1 109-3 109-4 109-6 109-8 109-10 109-11 109-12 109-13 109-14 109-15 110-1 110-2 111-1 112 113 114-1 114-2 114-3 115-1 115-2 116 117 118-3 120 121-1 121-2 121-3 121-5 125 126 128 129 130",
    "chronic": "1 2 2-4 3-1 3-3 3-4 4 5 7 8 9-1 10-1 10-2 12-2 15-1 16-1 16-2 18 20 21 21-1 22-2 23 24 25 26 27 29-1 29-2 30 31-1 31-2 32 33 35 36 36-2 38 39 40 42-1 42-2 44 45 46 47-1 47-2 47-3 49 50-1 50-2 50-3 50-4 50-5 51 52 53 54 54-1 56-1 56-2 56-3 57 58-3 59-1 59-2 60 61 62 63 66 67-1-2-1 67-2-2 68 69 71-2 73 74-5 75 76 78-6 78-8 78-9 78-11 78-13 83 84 85 86 89-2 90 92 93-1 94 94-1 98 101 102 103 107-4 108 110-1 110-2 111-1 112 113 115-2 117 118-1 118-2 120 121-1 121-2 121-3 121-5 123 124 125 126 127 128 129 130",
    "prevention": "4 5 9-1 15-2 17 21 21-1 31-1 32 36 36-2 41 46 51 57 74 74-1 74-2 74-3 74-5 78-1 78-2 78-3 78-4 78-5 78-6 78-8 78-9 78-10 78-11 78-12 78-13 80-1 93-1 94-1 101 103 104 104-1 109 109-6 114-1 114-2 114-3 118-1 118-3 121-3 125 126 127 129 130",
    "psychosocial": "5 21 21-1 25 31-1 31-2 32 36 46 56-3 58-3 59-1 59-2 67-1-2-1 69 74-5 75 78-1 78-3 78-4 78-8 78-9 78-13 86 94 94-1 98 103 105 114-1 114-2 114-3 118-1 118-2 121-1 121-2 121-5 123 124 127 128 130",
}

# Source support for task-specific grounding. These are authoring aids, not a
# medical classifier. The materialized tuples are the runtime source of truth.
PATTERNS = {
    "most_likely_diagnosis": r"diagnos|cause|etiolog|recogniz|identify.*condition",
    "differential_diagnosis": r"differentiat|differential|distinguish|diagnos.*cause",
    "history_priorities": r"history|interview|historical",
    "physical_exam_interpretation": r"physical exam|examination|clinical findings|clinical features",
    "diagnostic_investigation": r"investigat|diagnostic test|screening test",
    "laboratory_interpretation": r"laboratory|electrolyte|blood test|serum|urinalysis|blood count|biochem|hemoglobin|reticulocyte|blood smear|red cell morphology|\bCBC\b",
    "imaging_interpretation": r"imaging|radiograph|ultraso|computed tomography|magnetic resonance",
    "ecg_interpretation": r"electrocardio|\bECG\b|\bEKG\b",
    "diagnostic_criteria": r"diagnostic criteria|criteria for.*diagnos|criteria.*disorder|differentiation of clinical syndromes|differentiating situational stress",
    "risk_stratification": r"risk assess|assess.*risk|risk factors|risk strat|prognos",
    "evidence_statistical_interpretation": r"statistic|epidemiol|critical appraisal|research|evidence.based|study design|sensitivity|specificity",
    "initial_stabilization": r"resuscitat|stabiliz|emergen|urgent|life.threatening",
    "treatment_choice": r"treatment|therap|management plan|manage.*condition",
    "pharmacology_contraindications": r"pharmac|medication|contraindicat|adverse.*effect|prescrib",
    "procedural_intervention": r"surgical|surgery|therapeutic.*proced|paracentesis|drainage|operative|catheteriz",
    "long_term_management": r"long.term|ongoing.*care|chronic|rehabilitat|maintenance",
    "follow_up_monitoring": r"follow.up|monitor|surveillance|reassess",
    "disposition_escalation": r"referr|specialized care|specialist|admission|hospitaliz|disposition",
    "patient_counselling": r"counsel|educat.*patient|patient.*educat|explain|communicat",
    "informed_consent_discussion": r"informed consent|risks and benefits|benefits and risks",
    "shared_decision_making": r"shared|preferences|patient.*values|collaborat.*patient|patient.*choice",
    "difficult_news": r"bad news|difficult news|challenging situations|dying|end.of.life|bereave",
    "health_literacy": r"literacy|plain language|clear language|understanding|interpreter",
    "treatment_barriers": r"barriers|afford|financial|access to|social.*support|inequit|socioeconomic",
    "ethics": r"ethical|ethics|autonomy|equitable|conflict of interest",
    "confidentiality": r"confidential|privacy|disclos.*information",
    "capacity_consent": r"capacity|consent|substitute decision|competent patient",
    "professional_boundaries": r"boundar|dual relationship|professional relationship|conflict of interest",
    "patient_safety": r"patient safety|prevent.*harm|quality improvement|safety incident",
    "error_disclosure": r"disclos.*error|error.*disclos|adverse events|medical error",
    "canadian_obligations": r"legal|legislat|mandatory|reporting|regulat|jurisdiction",
}

# Explicit role/task overrides prevent lexical collisions such as "maintenance
# of patient records" being treated as long-term treatment, or "access to
# records" being treated as a financial barrier to treatment.
ROLE_TASK_PATTERNS = {
    "collaborator": {"shared_decision_making": r"shared decision", "confidentiality": r"respecting confidentiality"},
    "communicator": {
        "patient_counselling": r"Provide information using clear language",
        "informed_consent_discussion": r"requirements for obtaining informed consent",
        "shared_decision_making": r"Establish a common understanding",
        "difficult_news": r"delivering bad news",
        "health_literacy": r"Provide information using clear language",
        "confidentiality": r"Maintain confidentiality of medical records",
        "capacity_consent": r"substitute decision-maker",
        "error_disclosure": r"Disclose error and adverse events",
        "canadian_obligations": r"mandatory disclosures",
    },
    "health-advocate": {"shared_decision_making": r"Support and collaborate", "treatment_barriers": r"common barriers to health",
                        "ethics": r"ethical, medicolegal", "canadian_obligations": r"government legislation"},
    "leader-manager": {"ethics": r"Avoid conflicts of interest", "patient_safety": r"enhancing patient safety",
                       "canadian_obligations": r"regulatory requirements"},
    "professional": {"ethics": r"ethical and legal aspects", "confidentiality": r"Maintain patient confidentiality",
                     "professional_boundaries": r"boundaries in relationships", "patient_safety": r"commitment to patient safety",
                     "canadian_obligations": r"rules, regulations"},
    "scholar": {"evidence_statistical_interpretation": r"principles of screening", "ethics": r"conformity to ethical standards"},
}


def main():
    snapshot = json.loads((ROOT / "curriculum/objectives.json").read_text())
    config = json.loads((ROOT / "curriculum/blueprint.json").read_text())
    rows = []
    for obj in snapshot["objectives"]:
        role = obj["role"] != "expert"
        disciplines = list(DISCIPLINES) if role else [d for d, ids in DISCIPLINES.items() if obj["id"] in ids.split()]
        cares = list(CARE) if role else [c for c, ids in CARE.items() if obj["id"] in ids.split()]
        if not disciplines or not cares:
            raise ValueError(f"Missing explicit profile: {obj['id']} {obj['title']}")
        for task, pattern in PATTERNS.items():
            activity = config["cognitiveTasks"][task]["physicianActivity"]
            if obj["id"] == "78-2" and task != "evidence_statistical_interpretation":
                continue
            if role:
                pattern = ROLE_TASK_PATTERNS[obj["role"]].get(task)
                if pattern is None:
                    continue
            matching = [c for c in obj["enablingObjectives"] if re.search(pattern, c["text"], re.I)]
            if not matching:
                continue
            clause = matching[0]
            for discipline in disciplines:
                for care in cares:
                    # Stabilization requires an acute episode, and long-term tasks a chronic course.
                    if task == "initial_stabilization" and care != "acute":
                        continue
                    if task == "long_term_management" and care != "chronic":
                        continue
                    rows.append({"objectiveId": obj["id"], "discipline": discipline,
                                 "physicianActivity": activity, "careDimension": care,
                                 "cognitiveTasks": [task], "enablingObjectiveId": clause["id"], "baselinePriority": 1})
    missing = {o["id"] for o in snapshot["objectives"]} - {r["objectiveId"] for r in rows}
    tasks_missing = set(PATTERNS) - {t for r in rows for t in r["cognitiveTasks"]}
    if missing or tasks_missing:
        raise ValueError(f"Missing objectives {missing}; tasks {tasks_missing}")
    grouped = {}
    for row in rows:
        key = tuple(row[k] for k in ("objectiveId", "discipline", "physicianActivity", "careDimension", "enablingObjectiveId"))
        if key in grouped:
            grouped[key]["cognitiveTasks"].extend(row["cognitiveTasks"])
        else:
            grouped[key] = row
    rows = list(grouped.values())
    digest = hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()[:12]
    data = {"version": f"iworld-crosswalk-2026-v1-{digest}", "curriculumVersion": snapshot["version"],
            "provenance": "application_authored", "clinicalReviewStatus": "requires_clinical_review",
            "disciplineSource": "Study smarter, 2026, pp. 7-10, with application-authored extensions",
            "notes": "Explicit tuples, not official MCC joint probabilities. Source-clause matching is an authoring aid; it is not proof of clinical eligibility.",
            "entries": rows}
    (ROOT / "curriculum/crosswalk.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(f"Materialized {len(rows)} tuples for {len(snapshot['objectives'])} objectives and {len(PATTERNS)} tasks")


if __name__ == "__main__":
    main()
