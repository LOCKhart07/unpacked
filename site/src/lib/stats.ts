// Turns parsed records into the numbers the page shows, for a time range.
// Pure functions: used by the page and by scripts/check.ts.

import type { GameStat, PackageData, StreamRec, VoiceRec } from "./parse.ts";

export interface Range {
  from: number; // epoch ms, inclusive
  to: number; // epoch ms, exclusive
  label: string;
}

export const LIFETIME: Range = { from: -Infinity, to: Infinity, label: "Lifetime" };

const DAY = 86_400_000;

// Ranges are relative to the last event in the package (about the export
// date), not today, so "last 30 days" means the last 30 days of data.
export function ranges(data: PackageData): Range[] {
  const end = data.lastEvent + 1;
  let first = end;
  for (const r of data.streams) first = Math.min(first, r.t);
  for (const r of data.voice) first = Math.min(first, r.t);
  const years: Range[] = [];
  for (let y = new Date(end).getUTCFullYear(); y >= new Date(first).getUTCFullYear(); y--) {
    years.push({ from: Date.UTC(y, 0, 1), to: Date.UTC(y + 1, 0, 1), label: String(y) });
  }
  return [
    LIFETIME,
    { from: end - 30 * DAY, to: end, label: "Last 30 days" },
    { from: end - 182 * DAY, to: end, label: "Last 6 months" },
    { from: end - 365 * DAY, to: end, label: "Last 12 months" },
    ...years,
  ];
}

const inRange = (r: Range) => (x: { t: number }) => x.t >= r.from && x.t < r.to;
const year = (t: number) => new Date(t).getUTCFullYear();
const month = (t: number) => new Date(t).toISOString().slice(0, 7);

