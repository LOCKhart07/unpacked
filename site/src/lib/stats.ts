// Turns parsed records into the numbers the page shows, for a time range.
// Pure functions: used by the page and by scripts/check.ts.

import type { Apps, GameStat, MessageRec, PackageData, StreamRec, VoiceRec } from "./parse.ts";

export interface Range {
  from: number; // epoch ms, inclusive
  to: number; // epoch ms, exclusive
  label: string;
}

export const LIFETIME: Range = { from: -Infinity, to: Infinity, label: "Lifetime" };

const DAY = 86_400_000;

// First and last dated record (streams, voice, messages): the period the
// package covers.
export function dataSpan(data: PackageData): { first: number; last: number } {
  let first = data.lastEvent;
  for (const r of data.streams) first = Math.min(first, r.t);
  for (const r of data.voice) first = Math.min(first, r.t);
  for (const r of data.messages) first = Math.min(first, r.t);
  return { first, last: data.lastEvent };
}

// Ranges are relative to the last event in the package (about the export
// date), not today, so "last 30 days" means the last 30 days of data.
export function ranges(data: PackageData): Range[] {
  const end = data.lastEvent + 1;
  const { first } = dataSpan(data);
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

// Points for a chart over time: daily for 92 days or less, monthly otherwise.
export interface Series { unit: "day" | "month"; points: [string, number][] }

// The buckets a range splits into, all set to zero so quiet periods show up.
// Fixed ranges start at their start; lifetime starts at the first record.
function buckets(range: Range, first: number, last: number) {
  const start = Number.isFinite(range.from) ? range.from : first;
  const end = Math.min(range.to, last + 1);
  const unit: Series["unit"] = end - start <= 92 * DAY ? "day" : "month";
  const len = unit === "day" ? 10 : 7;
  const keys = new Map<string, number>();
  const step = new Date(unit === "day" ? start : Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth(), 1));
  while (step.getTime() < end) {
    keys.set(step.toISOString().slice(0, len), 0);
    if (unit === "day") step.setUTCDate(step.getUTCDate() + 1);
    else step.setUTCMonth(step.getUTCMonth() + 1);
  }
  return { unit, keys, start, end, key: (t: number) => new Date(t).toISOString().slice(0, len) };
}

// First and last time in a list (a loop: spreading 100k+ items into Math.min overflows the stack).
function extent(recs: { t: number }[]): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const r of recs) { if (r.t < lo) lo = r.t; if (r.t > hi) hi = r.t; }
  return [lo, hi];
}

const toSeries = (unit: Series["unit"], m: Map<string, number>): Series =>
  ({ unit, points: [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1)) });

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
  ids: string[]; // every app id merged into this game
  seconds: number;
  lastPlayed: string;
}

export function playtime(games: GameStat[], names: Record<string, string>) {
  const merged = new Map<string, GameRow>();
  for (const g of games) {
    const name = gameName(names, g.id);
    const row = merged.get(canonName(name)) ?? { name, ids: [], seconds: 0, lastPlayed: "" };
    row.ids.push(g.id);
    row.seconds += g.seconds;
    if ((g.lastPlayed ?? "") > row.lastPlayed) row.lastPlayed = g.lastPlayed ?? "";
    merged.set(canonName(name), row);
  }
  const rows = [...merged.values()].sort((a, b) => b.seconds - a.seconds);
  return { rows, total: rows.reduce((s, r) => s + r.seconds, 0) };
}

// Icon hash for a game: the first of its app ids that has one.
export function gameIcon(ids: string[], icons: Record<string, string>): { id: string; hash: string } | null {
  const id = ids.find((i) => icons[i]);
  return id ? { id, hash: icons[id] } : null;
}

// Streams only record the game's name (share_application_name), so find app
// ids by name: the user's own games first, then Discord's whole list, then
// aliases (old names of renamed apps, e.g. "Grand Theft Auto V" is now
// "Grand Theft Auto V Legacy").
export function idsByName(
  names: Record<string, string>,
  games: GameRow[],
  aliases: [string, string][] = [],
): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  const put = (name: string, id: string) => {
    const k = canonName(name);
    const list = byName.get(k);
    if (!list) byName.set(k, [id]);
    else if (!list.includes(id)) list.push(id);
  };
  for (const g of games) for (const id of g.ids) put(g.name, id);
  for (const [id, n] of Object.entries(names)) put(n, id);
  for (const [alias, id] of aliases) put(alias, id);
  return byName;
}

// ---- Streams -----------------------------------------------------------

