#!/usr/bin/env python3
"""Playtime and streaming stats from a Discord data package.

Prototype for the parsing logic the website will run in the browser.
Stdlib only.

Usage:
    python3 scripts/stats.py playtime [PACKAGE_DIR]
    python3 scripts/stats.py streams  [PACKAGE_DIR] [--since YYYY-MM-DD]

PACKAGE_DIR defaults to data/package (the extracted package.zip).
"""

import argparse
import csv
import json
import re
import sys
import time
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "cache"
API = "https://discord.com/api/v9/applications"


def find_user_json(pkg):
    # Folder names are localised (Account/, Compte/, Conta/, ...), so pick the
    # user.json that actually carries account data rather than matching a path.
    for p in sorted(pkg.rglob("user.json")):
        with open(p, "rb") as f:
            if b'"user_activity_application_statistics"' in f.read():
                return p
    sys.exit(f"no account user.json with playtime stats under {pkg}")


def find_event_files(pkg):
    files = sorted(pkg.rglob("events-*.json"))
    if not files:
        sys.exit(f"no activity events-*.json files under {pkg}")
    return files


def _get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "discord-data-stats"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def app_names(ids, user):
    """Map application id -> name: detectable list, library apps, then per-app lookup."""
    CACHE.mkdir(parents=True, exist_ok=True)
    det_path, extra_path = CACHE / "detectable.json", CACHE / "app_names.json"
    if not det_path.exists():
        det_path.write_text(json.dumps(_get_json(f"{API}/detectable")))
    names = {a["id"]: a["name"] for a in json.loads(det_path.read_text())}
    for la in user.get("library_applications", []):
        names.setdefault(la["application"]["id"], la["application"]["name"])
    extra = json.loads(extra_path.read_text()) if extra_path.exists() else {}
    for i in ids:
        if i in names or i in extra:
            continue
        try:
            extra[i] = _get_json(f"{API}/{i}/rpc").get("name")
        except Exception:
            extra[i] = None
        time.sleep(0.3)
    extra_path.write_text(json.dumps(extra, indent=1))
    names.update({k: v for k, v in extra.items() if v})
    return names


def clean_name(n):
    return re.sub(r"[™®]", "", n).strip()


def canon(n):
    # Some games are listed under two app ids with slightly different names.
    n = re.sub(r"\s*-\s*Game of the Year Edition$", "", clean_name(n))
    return n.replace(":", "").lower()


def cmd_playtime(pkg, out):
    user = json.loads(find_user_json(pkg).read_text())
    stats = user["user_activity_application_statistics"]
    names = app_names([s["application_id"] for s in stats], user)

    games = {}
    for s in stats:
        name = clean_name(names.get(s["application_id"], f"Unknown ({s['application_id']})"))
        g = games.setdefault(canon(name), {"name": name, "seconds": 0, "last": ""})
        g["seconds"] += s["total_duration"]
        g["last"] = max(g["last"], s["last_played_at"] or "")

    rows = sorted(games.values(), key=lambda g: -g["seconds"])
    total = sum(g["seconds"] for g in rows)
    print(f"{len(rows)} games, {total / 3600:,.0f} h ({total / 86400:.0f} days)\n")
    for i, g in enumerate(rows, 1):
        print(f"{i:4}. {g['name'][:44]:44} {g['seconds'] / 3600:8.1f} h  "
              f"{g['seconds'] / total * 100:5.1f}%  last {g['last'][:10]}")

    if out:
        with open(out, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["game", "hours", "last_played"])
            for g in rows:
                w.writerow([g["name"], round(g["seconds"] / 3600, 2), g["last"][:10]])
        print(f"\nwrote {out}")


def iter_events(files, event_type):
    """Yield events of one type, deduplicated by event_id.

    The activity folders (modeling/, reporting/, tns/) overlap heavily, so the
    same event shows up in several files.
    """
    needle = f'"event_type":"{event_type}"'.encode()
    seen = set()
    for path in files:
        with open(path, "rb") as f:
            for line in f:
                if needle not in line:
                    continue
                d = json.loads(line)
                if d["event_id"] in seen:
                    continue
                seen.add(d["event_id"])
                yield d


def cmd_streams(pkg, since):
    roles = defaultdict(int)
    sessions = Counter()
    apps = defaultdict(int)
    years = defaultdict(int)
    longest = (0, "", "")
    max_viewers = 0

    for d in iter_events(find_event_files(pkg), "video_stream_ended"):
        ts = d["timestamp"].strip('"')
        if since and ts < since:
            continue
        sec = int(d.get("duration") or 0)
        # context: "stream" = Go Live / screen share, "default" = webcam.
        key = (d.get("context"), d.get("participant_type"))
        roles[key] += sec
        sessions[key] += 1
        if key != ("stream", "streamer"):
            continue
        app = d.get("share_application_name") or "(screen / window share)"
        apps[app] += sec
        years[ts[:4]] += sec
        max_viewers = max(max_viewers, int(d.get("max_viewers") or 0))
        if sec > longest[0]:
            longest = (sec, app, ts[:10])

    labels = {
        ("stream", "streamer"): "You streaming (Go Live)",
        ("stream", "receiver"): "Watching others' streams",
        ("default", "sender"): "Your camera on",
        ("default", "receiver"): "Watching others' cameras",
    }
    print(f"since {since}\n" if since else "")
    for key, label in labels.items():
        print(f"{label:28} {sessions[key]:7,} sessions  {roles[key] / 3600:8,.0f} h")

    print("\nGo Live by year:")
    for y, s in sorted(years.items()):
        print(f"  {y}: {s / 3600:7,.0f} h")
    print(f"\nlongest stream: {longest[0] / 3600:.1f} h of {longest[1]} on {longest[2]}")
    print(f"most viewers on one stream: {max_viewers}")

    total = sum(apps.values()) or 1
    print("\nTop streamed:")
    for app, s in sorted(apps.items(), key=lambda x: -x[1])[:20]:
        print(f"  {s / 3600:7,.1f} h  {s / total * 100:4.1f}%  {clean_name(app)}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("playtime", help="hours per game from account user.json")
    p.add_argument("package", nargs="?", type=Path, default=ROOT / "data" / "package")
    p.add_argument("--csv", type=Path, help="also write the per-game table to this CSV")
    s = sub.add_parser("streams", help="Go Live / watch / camera time from activity events")
    s.add_argument("package", nargs="?", type=Path, default=ROOT / "data" / "package")
    s.add_argument("--since", help="only count streams on/after this date (YYYY-MM-DD)")
    a = ap.parse_args()

    if a.cmd == "playtime":
        cmd_playtime(a.package, a.csv)
    else:
        cmd_streams(a.package, a.since)


if __name__ == "__main__":
    main()