function sortedTotals(m: Map<string, number>, n = Infinity): [string, number][] {
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function add(m: Map<string, number>, k: string, v: number) {
  m.set(k, (m.get(k) ?? 0) + v);
}

// ---- Game names --------------------------------------------------------

export const cleanName = (n: string) => n.replace(/[™®]/g, "").trim();

// One game can have several app ids (old and new, Legacy / Enhanced), with
// slightly different names; merge on this key.
export const canonName = (n: string) =>
  cleanName(n).replace(/\s*-\s*Game of the Year Edition$/, "").replace(/:/g, "").toLowerCase();

const gameName = (names: Record<string, string>, id: string) => cleanName(names[id] ?? `Unknown app (${id})`);

// ---- Playtime (lifetime only: the package has no per-day breakdown) ------

export interface GameRow {
  name: string;
  seconds: number;
  lastPlayed: string;
}

export function playtime(games: GameStat[], names: Record<string, string>) {
  const merged = new Map<string, GameRow>();
  for (const g of games) {
    const name = gameName(names, g.id);
    const row = merged.get(canonName(name)) ?? { name, seconds: 0, lastPlayed: "" };
    row.seconds += g.seconds;
    if ((g.lastPlayed ?? "") > row.lastPlayed) row.lastPlayed = g.lastPlayed ?? "";
    merged.set(canonName(name), row);
  }
  const rows = [...merged.values()].sort((a, b) => b.seconds - a.seconds);
  return { rows, total: rows.reduce((s, r) => s + r.seconds, 0) };
}

// ---- Streams -----------------------------------------------------------

export const STREAM_ROLE_LABELS = [
  "You streaming (Go Live)",
  "Watching others' streams",
  "Your camera on",
  "Watching others' cameras",
];

export function streams(recs: StreamRec[], range: Range) {
  const sel = recs.filter(inRange(range));
  const seconds = [0, 0, 0, 0];
  const sessions = [0, 0, 0, 0];
  const byYear = new Map<number, number[]>();
  const apps = new Map<string, number>();
  let longest: StreamRec | null = null;
  let maxViewers = 0;
  for (const r of sel) {
    seconds[r.role] += r.sec;
    sessions[r.role]++;
    const y = byYear.get(year(r.t)) ?? [0, 0, 0, 0];
    y[r.role] += r.sec;
    byYear.set(year(r.t), y);
    if (r.role !== 0) continue;
    add(apps, r.app || "Screen or window share", r.sec);
    maxViewers = Math.max(maxViewers, r.viewers);
    if (!longest || r.sec > longest.sec) longest = r;
  }
  return {
    seconds,
    sessions,
    byYear: [...byYear].sort((a, b) => a[0] - b[0]),
    topApps: sortedTotals(apps, 15).map(([n, s]) => [cleanName(n), s] as [string, number]),
    longest,
    maxViewers,
  };
}

// ---- Voice -------------------------------------------------------------

export const VOICE_KINDS: Record<string, string> = {
  "2": "Server voice",
  "1": "DM calls",
  "3": "Group DM calls",
  "13": "Stage",
};

export function voice(recs: VoiceRec[], range: Range, data: Pick<PackageData, "serverNames" | "channelNames">) {
  const sel = recs.filter(inRange(range));
  // Each source has gaps (voice_disconnect barely exists before 2020;
  // leave_voice_channel lacks durations on many late-2020 events). Both
  // measure the same calls, so take the larger one per month.
  const vdMonth = new Map<string, number>();
  const lvMonth = new Map<string, number>();
  const kinds = new Map<string, number>();
  const servers = new Map<string, number>();
  const channels = new Map<string, number>();
  let connected = 0, speaking = 0, listening = 0, connections = 0;
  let longest: VoiceRec | null = null;
  for (const r of sel) {
    if (r.src === "lv") {
      add(lvMonth, month(r.t), r.sec);
      continue;
    }
    add(vdMonth, month(r.t), r.sec);
    connections++;
    add(kinds, VOICE_KINDS[r.kind] ?? "Other / older events", r.sec);
    if (r.guild) add(servers, r.guild, r.sec);
    if (r.channel) add(channels, `${r.guild ?? ""}/${r.channel}`, r.sec);
    if (!longest || r.sec > longest.sec) longest = r;
    // Talk / listen are measured over connected time, which falls short of
    // `duration` on some long 2021-22 sessions: report them as a share of it.
    if (r.conn) {
      connected += r.conn;
      speaking += r.speak;
      listening += r.listen;
    }
  }
  const months = new Set([...vdMonth.keys(), ...lvMonth.keys()]);
  const byYear = new Map<string, number>();
  let total = 0;
  for (const m of months) {
    const s = Math.max(vdMonth.get(m) ?? 0, lvMonth.get(m) ?? 0);
    total += s;
    add(byYear, m.slice(0, 4), s);
  }
  const serverName = (g: string) => data.serverNames[g] ?? `Unknown server (${g})`;
  return {
    total,
    connections,
    connected,
    speaking,
    listening,
    longest: longest && { sec: longest.sec, t: longest.t, where: longest.guild ? serverName(longest.guild) : "a call" },
    byYear: [...byYear].sort(),
    kinds: sortedTotals(kinds),
    servers: sortedTotals(servers, 10).map(([g, s]) => [serverName(g), s] as [string, number]),
    channels: sortedTotals(channels, 10).map(([k, s]) => {
      const [g, c] = k.split("/");
      // Messages/index.json only names channels you've typed in.
      const name = data.channelNames[c] ?? (g ? `#${c} (${serverName(g)})` : `Call ${c}`);
      return [name, s] as [string, number];
    }),
  };
}

// ---- Badges ------------------------------------------------------------
// Shown as context next to the full stats, not instead of them.

interface BadgeDef {
  name: string;
  unit: "h" | "games";
  tiers: [string, number | null][]; // null = threshold not known
}

export const BADGES: Record<number, BadgeDef> = {
  19: {
    name: "Streaming",
    unit: "h",
    tiers: [["newcomer", 1], ["fledgling", 5], ["breakout", 20], ["standout", 75], ["trendsetter", 150],
      ["headliner", 300], ["star", 500], ["sensation", 1000]],
  },
  20: {
    name: "Game Time",
    unit: "h",
    tiers: [["casual", 1], ["recreational", 5], ["dedicated", 20], ["committed", 75], ["serious", 150],
      ["devoted", 300], ["seasoned", 500], ["ironclad", 1000]],
  },
  21: {
    name: "Game Variety",
    unit: "games",
    tiers: [["sampler", 2], ["dabbler", 5], ["enthusiast", 10], ["ranger", 15], ["explorer", null],
      ["adventurer", null], ["voyager", null], ["next tier", 60]],
  },
};

// All three badges fit counting from about here on the test package.
// first_played_at is filled from 2024-04-28, so games first played after
// this date have all of their playtime inside the badge window.
export const BADGE_START = "2024-11-01";

export interface BadgeRow {
  name: string;
  tier: string;
  threshold: number | null;
  unit: string;
  reached: string;
  next: number | null;
  ours: number; // our count since BADGE_START
  oursNote: string;
  lifetime: number;
}

export function badges(data: PackageData, names: Record<string, string>): BadgeRow[] {
  const since = Date.parse(BADGE_START);
  const isNew = (g: GameStat) => (g.firstPlayed ?? "") >= BADGE_START;
  return data.badges
    .filter((b) => BADGES[b.type])
    .map((b) => {
      const def = BADGES[b.type];
      const tier = def.tiers.find(([n]) => n === b.tier);
      const next = def.tiers.find(([n]) => !(n in b.tierObtainedAt));
      const row = {
        name: def.name,
        tier: b.tier,
        threshold: tier?.[1] ?? null,
        unit: def.unit,
        reached: (b.tierObtainedAt[b.tier] ?? "").slice(0, 10),
        next: next?.[1] ?? null,
      };
      if (b.type === 19) {
        const goLive = data.streams.filter((s) => s.role === 0);
        return {
          ...row,
          ours: goLive.filter((s) => s.t >= since).reduce((a, s) => a + s.sec, 0) / 3600,
          oursNote: `Go Live since ${BADGE_START}`,
          lifetime: goLive.reduce((a, s) => a + s.sec, 0) / 3600,
        };
      }
      if (b.type === 20) {
        return {
          ...row,
          ours: data.games.filter(isNew).reduce((a, g) => a + g.seconds, 0) / 3600,
          oursNote: `at least: games first played since ${BADGE_START}`,
          lifetime: data.games.reduce((a, g) => a + g.seconds, 0) / 3600,
        };
      }
      const distinct = (gs: GameStat[]) => new Set(gs.map((g) => canonName(gameName(names, g.id)))).size;
      return {
        ...row,
        ours: distinct(data.games.filter(isNew)),
        oursNote: `games first played since ${BADGE_START}`,
        lifetime: distinct(data.games),
      };
    });
}

// ---- Formatting --------------------------------------------------------

export const hours = (sec: number) =>
  `${(sec / 3600).toLocaleString("en-US", { maximumFractionDigits: sec < 36_000 ? 1 : 0 })} h`;

export const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");