// Streams with no share_application_name: a screen or window, not a detected game.
export const SCREEN_SHARE = "Screen or window share";

export const STREAM_ROLE_LABELS = [
  "You streaming (Go Live)",
  "Watching others' streams",
  "Your camera on",
  "Watching others' cameras",
];

// What a Go Live stream showed. share_application_name is sometimes a window
// title rather than the game ("Multiplayer (3rd-party Server)" is Minecraft's),
// so identify the game like Discord does: by app id, then by executable, then
// by the recorded name or an alias of it (apps get renamed). Uses the app's
// current name, as Games does.
export function streamNamer(apps: Pick<Apps, "names" | "exeIds" | "aliases">): (r: StreamRec) => string {
  const aliasIds = new Map<string, string>();
  for (const [alias, id] of apps.aliases) if (!aliasIds.has(canonName(alias))) aliasIds.set(canonName(alias), id);
  return (r) => {
    const id = (r.appId && apps.names[r.appId] ? r.appId : undefined)
      ?? (r.exe ? apps.exeIds[r.exe] : undefined)
      ?? (r.app ? aliasIds.get(canonName(r.app)) : undefined);
    if (id && apps.names[id]) return cleanName(apps.names[id]);
    return r.app ? cleanName(r.app) : SCREEN_SHARE;
  };
}

