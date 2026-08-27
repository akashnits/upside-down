#!/usr/bin/env python3
"""Batch the recruiter email waterfall without exposing provider responses.

Input: JSON array on stdin. Each item needs name, linkedin_url, company_name,
and company_website. Output: JSON array with normalized result fields only.
"""

from __future__ import annotations

import concurrent.futures
import json
import os
import re
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
TIMEOUT_SECONDS = 25


def request_json(url: str, headers: dict[str, str], payload: dict[str, Any]) -> dict[str, Any] | None:
    body = json.dumps(payload).encode("utf-8")
    request = Request(url, data=body, headers={**headers, "Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            parsed = json.loads(response.read().decode("utf-8"))
            return parsed if isinstance(parsed, dict) else None
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
        return None


def valid_email(value: Any) -> bool:
    return isinstance(value, str) and bool(EMAIL_RE.match(value.strip()))


def accepted(item: dict[str, Any], provider: str, email: Any, response: dict[str, Any]) -> dict[str, Any] | None:
    if not valid_email(email):
        return None
    result: dict[str, Any] = {
        "name": item.get("name", ""),
        "linkedin_url": item.get("linkedin_url", ""),
        "email": email.strip(),
        "provider": provider,
        "status": "verified",
    }
    person = response.get("person")
    if isinstance(person, dict):
        if person.get("full_name"):
            result["provider_full_name"] = person["full_name"]
        if person.get("linkedin_url"):
            result["provider_linkedin_url"] = person["linkedin_url"]
    for key in ("person_full_name", "person_company_name", "person_job_title"):
        if response.get(key):
            result[key] = response[key]
    return result


def miss(item: dict[str, Any], status: str = "not found") -> dict[str, Any]:
    return {"name": item.get("name", ""), "linkedin_url": item.get("linkedin_url", ""), "status": status}


def call_anymail(item: dict[str, Any], key: str | None) -> dict[str, Any]:
    if not key:
        return miss(item, "provider unavailable")
    response = request_json(
        "https://api.anymailfinder.com/v5.1/find-email/linkedin-url",
        {"Authorization": key},
        {"linkedin_url": item.get("linkedin_url", "")},
    ) or {}
    result = accepted(item, "AnyMail Finder", response.get("valid_email"), response) if response.get("email_status") == "valid" else None
    return result or miss(item)


def call_prospeo(item: dict[str, Any], key: str | None) -> dict[str, Any]:
    if not key:
        return miss(item, "provider unavailable")
    response = request_json(
        "https://api.prospeo.io/enrich-person",
        {"X-Key": key},
        {
            "only_verified_email": True,
            "data": {"full_name": item.get("name", ""), "company_website": item.get("company_website", "")},
        },
    ) or {}
    person = response.get("person") if isinstance(response.get("person"), dict) else {}
    email = person.get("email") if isinstance(person.get("email"), dict) else {}
    result = accepted(item, "Prospeo", email.get("email"), response) if response.get("error") is False and email.get("status") == "VERIFIED" and email.get("revealed") is True else None
    return result or miss(item)


def call_leadmagic(item: dict[str, Any], key: str | None) -> dict[str, Any]:
    if not key:
        return miss(item, "provider unavailable")
    response = request_json(
        "https://api.leadmagic.io/v1/people/email-finder",
        {"X-Api-Key": key},
        {
            "first_name": item.get("first_name", ""),
            "last_name": item.get("last_name", ""),
            "company_name": item.get("company_name", ""),
        },
    ) or {}
    result = accepted(item, "LeadMagic", response.get("email"), response) if response.get("status") == "valid" else None
    return result or miss(item)


def parallel(items: list[dict[str, Any]], function: Any, key: str | None) -> list[dict[str, Any]]:
    if not items:
        return []
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(items))) as executor:
        return list(executor.map(lambda item: function(item, key), items))


def main() -> int:
    try:
        items = json.load(sys.stdin)
        if not isinstance(items, list):
            raise ValueError("input must be a JSON array")
    except (json.JSONDecodeError, ValueError):
        return 2

    keys = {
        "anymail": os.environ.get("ANYMAIL_FINDER_API_KEY"),
        "prospeo": os.environ.get("PROSPEO_API_KEY"),
        "leadmagic": os.environ.get("LEADMAGIC_API_KEY"),
    }

    results = parallel(items, call_anymail, keys["anymail"])
    misses = [item for item, result in zip(items, results) if result.get("status") != "verified"]
    fallback = parallel(misses, call_prospeo, keys["prospeo"])
    fallback_by_url = {result["linkedin_url"]: result for result in fallback}
    results = [fallback_by_url.get(result.get("linkedin_url"), result) for result in results]
    misses = [item for item, result in zip(items, results) if result.get("status") != "verified"]
    fallback = parallel(misses, call_leadmagic, keys["leadmagic"])
    fallback_by_url = {result["linkedin_url"]: result for result in fallback}
    results = [fallback_by_url.get(result.get("linkedin_url"), result) for result in results]
    print(json.dumps(results, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
