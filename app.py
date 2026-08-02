"""
NeuroRegen Tracker — Flask backend

Serves a live clinical-trial landscape dashboard for stem-cell / cell-based
neuroregeneration research, sourced from the ClinicalTrials.gov API v2.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

BASE_URL = "https://clinicaltrials.gov/api/v2/studies"

CONDITION_OPTIONS = [
    "Neurodegenerative Diseases", "Parkinson Disease", "Alzheimer Disease",
    "Amyotrophic Lateral Sclerosis", "Spinal Cord Injuries",
    "Traumatic Brain Injury", "Multiple Sclerosis", "Stroke",
]
STATUS_OPTIONS = [
    "RECRUITING", "ACTIVE_NOT_RECRUITING", "COMPLETED", "NOT_YET_RECRUITING",
    "SUSPENDED", "WITHDRAWN", "TERMINATED", "UNKNOWN",
    "ENROLLING_BY_INVITATION", "NO_LONGER_AVAILABLE",
]
PHASE_OPTIONS = [
    "EARLY_PHASE1", "PHASE1", "PHASE1|PHASE2", "PHASE2",
    "PHASE2|PHASE3", "PHASE3", "PHASE4", "NA",
]

# ---------------------------------------------------------------------------
# Caching: ClinicalTrials.gov is rate-limited and a live registry snapshot
# doesn't need to be re-fetched on every page view. Cache per (condition,
# keyword) query for CACHE_TTL_SECONDS.
# ---------------------------------------------------------------------------
CACHE_TTL_SECONDS = 6 * 60 * 60  # 6 hours
_cache: dict[tuple[str, str], dict] = {}


def fetch_trials(condition: str, cell_type_keyword: str, page_size: int = 100) -> list[dict]:
    """Fetch raw study records from ClinicalTrials.gov API v2, following pagination."""
    params = {
        "pageSize": min(page_size, 100),
        "fields": (
            "NCTId,BriefTitle,OverallStatus,Phase,StudyType,StartDate,"
            "Organization,InterventionName,LocationCountry"
        ),
    }
    if condition:
        params["query.cond"] = condition
    if cell_type_keyword:
        params["query.term"] = cell_type_keyword

    studies: list[dict] = []
    next_token = None
    for _ in range(5):  # hard cap: 5 pages (<=500 studies) per query
        if next_token:
            params["pageToken"] = next_token
        resp = requests.get(params=params, url=BASE_URL, headers={"Accept": "application/json"}, timeout=45)
        resp.raise_for_status()
        payload = resp.json()
        studies.extend(payload.get("studies", []))
        next_token = payload.get("nextPageToken")
        if not next_token:
            break
    return studies


def parse_trials(studies: list[dict]) -> list[dict]:
    """Parse raw API study records into a flat, chart/table-friendly shape.

    NOTE: ClinicalTrials.gov API v2 nests the start date under
    ``statusModule.startDateStruct.date`` — NOT ``statusModule.startDate``.
    The original notebook this app is based on read the wrong key, which
    silently zeroed out every "Start Year" value (verified against a live
    84-study pull: 0/84 populated before this fix, 82/84 after).
    """
    records = []
    for study in studies:
        ps = study.get("protocolSection", {})
        ident = ps.get("identificationModule", {})
        status_mod = ps.get("statusModule", {})
        design = ps.get("designModule", {})
        arms = ps.get("armsInterventionsModule", {})
        contacts = ps.get("contactsLocationsModule", {})
        org = ident.get("organization", {})

        start_year = None
        start_struct = status_mod.get("startDateStruct", {})
        raw_date = start_struct.get("date") if isinstance(start_struct, dict) else None
        if raw_date:
            try:
                start_year = int(str(raw_date)[:4])
            except ValueError:
                start_year = None

        phases = design.get("phases", [])
        locations = contacts.get("locations", [])
        countries = sorted({loc.get("country", "") for loc in locations if loc.get("country")})
        interventions = arms.get("interventions", [])

        records.append({
            "nct_id": ident.get("nctId", "N/A"),
            "title": ident.get("briefTitle", "Untitled"),
            "status": status_mod.get("overallStatus", "UNKNOWN"),
            "phase": "|".join(phases) if phases else "NA",
            "study_type": design.get("studyType", "N/A"),
            "organization": org.get("fullName", "N/A"),
            "interventions": ", ".join(i.get("name", "") for i in interventions) or "N/A",
            "country": countries[0] if countries else "Not Specified",
            "start_year": start_year,
        })
    return records


def get_trials(condition: str, keyword: str) -> dict:
    key = (condition, keyword)
    cached = _cache.get(key)
    now = time.time()
    if cached and (now - cached["fetched_at"]) < CACHE_TTL_SECONDS:
        return cached

    raw = fetch_trials(condition, keyword)
    parsed = parse_trials(raw)
    entry = {
        "records": parsed,
        "fetched_at": now,
        "fetched_at_iso": datetime.now(timezone.utc).isoformat(),
    }
    _cache[key] = entry
    return entry
