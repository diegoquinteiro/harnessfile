#!/usr/bin/env python3
"""Deterministic aggregation for the risk-assessment skill.

Judgment (the four 1-5 scores) belongs to the model; the math that turns those
scores into an overall risk level, an ambiguity band, and a set of safeguards is
deterministic so the verdict is reproducible run-to-run.

Risk (blast radius + complexity) and ambiguity are kept SEPARATE on purpose: risk
measures how bad it is if the code is wrong, ambiguity measures how likely we are to
build the wrong thing. They drive different gates, so ambiguity is never folded into
the weighted risk number.

Usage:
    score.py --complexity N --code-blast N --business-blast N --ambiguity N \
             [--source multica|github|text]

Prints a JSON object on stdout.
"""

import argparse
import json
import sys

WEIGHTS = {"business": 0.5, "code": 0.3, "complexity": 0.2}

# Weighted-average buckets for the risk level (see SKILL.md "Risk math").
LOW_MAX = 2.3
MED_MAX = 3.6


def risk_level(overall: float) -> str:
    if overall <= LOW_MAX:
        return "Low"
    if overall <= MED_MAX:
        return "Medium"
    return "High"


def band(score: int) -> str:
    """Per-dimension band: 1-2 low, 3 medium, 4-5 high."""
    if score <= 2:
        return "low"
    if score == 3:
        return "medium"
    return "high"


def safeguards(level: str, complexity: int, code: int, business: int) -> list[str]:
    out: list[str] = []
    if code >= 4:
        out.append(
            "High code blast radius: split into smaller, independently reviewable PRs and "
            "expand regression tests around the shared/cross-cutting code being touched."
        )
    if complexity >= 4:
        out.append(
            "High complexity: do not skip the Planner gate; expect iteration and require a "
            "Tester pass before review."
        )
    if business >= 4:
        out.append(
            "High business blast radius: require the human gate plus extra Reviewer scrutiny; "
            "consider shipping behind a feature flag with a staged rollout and a clear rollback plan."
        )
    if business >= 5:
        out.append(
            "Trust & safety surface (auth / tenant isolation): add targeted tests for "
            "account/data separation, and never let this merge without human review."
        )
    if level == "Low" and not out:
        out.append("Low risk: standard review is sufficient; no special safeguards required.")
    return out


def main() -> int:
    p = argparse.ArgumentParser(description="Aggregate risk-assessment scores.")
    p.add_argument("--complexity", type=int, required=True, choices=range(1, 6))
    p.add_argument("--code-blast", type=int, required=True, choices=range(1, 6))
    p.add_argument("--business-blast", type=int, required=True, choices=range(1, 6))
    p.add_argument("--ambiguity", type=int, required=True, choices=range(1, 6))
    p.add_argument("--source", choices=["multica", "github", "text"], default="text")
    args = p.parse_args()

    overall = round(
        WEIGHTS["business"] * args.business_blast
        + WEIGHTS["code"] * args.code_blast
        + WEIGHTS["complexity"] * args.complexity,
        2,
    )
    level = risk_level(overall)

    result = {
        "scores": {
            "code_blast_radius": args.code_blast,
            "complexity": args.complexity,
            "business_blast_radius": args.business_blast,
        },
        "overall_score": overall,
        "risk_level": level,
        "formula": "0.5*business + 0.3*code + 0.2*complexity",
        "buckets": {"low": f"<= {LOW_MAX}", "medium": f"<= {MED_MAX}", "high": f"> {MED_MAX}"},
        # Ambiguity is a SEPARATE signal, not part of the risk number above.
        "ambiguity": {"score": args.ambiguity, "band": band(args.ambiguity)},
        "safeguards": safeguards(level, args.complexity, args.code_blast, args.business_blast),
        "source": args.source,
    }
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
