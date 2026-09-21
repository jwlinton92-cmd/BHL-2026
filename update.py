#!/usr/bin/env python3
"""
BHL daily updater.

Pulls season-to-date NHL stats, applies the Bush Hockey League scoring rules
(ported from BHL 2026 Scoring.xlsx), and writes data/standings.json, which is
the only file the website reads.

Run locally:  python scripts/update.py
In CI:        see .github/workflows/update.yml
"""

import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Everything lives side by side at the repo root, so the site keeps working
# however the files get uploaded.
ROOT = Path(__file__).resolve().parent
DATA = ROOT

NHL_STATS = "https://api.nhle.com/stats/rest/en"
PAGE = 100
UA = {"User-Agent": "BHL-Fantasy/1.0 (github actions; static site updater)"}


# ---------------------------------------------------------------- helpers

def log(msg):
    print(f"[bhl] {msg}", flush=True)


def norm(name: str) -> str:
    """Accent- and punctuation-insensitive key for matching player names."""
    s = unicodedata.normalize("NFKD", str(name))
    s = s.encode("ascii", "ignore").decode()
    s = s.replace(" ", " ")
    s = re.sub(r"[^A-Za-z ]", "", s)
    return re.sub(r"\s+", " ", s).strip().lower()


def fetch_json(url: str, tries: int = 4):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            last = exc
            wait = 2 ** attempt
            log(f"  retry {attempt + 1}/{tries} in {wait}s ({exc})")
            time.sleep(wait)
    raise RuntimeError(f"failed to fetch {url}: {last}")


def fetch_all(endpoint: str, season_id: int):
    """Page through a stats/rest summary endpoint for a full season."""
    rows, start = [], 0
    while True:
        params = {
            "isAggregate": "false",
            "isGame": "false",
            "start": str(start),
            "limit": str(PAGE),
            "cayenneExp": f"seasonId={season_id} and gameTypeId=2",
        }
        url = f"{NHL_STATS}/{endpoint}/summary?" + urllib.parse.urlencode(params)
        payload = fetch_json(url)
        batch = payload.get("data", [])
        rows.extend(batch)
        total = payload.get("total", 0)
        start += PAGE
        if start >= total or not batch:
            break
    log(f"  {endpoint}: {len(rows)} rows")
    return rows


def resolve_season() -> int:
    """Use the season the NHL says is current; fall back to the prior one if
    the new season hasn't produced any games yet (pre-season / offseason)."""
    override = os.environ.get("BHL_SEASON_ID")
    if override:
        log(f"season override: {override}")
        return int(override)

    try:
        seasons = fetch_json(f"{NHL_STATS}/season")
        current = max(int(s["id"]) for s in seasons.get("data", []))
    except Exception:  # noqa: BLE001
        now = datetime.now(timezone.utc)
        y = now.year if now.month >= 9 else now.year - 1
        current = int(f"{y}{y + 1}")

    probe = fetch_json(
        f"{NHL_STATS}/skater/summary?isAggregate=false&isGame=false&start=0&limit=1"
        f"&cayenneExp=seasonId={current} and gameTypeId=2"
    )
    if probe.get("total", 0) > 0:
        log(f"season: {current} (live)")
        return current

    prior = int(str(current)[:4]) - 1
    prior_id = int(f"{prior}{prior + 1}")
    log(f"season {current} has no games yet — showing {prior_id} instead")
    return prior_id


# ---------------------------------------------------------------- scoring

def gaa_bonus(gaa, table):
    """Excel: IFS(GAA>=3,0, GAA>=2.5,10, GAA>2,25, GAA<=2,40)"""
    if gaa is None:
        return 0
    for band in table:
        if band["maxGaa"] is None:
            continue
        if gaa < band["maxGaa"]:
            return band["points"]
    return 0


def score_skater(st, rules):
    s = rules["skater"]
    return round(
        (st["goals"] * s["goal"])
        + (st["assists"] * s["assist"])
        + (st["plusMinus"] * s["plusMinus"])
        + (st["gameWinningGoals"] * s["gameWinningGoal"]),
        2,
    )


def score_goalie(st, rules):
    g = rules["goalie"]
    return round(
        (st["wins"] * g["win"])
        + (st["otLosses"] * g["otLoss"])
        + (st["saves"] * g["save"])
        + gaa_bonus(st["gaa"], g["gaaBonus"]),
        2,
    )


