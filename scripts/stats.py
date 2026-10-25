#!/usr/bin/env python3
"""Playtime, streaming and voice stats from a Discord data package.

Prototype for the parsing logic the website will run in the browser.
Stdlib only.

Usage:
    python3 scripts/stats.py playtime [PACKAGE_DIR]
    python3 scripts/stats.py streams  [PACKAGE_DIR] [--since YYYY-MM-DD]
    python3 scripts/stats.py voice    [PACKAGE_DIR] [--since YYYY-MM-DD]
    python3 scripts/stats.py badges   [PACKAGE_DIR]

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


def iter_events(files, *event_types):
    """Yield events of the given types, deduplicated by event_id.

    The activity folders (modeling/, reporting/, tns/) overlap heavily, so the
    same event shows up in several files.
    """
    needles = [f'"event_type":"{t}"'.encode() for t in event_types]
    seen = set()
    for path in files:
        with open(path, "rb") as f:
            for line in f:
                if not any(n in line for n in needles):
                    continue
                d = json.loads(line)
                if d["event_type"] not in event_types or d["event_id"] in seen:
                    continue
                seen.add(d["event_id"])
                yield d


def event_ts(d):
    return d["timestamp"].strip('"')


STREAM_ROLES = {
    ("stream", "streamer"): "You streaming (Go Live)",
    ("stream", "receiver"): "Watching others' streams",
    ("default", "sender"): "Your camera on",
    ("default", "receiver"): "Watching others' cameras",
}


def cmd_streams(pkg, since):
    roles = defaultdict(int)
    sessions = Counter()
    apps = defaultdict(int)
    years = defaultdict(lambda: defaultdict(int))
    longest = (0, "", "")
    max_viewers = 0

    for d in iter_events(find_event_files(pkg), "video_stream_ended"):
        ts = event_ts(d)
        if since and ts < since:
            continue
        sec = int(d.get("duration") or 0)
        # context: "stream" = Go Live / screen share, "default" = webcam.
        key = (d.get("context"), d.get("participant_type"))
        roles[key] += sec
        sessions[key] += 1
        years[ts[:4]][key] += sec
        if key != ("stream", "streamer"):
            continue
        app = d.get("share_application_name") or "(screen / window share)"
        apps[app] += sec
        max_viewers = max(max_viewers, int(d.get("max_viewers") or 0))
        if sec > longest[0]:
            longest = (sec, app, ts[:10])

    print(f"since {since}\n" if since else "")
    for key, label in STREAM_ROLES.items():
        print(f"{label:28} {sessions[key]:7,} sessions  {roles[key] / 3600:8,.0f} h")

    print("\nBy year (hours):   Go Live  watching  camera  watching cams")
    for y, r in sorted(years.items()):
        print(f"  {y}:  " + "".join(f"{r[k] / 3600:9,.0f}" for k in STREAM_ROLES))
    print(f"\nlongest stream: {longest[0] / 3600:.1f} h of {longest[1]} on {longest[2]}")
    print(f"most viewers on one stream: {max_viewers}")

    total = sum(apps.values()) or 1
    print("\nTop streamed:")
    for app, s in sorted(apps.items(), key=lambda x: -x[1])[:20]:
        print(f"  {s / 3600:7,.1f} h  {s / total * 100:4.1f}%  {clean_name(app)}")


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def secs(d, key):
    """Seconds from a voice field: `key` is whole seconds, `key_ms` (newer events) exact."""
    if d.get(key + "_ms") not in (None, "null"):
        return num(d[key + "_ms"]) / 1000
    if d.get(key) not in (None, "null"):
        return num(d[key])
    return None


def find_index(pkg, marker):
    """The index.json (id -> name) whose sibling folders contain `marker`."""
    for p in pkg.rglob("index.json"):
        index = json.loads(p.read_text(encoding="utf-8"))
        if any((p.parent / k / marker).exists() or (p.parent / f"c{k}" / marker).exists()
               for k in list(index)[:5]):
            return index
    return {}


VOICE_KINDS = {"1": "DM calls", "3": "Group DM calls", "2": "Server voice", "13": "Stage"}


def cmd_voice(pkg, since):
    vd_months, lv_months = defaultdict(float), defaultdict(float)
    servers, channels, kinds = defaultdict(float), defaultdict(float), defaultdict(float)
    speaking = listening = connected = 0.0
    connections = 0
    longest = (0, "", "")

    for d in iter_events(find_event_files(pkg), "voice_disconnect", "leave_voice_channel"):
        ts = event_ts(d)
        if since and ts < since:
            continue
        sec = num(d.get("duration")) / 1000  # milliseconds in both event types
        if d["event_type"] == "leave_voice_channel":
            lv_months[ts[:7]] += sec
            continue
        # voice_disconnect fires once per RTC connection, and Go Live opens a
        # separate one (context=stream) next to the voice one: skip those.
        if d.get("context") == "stream":
            continue
        vd_months[ts[:7]] += sec
        connections += 1
        kinds[VOICE_KINDS.get(d.get("channel_type"), "Unknown (older events)")] += sec
        if d.get("guild_id") not in (None, "0"):
            servers[d["guild_id"]] += sec
        channels[(d.get("guild_id"), d.get("channel_id"))] += sec
        if sec > longest[0]:
            longest = (sec, d.get("guild_id"), ts[:10])
        # Talk / listen time are only measured over the connected part of the
        # session (duration_connected), which is short of `duration` for some
        # long 2021-22 sessions, so report them as a share of that.
        conn = secs(d, "duration_connected")
        if conn:
            connected += conn
            speaking += secs(d, "duration_speaking") or 0
            listening += secs(d, "duration_listening") or 0

    # Each source has gaps (voice_disconnect barely exists before 2020;
    # leave_voice_channel lacks `duration` on many events in late 2020 to early
    # 2021). Both measure the same calls, so take the larger one per month.
    months = sorted(set(vd_months) | set(lv_months))
    total = sum(max(vd_months[m], lv_months[m]) for m in months)
    print(f"since {since}\n" if since else "")
    print(f"Time in voice: {total / 3600:,.0f} h ({total / 86400:.0f} days), "
          f"{connections:,} connections")

    print("\nBy year (hours):  voice_disconnect  leave_voice_channel  counted")
    for y in sorted({m[:4] for m in months}):
        ms = [m for m in months if m.startswith(y)]
        vd, lv = sum(vd_months[m] for m in ms), sum(lv_months[m] for m in ms)
        used = sum(max(vd_months[m], lv_months[m]) for m in ms)
        print(f"  {y}: {vd / 3600:16,.0f} {lv / 3600:20,.0f} {used / 3600:8,.0f}")

    if connected:
        print(f"\nTalking:   {speaking / 3600:7,.0f} h ({speaking / connected * 100:.0f}% of connected time)")
        print(f"Listening: {listening / 3600:7,.0f} h ({listening / connected * 100:.0f}%), "
              f"measured over {connected / 3600:,.0f} h connected (the two overlap)")

    server_names = find_index(pkg, "guild.json")
    channel_names = find_index(pkg, "channel.json")
    print(f"\nlongest connection: {longest[0] / 3600:.1f} h in "
          f"{server_names.get(longest[1], 'a call') if longest[1] not in (None, '0') else 'a call'} "
          f"on {longest[2]}")

    print("\nBy kind:")
    for k, s in sorted(kinds.items(), key=lambda x: -x[1]):
        print(f"  {s / 3600:7,.0f} h  {k}")
    print("\nTop servers:")
    for g, s in sorted(servers.items(), key=lambda x: -x[1])[:10]:
        print(f"  {s / 3600:7,.0f} h  {server_names.get(g, f'Unknown server ({g})')}")
    print("\nTop channels:")
    for (g, c), s in sorted(channels.items(), key=lambda x: -x[1])[:10]:
        # Messages/index.json only names channels you've sent text messages in.
        name = channel_names.get(c) or (
            f"#{c} ({server_names.get(g, g)})" if g not in (None, "0") else f"call {c}")
        print(f"  {s / 3600:7,.0f} h  {name}")


# Profile badge types in user_profile_metadata.owned_badges, with tier
# thresholds (hours, or games for Game Variety). None = not known yet. Game
# Variety's explorer / adventurer / voyager thresholds are hidden in the app;
# only "voyager at 58 games, 2 more to the next tier" has been seen.
BADGES = {
    19: ("Streaming", "h", [("newcomer", 1), ("fledgling", 5), ("breakout", 20), ("standout", 75),
                            ("trendsetter", 150), ("headliner", 300), ("star", 500), ("sensation", 1000)]),
    20: ("Game Time", "h", [("casual", 1), ("recreational", 5), ("dedicated", 20), ("committed", 75),
                            ("serious", 150), ("devoted", 300), ("seasoned", 500), ("ironclad", 1000)]),
    21: ("Game Variety", "games", [("sampler", 2), ("dabbler", 5), ("enthusiast", 10), ("ranger", 15),
                                   ("explorer", None), ("adventurer", None), ("voyager", None),
                                   ("(next tier)", 60)]),
}
# All three badges fit counting from about here on the test package (see
# docs/FEATURES.md). first_played_at is filled from 2024-04-28, so games first
# played after this date have all their playtime inside the badge window.
BADGE_START = "2024-11-01"


def stream_start_window(streams, tiers, got):
    """Month starts S where Go Live hours counted from S fit the badge.

    Every tier obtained at time t needs hours(S..t) >= its threshold, and the
    next unreached tier needs hours(S..now) below its threshold.
    """
    thresholds = dict(tiers)
    reached = [n for n, _ in tiers if n in got]
    nxt = next((h for n, h in tiers if n not in got), None)
    ok = []
    first = streams[0][0] if streams else "2020-01"
    y, m = int(first[:4]), int(first[5:7])
    while f"{y:04}-{m:02}" <= streams[-1][0][:7]:
        s = f"{y:04}-{m:02}-01"
        upto = lambda t: sum(sec for ts, sec in streams if s <= ts <= t) / 3600
        if all(upto(got[n]) >= thresholds[n] for n in reached) and (nxt is None or upto("9") < nxt):
            ok.append(s)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return ok


def cmd_badges(pkg):
    user = json.loads(find_user_json(pkg).read_text(encoding="utf-8"))
    owned = (user.get("user_profile_metadata") or {}).get("owned_badges") or []
    if not owned:
        print("no profile badges in this package (user_profile_metadata.owned_badges)")
        return

    stats = user["user_activity_application_statistics"]
    is_new = lambda s: (s.get("first_played_at") or "") >= BADGE_START
    play_all = sum(s["total_duration"] for s in stats) / 3600
    play_new = sum(s["total_duration"] for s in stats if is_new(s)) / 3600
    names = app_names([s["application_id"] for s in stats], user)
    game = lambda s: canon(names.get(s["application_id"], s["application_id"]))
    games_all = len({game(s) for s in stats})
    games_new = len({game(s) for s in stats if is_new(s)})
    streams = sorted((event_ts(d), int(d.get("duration") or 0))
                     for d in iter_events(find_event_files(pkg), "video_stream_ended")
                     if (d.get("context"), d.get("participant_type")) == ("stream", "streamer"))
    go_live = lambda since="": sum(s for ts, s in streams if ts >= since) / 3600

    for b in owned:
        badge = b["badge"]
        tier = badge.get("tier_base", {}).get("tier")
        got = badge.get("tier_base", {}).get("tier_obtained_at", {})
        if badge["type"] not in BADGES:
            # Tiers below the current one were all back-filled with the same
            # timestamp, so their order can't be read from the dates.
            print(f"Badge type {badge['type']}: {tier} (unknown badge; tiers reached: "
                  f"{', '.join(sorted(got))})\n")
            continue
        name, unit, tiers = BADGES[badge["type"]]
        at = dict(tiers).get(tier)
        nxt = next(((n, h) for n, h in tiers if n not in got), None)
        print(f"{name} badge: {tier.title()} ({f'{at:,} {unit}+' if at else f'? {unit}'}, "
              f"reached {got.get(tier, '')[:10]})"
              + (f", next at {nxt[1]:,} {unit}" if nxt and nxt[1] else ""))
        if badge["type"] == 20:
            print(f"  lifetime playtime in package:              {play_all:8,.0f} h")
            print(f"  games first played since {BADGE_START}:      {play_new:8,.0f} h")
            print("  (a lower bound for the badge: older games played since then add an unknown share,")
            print("   since the package only has lifetime totals per game)")
        elif badge["type"] == 21:
            print(f"  games in package, lifetime:                {games_all:8,}")
            print(f"  games first played since {BADGE_START}:      {games_new:8,}")
        else:
            print(f"  lifetime Go Live in package:   {go_live():8,.0f} h")
            print(f"  Go Live since {BADGE_START}:      {go_live(BADGE_START):8,.0f} h")
            ok = stream_start_window(streams, [t for t in tiers if t[1]], got)
            if ok:
                print(f"  matches counting from {ok[0]}" + (f" to {ok[-1]}" if len(ok) > 1 else ""))
            else:
                print("  no start month makes the package's Go Live time match the badge")
        print()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("playtime", help="hours per game from account user.json")
    p.add_argument("package", nargs="?", type=Path, default=ROOT / "data" / "package")
    p.add_argument("--csv", type=Path, help="also write the per-game table to this CSV")
    s = sub.add_parser("streams", help="Go Live / watch / camera time from activity events")
    s.add_argument("package", nargs="?", type=Path, default=ROOT / "data" / "package")
    s.add_argument("--since", help="only count streams on/after this date (YYYY-MM-DD)")
    v = sub.add_parser("voice", help="time in voice, talk / listen time, top servers")
    v.add_argument("package", nargs="?", type=Path, default=ROOT / "data" / "package")
    v.add_argument("--since", help="only count calls on/after this date (YYYY-MM-DD)")
    b = sub.add_parser("badges", help="profile badges vs the package's playtime and Go Live totals")
    b.add_argument("package", nargs="?", type=Path, default=ROOT / "data" / "package")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")  # server / game names have emoji; Windows consoles default to cp1252

    if a.cmd == "playtime":
        cmd_playtime(a.package, a.csv)
    elif a.cmd == "streams":
        cmd_streams(a.package, a.since)
    elif a.cmd == "voice":
        cmd_voice(a.package, a.since)
    else:
        cmd_badges(a.package)


if __name__ == "__main__":
    main()
