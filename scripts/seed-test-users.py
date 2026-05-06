#!/usr/bin/env python3
"""
Seed sample test users + tracking events into a running PairUp.

Each "user" is created via a fresh cookie jar so the server allocates
a distinct UUID and row in user_state. Events are then emitted from
that user's session to populate the admin counters.

Usage:
    scripts/seed-test-users.py                    # local
    URL=https://… ADMIN_PASS=… scripts/seed-test-users.py  # prod

Required: python3 (stdlib only).
"""

from __future__ import annotations

import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.request

URL = os.environ.get("URL", "http://localhost:8080").rstrip("/")
ADMIN_PASS = os.environ.get("ADMIN_PASS", "localdev")
TS_NOW = int(time.time() * 1000)


def request(method, path, *, jar=None, body=None, headers=None):
    full = URL + path
    data = None
    h = dict(headers or {})
    if body is not None:
        data = json.dumps(body).encode()
        h.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(full, data=data, method=method, headers=h)
    opener = (
        urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        if jar is not None
        else urllib.request.build_opener()
    )
    try:
        with opener.open(req, timeout=30) as resp:
            raw = resp.read()
            return resp.status, raw
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def make_user(key, name, grade, dirs, days, location, fte, neg, style, avail, mult):
    jar = http.cookiejar.CookieJar()
    # First GET seeds the cookie + empty user_state row
    request("GET", "/api/state", jar=jar)
    profile = {
        "name": name,
        "grade": grade,
        "directorates": dirs,
        "days": dict(zip(["Mon", "Tue", "Wed", "Thu", "Fri"], days)),
        "location": location,
        "fte": fte,
        "daysNegotiable": neg,
        "style": style,
        "availability": avail,
        "skills": "",
        "workingPatternNotes": "",
        "otherInfo": "",
        "lastActive": TS_NOW,
        "visibility": {
            "grade": "must",
            "directorates": "must",
            "location": "open",
            "days": "open",
        },
    }
    state = {
        "profile": profile,
        "sentRequests": [],
        "receivedRequests": [],
        "connections": [],
        "dismissed": [],
        "showDismissed": False,
        "newConnBanner": None,
        "pendingTimers": {},
        "hiddenSuggested": [],
        "activeOverrides": {},
        "searchPrefs": {
            "grade": "definite",
            "directorates": "definite",
            "location": "preferred",
            "days": "preferred",
        },
    }
    code, _ = request("PUT", "/api/state", jar=jar, body=state)
    if code != 200:
        print(f"  ! {name}: PUT /api/state -> {code}", file=sys.stderr)
        return jar

    def emit(typ, payload):
        request("POST", "/api/events", jar=jar, body={"type": typ, "payload": payload})

    emit("profile_created", {"grade": grade, "location": location})
    emit("matches_suggested", {"visible": mult, "total": 7})
    if mult >= 2:
        emit("connection_request", {"targetId": f"seed_{key}_target"})
    if mult >= 3:
        emit("email_click", {"targetId": f"seed_{key}_target"})
    return jar


USERS = [
    # key, name, grade, dirs, day-pattern, location, fte, negotiable, style, availability, activity-multiplier
    ("anita",  "Anita Patel",   "G7",   ["Economic & Trade", "Climate & Environment"], "full,full,part,non,non".split(","), "London - KCS",  "0.7 FTE", "yes",      "collaborative", "Looking for stage 2 partner",        3),
    ("marcus", "Marcus Bell",   "G6",   ["Climate & Environment"],                    "non,non,part,full,full".split(","), "London - KCS",  "3 days",  "possibly", "clean",         "Open from June",                     2),
    ("sara",   "Sara Hassan",   "HEO",  ["HR & People", "Corporate Services"],         "full,full,full,non,non".split(","), "East Kilbride", "0.6 FTE", "yes",      "flexible",      "Returning from leave September",     1),
    ("james",  "James OConnor", "G7",   ["Security & Defence", "Overseas Network"],   "full,full,full,non,non".split(","), "Overseas",      "0.8 FTE", "no",       "clean",         "Geneva posting end of tour",         2),
    ("priya",  "Priya Kapoor",  "SCS1", ["Programme Delivery", "Digital & Data"],     "non,non,full,full,part".split(","), "London - KCS",  "0.6 FTE", "possibly", "collaborative", "SCS1 stage 2 candidate",             0),
    ("tomas",  "Tomas Silva",   "G7",   ["Digital & Data"],                            "full,full,part,non,full".split(","), "Remote",       "4 days",  "yes",      "flexible",      "Open to discuss patterns",           2),
    ("helen",  "Helen Wright",  "SEO",  ["Communications"],                            "full,full,full,full,non".split(","), "London - KCS", "0.8 FTE", "no",       "clean",         "Available now",                      1),
    ("yuki",   "Yuki Tanaka",   "G6",   ["Overseas Network", "Economic & Trade"],     "non,part,full,full,non".split(","), "Overseas",      "3 days",  "yes",      "collaborative", "Tokyo network role",                 2),
]


def main():
    print(f"Seeding against {URL}")
    for u in USERS:
        make_user(*u)
        print(f"  + {u[1]} [{u[2]}] @ {u[5]}")

    print("\nDisabling Priya Kapoor…")
    code, body = request("GET", "/api/admin/users", headers={"X-Admin-Passphrase": ADMIN_PASS})
    if code != 200:
        print(f"  ! /api/admin/users -> {code}: {body[:200]}", file=sys.stderr)
        return
    users = json.loads(body)
    priya = next((u for u in users if u.get("name") == "Priya Kapoor"), None)
    if not priya:
        print("  ! couldn't find Priya by name", file=sys.stderr)
    else:
        code, _ = request(
            "PATCH",
            f"/api/admin/users/{priya['user_id']}",
            body={"disabled": True},
            headers={"X-Admin-Passphrase": ADMIN_PASS},
        )
        print(f"  + Priya Kapoor disabled (id {priya['user_id'][:8]}…)  HTTP {code}")

    print("\nFinal stats:")
    code, body = request("GET", "/api/admin/stats", headers={"X-Admin-Passphrase": ADMIN_PASS})
    if code != 200:
        print(f"  ! /api/admin/stats -> {code}", file=sys.stderr)
        return
    print(json.dumps(json.loads(body), indent=2))


if __name__ == "__main__":
    main()