def score_goon(st, rules):
    return round(st["penaltyMinutes"] * rules["goon"]["penaltyMinute"], 2)


# ---------------------------------------------------------------- build

def main():
    rosters = json.loads((DATA / "rosters.json").read_text())
    rules = json.loads((DATA / "scoring.json").read_text())
    aliases = json.loads((DATA / "aliases.json").read_text())
    # Aliases resolve in both directions, so a typo in rosters.json works whether
    # the misspelling or the correct spelling is the one the NHL feed uses.
    alias_n = {}
    for wrong, right in aliases.items():
        alias_n[norm(wrong)] = right
        alias_n.setdefault(norm(right), wrong)

    season_id = resolve_season()
    log("fetching NHL stats...")
    skaters_raw = fetch_all("skater", season_id)
    goalies_raw = fetch_all("goalie", season_id)

    skaters, goalies = {}, {}
    for r in skaters_raw:
        skaters[norm(r["skaterFullName"])] = {
            "name": r["skaterFullName"],
            "team": (r.get("teamAbbrevs") or "").split(",")[-1].strip(),
            "pos": r.get("positionCode", ""),
            "gp": r.get("gamesPlayed") or 0,
            "goals": r.get("goals") or 0,
            "assists": r.get("assists") or 0,
            "points": r.get("points") or 0,
            "plusMinus": r.get("plusMinus") or 0,
            "gameWinningGoals": r.get("gameWinningGoals") or 0,
            "penaltyMinutes": r.get("penaltyMinutes") or 0,
            "shots": r.get("shots") or 0,
        }
    for r in goalies_raw:
        goalies[norm(r["goalieFullName"])] = {
            "name": r["goalieFullName"],
            "team": (r.get("teamAbbrevs") or "").split(",")[-1].strip(),
            "pos": "G",
            "gp": r.get("gamesPlayed") or 0,
            "wins": r.get("wins") or 0,
            "losses": r.get("losses") or 0,
            "otLosses": r.get("otLosses") or 0,
            "saves": r.get("saves") or 0,
            "shotsAgainst": r.get("shotsAgainst") or 0,
            "savePct": r.get("savePct"),
            "gaa": r.get("goalsAgainstAverage"),
            "shutouts": r.get("shutouts") or 0,
        }

    def lookup(name, pool):
        k = norm(name)
        if k in pool:
            return pool[k]
        alt = alias_n.get(k)
        if alt and norm(alt) in pool:
            return pool[norm(alt)]
        # Last resort: unique match on last name + first initial, which catches
        # "Mitch/Mitchell", "Matt/Matthew" and similar feed-side renamings.
        parts = k.split()
        if len(parts) >= 2:
            last, initial = parts[-1], parts[0][:1]
            hits = [v for kk, v in pool.items()
                    if kk.split()[-1] == last and kk.split()[0][:1] == initial]
            if len(hits) == 1:
                return hits[0]
        return None

    unmatched = []
    teams_out = []
    lineup = rules["lineup"]

    for team in rosters["teams"]:
        entries = []
        for p in team["players"]:
            slot = p["slot"]
            pool = goalies if slot == "G" else skaters
            st = lookup(p["name"], pool)

            if st is None:
                unmatched.append({"team": team["name"], "name": p["name"], "slot": slot})
                entries.append({
                    "name": p["name"], "slot": slot, "nhlTeam": "—",
                    "gp": 0, "points": 0, "counting": False, "missing": True,
                    "line": {},
                })
                continue

            if slot == "G":
                pts = score_goalie(st, rules)
                line = {"W": st["wins"], "OTL": st["otLosses"], "SV": st["saves"],
                        "GAA": st["gaa"], "SV%": st["savePct"], "SO": st["shutouts"],
                        "GAA Bonus": gaa_bonus(st["gaa"], rules["goalie"]["gaaBonus"])}
            elif slot == "GOON":
                pts = score_goon(st, rules)
                line = {"PIM": st["penaltyMinutes"], "G": st["goals"],
                        "A": st["assists"], "+/-": st["plusMinus"]}
            else:
                pts = score_skater(st, rules)
                line = {"G": st["goals"], "A": st["assists"], "+/-": st["plusMinus"],
                        "GWG": st["gameWinningGoals"], "PIM": st["penaltyMinutes"],
                        "SOG": st["shots"]}

            entries.append({
                "name": st["name"], "slot": slot, "nhlTeam": st["team"],
                "pos": st.get("pos", ""), "gp": st["gp"], "points": pts,
                "counting": False, "missing": False, "line": line,
            })

        # Apply the lineup rules: best N of each group count toward the team total.
        def take_best(slot_name, n):
            group = [e for e in entries if e["slot"] == slot_name]
            group.sort(key=lambda e: e["points"], reverse=True)
            for e in group[:n]:
                e["counting"] = True
            return round(sum(e["points"] for e in group[:n]), 2)

        fwd = take_best("F", lineup["forwardsCounted"])
        dfn = take_best("D", lineup["defenseCounted"])
        gol = take_best("G", lineup["goaliesCounted"])
        gon = take_best("GOON", lineup["goonCounted"])
        rok = take_best("ROOKIE", lineup["rookieCounted"])

        teams_out.append({
            "id": team["id"], "name": team["name"],
            "total": round(fwd + dfn + gol + gon + rok, 2),
            "breakdown": {"forwards": fwd, "defense": dfn, "goalie": gol,
                          "goon": gon, "rookie": rok},
            "players": entries,
        })

    teams_out.sort(key=lambda t: t["total"], reverse=True)
    for i, t in enumerate(teams_out, 1):
        t["rank"] = i

    # League-wide leaderboard of every rostered player.
    owner = {}
    for t in teams_out:
        for e in t["players"]:
            owner[e["name"]] = t["name"]
    leaders = []
    for t in teams_out:
        for e in t["players"]:
            if not e["missing"]:
                leaders.append({
                    "name": e["name"], "slot": e["slot"], "nhlTeam": e["nhlTeam"],
                    "gp": e["gp"], "points": e["points"],
                    "owner": t["name"], "counting": e["counting"],
                })
    leaders.sort(key=lambda x: x["points"], reverse=True)

    # Best unrostered skaters, for waiver-wire arguments at the bar.
    rostered = {norm(n) for n in owner}
    free = []
    for k, st in skaters.items():
        if k in rostered or st["gp"] < 1:
            continue
        free.append({"name": st["name"], "nhlTeam": st["team"], "pos": st["pos"],
                     "gp": st["gp"], "points": score_skater(st, rules)})
    free.sort(key=lambda x: x["points"], reverse=True)

    # ---- draftable player pool -------------------------------------------
    # Every NHL player, valued under BHL rules on the season just played. This
    # is what the draft room ranks and searches; it is regenerated with the
    # standings so it never drifts from the scoring rules.
    pool = []
    for st in skaters.values():
        pos = st["pos"] or ""
        pool.append({
            "name": st["name"], "team": st["team"], "pos": pos,
            "slot": "D" if pos == "D" else "F",
            "gp": st["gp"], "g": st["goals"], "a": st["assists"],
            "pm": st["plusMinus"], "pim": st["penaltyMinutes"],
            "gwg": st["gameWinningGoals"],
            "fp": score_skater(st, rules),
            "goonFp": score_goon(st, rules),
        })
    for st in goalies.values():
        pool.append({
            "name": st["name"], "team": st["team"], "pos": "G", "slot": "G",
            "gp": st["gp"], "w": st["wins"], "otl": st["otLosses"],
            "sv": st["saves"], "gaa": st["gaa"],
            "fp": score_goalie(st, rules), "goonFp": 0,
        })
    pool.sort(key=lambda p: p["fp"], reverse=True)
    (DATA / "players.json").write_text(json.dumps({
        "seasonId": season_id,
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "players": pool,
    }, indent=1))
    log(f"wrote players.json — {len(pool)} draftable players")

    out = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seasonId": season_id,
        "seasonLabel": f"{str(season_id)[:4]}-{str(season_id)[6:]}",
        "gamesPlayedMax": max([s["gp"] for s in skaters.values()] or [0]),
        "teams": teams_out,
        "leaders": leaders,
        "freeAgents": free[:50],
        "unmatched": unmatched,
        "scoring": rules,
    }
    (DATA / "standings.json").write_text(json.dumps(out, indent=1))

    log(f"wrote standings.json — leader: {teams_out[0]['name']} ({teams_out[0]['total']})")
    if unmatched:
        log(f"WARNING: {len(unmatched)} roster names did not match any NHL player:")
        for u in unmatched:
            log(f"  {u['team']}: {u['name']} ({u['slot']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