export function streams(recs: StreamRec[], range: Range, nameOf: (r: StreamRec) => string = (r) => r.app || SCREEN_SHARE) {
  const sel = recs.filter(inRange(range));
  const seconds = [0, 0, 0, 0];
  const sessions = [0, 0, 0, 0];
  const byYear = new Map<number, number[]>();
  const apps = new Map<string, { name: string; sec: number }>(); // keyed by canonName
  let longest: StreamRec | null = null;
  let maxViewers = 0;
  for (const r of sel) {
    seconds[r.role] += r.sec;
    sessions[r.role]++;
    const y = byYear.get(year(r.t)) ?? [0, 0, 0, 0];
    y[r.role] += r.sec;
    byYear.set(year(r.t), y);
    if (r.role !== 0) continue;
    const name = nameOf(r);
    const app = apps.get(canonName(name)) ?? { name, sec: 0 };
    app.sec += r.sec;
    apps.set(canonName(name), app);
    maxViewers = Math.max(maxViewers, r.viewers);
    if (!longest || r.sec > longest.sec) longest = r;
  }
  // Go Live over time.
  const b = buckets(range, ...extent(sel));
  if (sel.length) for (const r of sel) if (r.role === 0) add(b.keys, b.key(r.t), r.sec);
  return {
    seconds,
    sessions,
    series: toSeries(b.unit, sel.length ? b.keys : new Map()),
    byYear: [...byYear].sort((a, b) => a[0] - b[0]),
    topApps: [...apps.values()].sort((a, b) => b.sec - a.sec).slice(0, 15).map((a) => [a.name, a.sec] as [string, number]),
    longest: longest && { sec: longest.sec, t: longest.t, name: nameOf(longest) },
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
  // Over time, with the same larger-of-two-sources rule per bucket.
  const b = buckets(range, ...extent(sel));
  if (sel.length) {
    const vd = new Map<string, number>(), lv = new Map<string, number>();
    for (const r of sel) add(r.src === "lv" ? lv : vd, b.key(r.t), r.sec);
    for (const k of b.keys.keys()) b.keys.set(k, Math.max(vd.get(k) ?? 0, lv.get(k) ?? 0));
  }
  const serverName = (g: string) => data.serverNames[g] ?? `Unknown server (${g})`;
  return {
    total,
    series: toSeries(b.unit, sel.length ? b.keys : new Map()),
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

// ---- Messages ----------------------------------------------------------

// Common English words and chat filler left out of "favourite words".
const STOPWORDS = new Set(`
a about above after again against all also am an and any are aren as at be because been before being below between
both but by can cannot could couldn did didn do does doesn doing don down during each few for from further get got
had hadn has hasn have haven having he her here hers herself him himself his how i if in into is isn it its itself
just let me more most mustn my myself no nor not now of off on once only or other ought our ours ourselves out over
own same shan she should shouldn so some such than that the their theirs them themselves then there these they this
those through to too under until up very was wasn we were weren what when where which while who whom why will with
won would wouldn you your yours yourself yourselves im ive id ill youre dont didnt doesnt isnt cant wont thats whats
its yeah yes yep nah ok okay oh lol lmao like one also gonna wanna gotta will just really even still well
https http www com
`.trim().split(/\s+/));

const URL_RE = /\b(?:https?|magnet|ftp|steam|discord):\S+/gi;
const CODE_RE = /```[\s\S]*?```|`[^`\n]*`/g;
// "$pokesearch x", "!play", "--tts hi", "p!hint", "f!rank": commands typed for bots.
const COMMAND_RE = /^\s*(?:[!$%&+.,;:>?/\\~-]{1,2}|[a-z]{1,2}[!.;$])[a-z]/i;
const MENTION_RE = /<(?:@[!&]?|#)\d+>/g;
const CUSTOM_EMOJI_RE = /<a?:(\w+):\d+>/g;
const WORD_RE = /\p{L}[\p{L}\p{N}'’]*/gu;
const PICTO_RE = /\p{Extended_Pictographic}/u;
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

export interface MessageStats {
  count: number;
  chars: number;
  attachments: number;
  activeDays: number;
  perDay: number;
  dms: [string, number][];
  groups: [string, number][];
  channels: [string, number][];
  servers: [string, number][];
  series: Series;
  hours: number[]; // 0-23, viewer's local time
  weekdays: number[]; // 0 = Monday
  words: [string, number][];
  emojis: [string, number][];
  first: { t: number; where: string; text: string } | null;
}

export function messages(data: Pick<PackageData, "messages" | "channels">, range: Range): MessageStats {
  const sel = data.messages.filter(inRange(range));
  const ch = data.channels;
  const byChannel = new Map<number, number>();
  const servers = new Map<string, number>();
  const days = new Set<string>();
  const hours = new Array(24).fill(0);
  const weekdays = new Array(7).fill(0);
  const words = new Map<string, number>();
  const emojis = new Map<string, number>();
  let chars = 0, attachments = 0, first: MessageRec | null = null, last = -Infinity;

  for (const m of sel) {
    byChannel.set(m.c, (byChannel.get(m.c) ?? 0) + 1);
    const server = ch[m.c].server;
    if (ch[m.c].kind === "server" && server) add(servers, server, 1);
    const d = new Date(m.t);
    days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`); // local days, like the hour chart
    hours[d.getHours()]++;
    weekdays[(d.getDay() + 6) % 7]++;
    chars += m.text.length;
    if (m.att) attachments++;
    if (!first || m.t < first.t) first = m;
    if (m.t > last) last = m.t;

    let text = m.text;
    if (text.includes("<")) {
      for (const e of text.matchAll(CUSTOM_EMOJI_RE)) add(emojis, `:${e[1]}:`, 1);
      text = text.replace(CUSTOM_EMOJI_RE, " ").replace(MENTION_RE, " ");
    }
    if (text.includes(":")) text = text.replace(URL_RE, " ");
    if (text.includes("`")) text = text.replace(CODE_RE, " ");
    if (PICTO_RE.test(text)) {
      for (const { segment } of graphemes.segment(text)) {
        // U+FE0F (emoji presentation) is sometimes there and sometimes not.
        if (PICTO_RE.test(segment)) add(emojis, segment.replace(/️/g, ""), 1);
      }
    }
    if (COMMAND_RE.test(text)) continue;
    for (const w of text.toLowerCase().matchAll(WORD_RE)) {
      const word = w[0].replace(/['’]/g, "");
      if (word.length >= 3 && !/\d/.test(word) && !STOPWORDS.has(word)) add(words, word, 1);
    }
  }

  const b = buckets(range, first?.t ?? 0, last === -Infinity ? -1 : last);
  if (first) for (const m of sel) add(b.keys, b.key(m.t), 1);
  const spanStart = b.start, spanEnd = b.end;

  const top = (kind: string) => [...byChannel]
    .filter(([c]) => ch[c].kind === kind)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([c, n]) => [kind === "server" && ch[c].server ? `#${ch[c].name} (${ch[c].server})` : ch[c].name, n] as [string, number]);

  const spanDays = Math.max(1, Math.ceil((spanEnd - spanStart) / DAY));
  return {
    count: sel.length,
    chars,
    attachments,
    activeDays: days.size,
    perDay: sel.length / spanDays,
    dms: top("dm"),
    groups: top("group"),
    channels: top("server"),
    servers: sortedTotals(servers, 10),
    series: toSeries(b.unit, first ? b.keys : new Map()),
    hours,
    weekdays,
    words: sortedTotals(words, 80),
    emojis: sortedTotals(emojis, 24),
    first: first && {
      t: first.t,
      where: ch[first.c].kind === "server" ? `#${ch[first.c].name}${ch[first.c].server ? ` (${ch[first.c].server})` : ""}` : ch[first.c].name,
      text: first.text,
    },
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
