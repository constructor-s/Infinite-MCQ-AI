#!/usr/bin/env python3
"""Refresh the source snapshot only; eligibility mappings are maintained separately.

python3 scripts/import-mcc-objectives.py --retrieved-at YYYY-MM-DD
No model calls or inferred official identifiers are used by this importer.
"""
import argparse
import hashlib
import json
import re
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FEED = "https://mcc.ca/wp-json/mcc/medical-expert/en/?type=json&content=true"
ROLES = ["collaborator", "communicator", "health-advocate", "leader-manager", "professional", "scholar"]


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in ("p", "li", "h1", "h2", "h3", "br"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("p", "li", "h1", "h2", "h3"):
            self.parts.append("\n")

    def handle_data(self, data):
        self.parts.append(data)


def plain(html):
    parser = Text()
    parser.feed(html)
    return "\n".join(re.sub(r"\s+", " ", line).strip() for line in "".join(parser.parts).splitlines() if line.strip())


def clauses(content):
    # Preserve source wording and order. Stable local indices are scoped to snapshot version.
    parts = re.split(r"(?:Enabling Objectives|Objectives)\n", content, flags=re.I)
    body = parts[-1] if len(parts) > 1 else content
    return [{"id": f"enabling-{i + 1}", "text": line} for i, line in enumerate(body.splitlines()) if len(line) > 25]


class EnablingLists(HTMLParser):
    """Keep each list item's descendants so a parent retains its clinical scope."""
    def __init__(self):
        super().__init__()
        self.stack = []
        self.items = []

    def handle_starttag(self, tag, attrs):
        if tag == "li":
            item = []
            self.items.append(item)
            self.stack.append(item)
        if tag in ("li", "p", "br"):
            for item in self.stack:
                item.append(" ")

    def handle_data(self, data):
        for item in self.stack:
            item.append(data)

    def handle_endtag(self, tag):
        if tag == "li" and self.stack:
            self.stack.pop()


def enabling_clauses(html, content):
    parts = re.split(r'<h[23][^>]*>\s*(?:Enabling )?Objectives\s*</h[23]>', html, flags=re.I)
    if len(parts) < 2:
        return clauses(content)
    parser = EnablingLists()
    parser.feed(parts[-1])
    values = [re.sub(r"\s+", " ", "".join(item)).strip() for item in parser.items]
    values = [value for value in values if len(value) > 25]
    return [{"id": f"enabling-{i + 1}", "text": value} for i, value in enumerate(values)] or clauses(content)


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "IWorld-curriculum-import/1.0"}), timeout=30) as response:
        return response.read().decode("utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--retrieved-at", required=True)
    parser.add_argument("--medical-expert-json", type=Path)
    args = parser.parse_args()
    raw = args.medical_expert_json.read_text() if args.medical_expert_json else fetch(FEED)
    expert = json.loads(raw)
    objectives = []
    for item in expert:
        content = plain(item["content"])
        objectives.append({
            "id": item["id"], "sourceId": item["id"], "identifierKind": "official",
            "role": item["role"], "title": item["title"], "language": item["language"],
            "sourceVersion": item["version"], "sourceUrl": FEED, "group": item["group"],
            "retrievedAt": args.retrieved_at, "content": content, "enablingObjectives": enabling_clauses(item["content"], content),
        })
    for role in ROLES:
        url = f"https://mcc.ca/objectives/{role}/"
        html = fetch(url).split("<footer", 1)[0]
        # Role content lives in text-editor widgets. Exclude navigation and global footer.
        widgets = re.findall(r'elementor-widget-text-editor.*?<div class="elementor-widget-container">(.*?)</div>', html, re.S)
        content = "\n".join(plain(widget) for widget in widgets)
        if not content or "objective" not in content.lower():
            raise ValueError(f"Could not identify objective content at {url}")
        dates = re.findall(r'(?:Updated|Revised|Version|Last updated)\s*:?\s*([A-Za-z]+\s+\d{4})', plain(html), re.I)
        objectives.append({
            "id": f"role:{role}", "sourceId": None, "identifierKind": "source_url_derived",
            "role": role, "title": role.replace("-", " ").title(), "language": "en",
            "sourceVersion": dates[0] if dates else None, "sourceUrl": url, "group": {"id": "", "title": ""},
            "retrievedAt": args.retrieved_at, "content": content, "enablingObjectives": enabling_clauses("\n".join(widgets), content),
        })
    if len({o["id"] for o in objectives}) != len(objectives):
        raise ValueError("Duplicate objective identifiers")
    digest = hashlib.sha256(json.dumps(objectives, sort_keys=True).encode()).hexdigest()[:12]
    result = {"version": f"mcc-en-{args.retrieved_at}-{digest}", "retrievedAt": args.retrieved_at,
              "sources": [FEED] + [f"https://mcc.ca/objectives/{role}/" for role in ROLES], "objectives": objectives}
    target = ROOT / "curriculum/objectives.json"
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    # The browser needs identifiers and source metadata, not full objective prose.
    catalogue = {k: v for k, v in result.items() if k != "objectives"}
    catalogue["objectives"] = [{k: v for k, v in obj.items() if k not in ("content", "enablingObjectives")} for obj in objectives]
    (ROOT / "curriculum/catalogue.json").write_text(json.dumps(catalogue, ensure_ascii=False, indent=2) + "\n")
    print(f"Imported {len(expert)} medical-expert and {len(ROLES)} role objectives into {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
