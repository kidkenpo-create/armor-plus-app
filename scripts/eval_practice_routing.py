"""Extract ARMOR practice DOCX answers and compare them to app routing rules.

Usage:
  python scripts/eval_practice_routing.py "C:\\Users\\kidke\\Downloads\\Practice Questions (2).docx"
  python scripts/eval_practice_routing.py "...docx" --json-out practice-cases.json

This does not call OpenAI. It verifies whether the deterministic issue router
knows which source families/citations the answer key expects.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("docx", type=Path)
    parser.add_argument("--rules", type=Path, default=Path("app/lib/practice-issue-rules.json"))
    parser.add_argument("--json-out", type=Path)
    args = parser.parse_args()

    items = extract_items(args.docx)
    rules = json.loads(args.rules.read_text(encoding="utf-8"))
    results = [evaluate_item(item, rules) for item in items]
    testable_results = [result for result in results if result["testable"]]
    manual_results = [result for result in results if not result["testable"]]

    if args.json_out:
      args.json_out.write_text(json.dumps(items, indent=2), encoding="utf-8")

    covered = [result for result in testable_results if result["covered"]]
    missing = [result for result in testable_results if not result["covered"]]
    print(f"Practice items extracted: {len(items)}")
    print(f"Testable route items: {len(testable_results)}")
    print(f"Covered by routing rules: {len(covered)}")
    print(f"Needs rule/citation review: {len(missing)}")
    print(f"Manual extraction review: {len(manual_results)}")

    if missing:
        print("\nGaps:")
        for result in missing:
            item = result["item"]
            expected = ", ".join(item["expected_citations"]) or item["expected_text"][:120]
            print(f"- #{item['id']} {item['section']}: {item['question'][:95]}")
            print(f"  expected: {expected}")
            print(f"  matched rules: {', '.join(result['matched_rule_ids']) or 'none'}")

    if manual_results:
        print("\nManual extraction review:")
        for result in manual_results:
            item = result["item"]
            print(f"- #{item['id']} {item['section']}: extracted question was too sparse -> {item['question']!r}; expected {item['expected_text'][:120]}")

    print("\nHigh-risk class-deviation or UTR cases:")
    for result in results:
        item = result["item"]
        expected_joined = " ".join(item["expected_citations"] + [item["expected_text"]]).lower()
        if "cd " in expected_joined or "deviation" in expected_joined or "utr" in expected_joined:
            print(f"- #{item['id']}: {item['question'][:90]} -> {item['expected_text'][:130]}")

    return 0 if not missing else 1


def extract_items(path: Path) -> list[dict]:
    if not path.exists():
        raise FileNotFoundError(path)

    with zipfile.ZipFile(path) as docx:
        root = ET.fromstring(docx.read("word/document.xml"))

    paragraphs = []
    for index, paragraph in enumerate(root.iter(W + "p")):
        runs = []
        for run in paragraph.iter(W + "r"):
            text = "".join(t.text or "" for t in run.findall(W + "t"))
            if not text:
                continue
            props = run.find(W + "rPr")
            red = strike = False
            if props is not None:
                color = props.find(W + "color")
                red = color is not None and (color.get(W + "val") or "").upper() == "FF0000"
                strike = props.find(W + "strike") is not None or props.find(W + "dstrike") is not None
            runs.append({"text": text, "red": red, "strike": strike})

        text = "".join(run["text"] for run in runs).strip()
        if not text:
            continue
        paragraphs.append(
            {
                "i": index,
                "text": text,
                "red": "".join(run["text"] for run in runs if run["red"]).strip(),
                "strike": "".join(run["text"] for run in runs if run["strike"]).strip(),
            }
        )

    sections: list[dict] = []
    current = None
    headings = {
        "FAR Research Exercise",
        "FAR/DFARS Research Exercise",
        "FAR/DFARS/Class Deviations Research Exercise",
        "FAR Interpretation Exercise",
        "Day 3 Practice Questions",
        "Day 4 Practice Questions",
    }
    for paragraph in paragraphs:
        if paragraph["text"] in headings:
            current = {"name": paragraph["text"], "paras": []}
            sections.append(current)
        elif current:
            current["paras"].append(paragraph)

    groups: list[dict] = []
    for section in sections:
        if section["name"] == "Day 4 Practice Questions":
            buffer = []
            for paragraph in section["paras"]:
                buffer.append(paragraph)
                if paragraph["text"].lower().startswith("reference:"):
                    groups.append({"section": section["name"], "paras": buffer})
                    buffer = []
            if buffer:
                groups.append({"section": section["name"], "paras": buffer})
        else:
            buffer = []
            for paragraph in section["paras"]:
                if re.match(r"^\d+\.\s+", paragraph["text"]) and buffer:
                    groups.append({"section": section["name"], "paras": buffer})
                    buffer = []
                buffer.append(paragraph)
            if buffer:
                groups.append({"section": section["name"], "paras": buffer})

    items = []
    for item_id, group in enumerate(groups, start=1):
        item = normalize_group(item_id, group["section"], group["paras"])
        if item["question"] or item["expected_text"]:
            items.append(item)
    return items


def normalize_group(item_id: int, section: str, paragraphs: list[dict]) -> dict:
    expected_lines = []
    old_lines = []
    question_lines = []
    seen_strike = False

    for paragraph in paragraphs:
        text = paragraph["text"]
        red = paragraph["red"]
        strike = paragraph["strike"]
        if strike:
            seen_strike = True
            old_lines.append(strike)

        if text.lower().startswith("reference:"):
            if red:
                expected_lines.append(clean_reference(red))
            continue

        if red:
            expected_lines.append(red)
        elif seen_strike and re.search(r"\b(NOW|RFO|DFARS|FAR|CD)\b", text, re.I) and not strike:
            expected_lines.append(text)

        if section != "Day 4 Practice Questions" and (red or strike) and not "?" in text:
            continue
        question_lines.append(text)

    expected_text = "\n".join(line for line in expected_lines if line).strip()
    return {
        "id": item_id,
        "section": section,
        "question": "\n".join(question_lines).strip(),
        "expected_text": expected_text,
        "expected_citations": extract_citations(expected_text),
        "old_text": "\n".join(old_lines).strip(),
    }


def clean_reference(value: str) -> str:
    return re.sub(r"_+", " ", value).strip()


def extract_citations(value: str) -> list[str]:
    patterns = [
        r"\bRFO FAR\s+(?:Part\s+)?\d+(?:\.\d+(?:-\d+)?(?:\([a-z0-9]+\))*)?",
        r"\bFAR\s+(?:Part\s+)?\d+(?:\.\d+(?:-\d+)?(?:\([a-z0-9]+\))*)?",
        r"\bDFARS RFO PGI\s+\d+(?:\.\d+(?:-\d+)?(?:\([a-z0-9]+\))*)?",
        r"\bDFARS RFO\s+\d+(?:\.\d+(?:-\d+)?(?:\([a-z0-9]+\))*)?",
        r"\bDFARS PGI\s+\d+(?:\.\d+(?:-\d+)?(?:\([a-z0-9]+\))*)?",
        r"\bDFARS\s+\d+(?:\.\d+(?:-\d+)?(?:\([a-z0-9]+\))*)?",
        r"\b52\.\d+(?:-\d+)?(?:\([a-z0-9]+\))*",
        r"\bCD\s+\d{4}-O\d{4}(?:,\s*Revision\s*\d+)?",
    ]
    found: list[str] = []
    for pattern in patterns:
        found.extend(match.group(0).strip() for match in re.finditer(pattern, value, flags=re.I))
    return list(dict.fromkeys(found))


def evaluate_item(item: dict, rules: list[dict]) -> dict:
    question = normalize(item["question"])
    testable = len(re.sub(r"[^a-z0-9]", "", question)) >= 16
    matched_rules = [rule for rule in rules if any(normalize(term) in question for term in rule["match"])]
    expected = [citation_key(value) for value in item["expected_citations"]]
    offered = [
        citation_key(citation)
        for rule in matched_rules
        for citation in rule.get("expectedCitations", [])
    ]

    covered = False
    if expected:
        covered = any(
            any(exp in got or got in exp for got in offered)
            for exp in expected
        )
    elif item["expected_text"]:
        covered = bool(matched_rules)

    return {
        "item": item,
        "testable": testable,
        "covered": covered,
        "matched_rule_ids": [rule["id"] for rule in matched_rules],
    }


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower().replace("’", "'").replace("“", '"').replace("”", '"')).strip()


def citation_key(value: str) -> str:
    normalized = normalize(value)
    normalized = normalized.replace("dfars rfo pgi", "dfars pgi")
    normalized = normalized.replace("dfars rfo", "dfars")
    normalized = normalized.replace("rfo far", "far")
    normalized = normalized.replace("part ", "")
    return re.sub(r"[^a-z0-9().-]", "", normalized)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise
