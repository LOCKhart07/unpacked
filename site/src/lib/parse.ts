// Reads a Discord data package ZIP into compact records. Runs in a Web Worker
// in the site and directly under Node for checks (scripts/check.ts), so it
// must not touch the DOM.
//
// Package format notes and gotchas: docs/FEATURES.md in the repo root.

import { entryStream, entryText, readEntries, type ZipEntry } from "./zip.ts";

export interface GameStat {
  id: string;
  seconds: number;
  firstPlayed: string | null;
  lastPlayed: string | null;
}

// video_stream_ended. role: 0 = you streaming (Go Live), 1 = watching a
// stream, 2 = your camera, 3 = watching a camera.
export interface StreamRec {
  t: number; // epoch ms
  role: number;
  sec: number;
  app: string; // share_application_name, "" for screen / window share
  viewers: number;
}

// voice_disconnect (src "vd", one per RTC connection) or leave_voice_channel
// (src "lv"). Both measure the same calls with different gaps.
export interface VoiceRec {
  t: number;
  src: "vd" | "lv";
  sec: number;
  kind: string; // channel_type
  guild: string | null;
  channel: string | null;
  conn: number | null; // connected seconds; talk / listen are measured against this
  speak: number;
  listen: number;
}

export interface OwnedBadge {
  type: number;
  tier: string;
  tierObtainedAt: Record<string, string>;
}

export interface Channel {
  id: string;
  kind: "dm" | "group" | "server";
  name: string; // display name: the other user, the group name, or the channel name
  server: string | null; // server name for server channels
}

// One message you sent. Only the package owner's messages are in the package.
export interface MessageRec {
  t: number;
  c: number; // index into PackageData.channels
  text: string;
  att: boolean; // has attachments
}

export interface PackageData {
  user: { id: string; username: string; globalName: string | null } | null;
  games: GameStat[];
  libraryNames: Record<string, string>;
  badges: OwnedBadge[];
  streams: StreamRec[];
  voice: VoiceRec[];
  channels: Channel[];
  messages: MessageRec[];
  serverNames: Record<string, string>;
  channelNames: Record<string, string>;
  lastEvent: number; // latest event time, about when the package was exported
  missing: string[]; // human-readable notes on sections not found
}

export interface Progress {
  phase: string;
  done: number;
  total: number;
}

const STREAM_ROLES: Record<string, number> = {
  "stream/streamer": 0,
  "stream/receiver": 1,
  "default/sender": 2,
  "default/receiver": 3,
};

const NEEDLES = ["video_stream_ended", "voice_disconnect", "leave_voice_channel"].map(
  (t) => `"event_type":"${t}"`,
);

const base = (name: string) => name.slice(name.lastIndexOf("/") + 1);
const dir = (name: string) => name.slice(0, name.lastIndexOf("/") + 1);

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

// Voice fields: `key` is whole seconds; newer events also have exact `key_ms`.
function secs(d: Record<string, unknown>, key: string): number | null {
  const ms = d[key + "_ms"];
  if (ms != null && ms !== "null") return num(ms) / 1000;
  const s = d[key];
  if (s != null && s !== "null") return num(s);
  return null;
}

function eventTime(d: Record<string, unknown>): number {
  return Date.parse(String(d.timestamp).replace(/"/g, ""));
}

// index.json files map id -> name. Folder names are translated, so tell the
// server and channel indexes apart by what sits next to them.
function findIndex(entries: ZipEntry[], names: Set<string>, marker: string): ZipEntry | undefined {
  return entries.find((e) => {
    if (base(e.name) !== "index.json") return false;
    const d = dir(e.name);
    for (const n of names) {
      if (n.startsWith(d) && base(n) === marker) {
        const rest = n.slice(d.length).split("/");
        if (rest.length === 2) return true;
      }
    }
    return false;
  });
}

export async function parsePackage(zip: Blob, onProgress: (p: Progress) => void = () => {}): Promise<PackageData> {
  onProgress({ phase: "Reading the ZIP", done: 0, total: 1 });
  const entries = await readEntries(zip);
  const names = new Set(entries.map((e) => e.name));
  const missing: string[] = [];

  const data: PackageData = {
    user: null,
    games: [],
    libraryNames: {},
    badges: [],
    streams: [],
    voice: [],
    channels: [],
    messages: [],
    serverNames: {},
    channelNames: {},
    lastEvent: 0,
    missing,
  };

  // Account: the user.json that has playtime stats. There is a tiny unrelated
  // one under Activities/, so pick by content.
  for (const e of entries.filter((e) => base(e.name) === "user.json").sort((a, b) => b.size - a.size)) {
    const text = await entryText(zip, e);
    if (!text.includes('"user_activity_application_statistics"')) continue;
    const u = JSON.parse(text);
    data.user = { id: u.id, username: u.username, globalName: u.global_name ?? null };
    data.games = (u.user_activity_application_statistics ?? []).map((s: Record<string, unknown>) => ({
      id: String(s.application_id),
      seconds: num(s.total_duration),
      firstPlayed: (s.first_played_at as string) ?? null,
      lastPlayed: (s.last_played_at as string) ?? null,
    }));
    for (const la of u.library_applications ?? []) {
      if (la?.application?.id) data.libraryNames[la.application.id] = la.application.name;
    }
    for (const b of u.user_profile_metadata?.owned_badges ?? []) {
      const tb = b?.badge?.tier_base;
      if (tb) data.badges.push({ type: b.badge.type, tier: tb.tier, tierObtainedAt: tb.tier_obtained_at ?? {} });
    }
    break;
  }
  if (!data.user) missing.push("Account (user.json): needed for playtime per game and badges.");

  const servers = findIndex(entries, names, "guild.json");
  if (servers) data.serverNames = JSON.parse(await entryText(zip, servers));
  const channels = findIndex(entries, names, "channel.json");
  if (channels) data.channelNames = JSON.parse(await entryText(zip, channels));

  await readMessages(zip, entries, names, data, onProgress);
  if (!data.channels.length) missing.push("Messages: needed for message stats.");

  // Activity: events-*.json, newline-delimited. New packages split them into
  // modeling/, reporting/ and tns/, which overlap, so dedupe by event_id.
  const eventFiles = entries.filter((e) => /^events-.*\.json$/.test(base(e.name)));
  if (!eventFiles.length) missing.push("Activity (events-*.json): needed for streaming, voice and badge comparisons.");
  const total = eventFiles.reduce((s, e) => s + e.size, 0);
  let done = 0;
  const seen = new Set<string>();

  const handle = (line: string) => {
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(line);
    } catch {
      return;
    }
    const id = String(d.event_id);
    if (seen.has(id)) return;
    seen.add(id);
    const t = eventTime(d);
    if (!Number.isFinite(t)) return;
    if (t > data.lastEvent) data.lastEvent = t;

    if (d.event_type === "video_stream_ended") {
      const role = STREAM_ROLES[`${d.context}/${d.participant_type}`];
      if (role === undefined) return;
      data.streams.push({
        t,
        role,
        sec: num(d.duration),
        app: String(d.share_application_name ?? ""),
        viewers: num(d.max_viewers),
      });
      return;
    }
    const lv = d.event_type === "leave_voice_channel";
    // voice_disconnect also fires for the separate connection Go Live opens
    // (context=stream); counting it would add stream time to voice time.
    if (!lv && d.context === "stream") return;
    data.voice.push({
      t,
      src: lv ? "lv" : "vd",
      sec: num(d.duration) / 1000, // milliseconds in both event types
      kind: String(d.channel_type ?? ""),
      guild: d.guild_id && d.guild_id !== "0" ? String(d.guild_id) : null,
      channel: d.channel_id ? String(d.channel_id) : null,
      conn: lv ? null : secs(d, "duration_connected"),
      speak: lv ? 0 : secs(d, "duration_speaking") ?? 0,
      listen: lv ? 0 : secs(d, "duration_listening") ?? 0,
    });
  };

  for (const file of eventFiles) {
    const reader = (await entryStream(zip, file)).getReader();
    const decoder = new TextDecoder();
    let carry = "";
    let lastReport = 0;
    for (;;) {
      const { value, done: end } = await reader.read();
      const text = carry + (end ? decoder.decode() : decoder.decode(value, { stream: true }));
      // Only complete lines; the tail waits for the next chunk.
      const cut = end ? text.length : text.lastIndexOf("\n");
      if (cut < 0) {
        carry = text;
      } else {
        const body = text.slice(0, cut);
        carry = text.slice(cut + 1);
        // Search the chunk for the few event types we need instead of
        // splitting millions of lines; JSON.parse only runs on matches.
        for (const needle of NEEDLES) {
          let i = body.indexOf(needle);
          while (i !== -1) {
            const s = body.lastIndexOf("\n", i) + 1;
            let e = body.indexOf("\n", i);
            if (e === -1) e = body.length;
            handle(body.slice(s, e));
            i = body.indexOf(needle, e);
          }
        }
      }
      if (end) break;
      done += value.byteLength;
      if (done - lastReport > 8_000_000) {
        lastReport = done;
        onProgress({ phase: "Reading activity events", done, total });
      }
    }
  }

  return data;
}

// ---- Messages --------------------------------------------------------------
// One folder per channel (c<id>/ in new packages, <id>/ in old ones) with
// channel.json and messages.json (old packages: messages.csv). Timestamps are
// UTC without a zone marker ("2024-07-10 16:45:23").

function messageTime(ts: string): number {
  const s = ts.trim().replace(" ", "T");
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z");
}

// Minimal RFC 4180 parser for the old messages.csv (quoted fields can hold
// commas, quotes and newlines).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

// index.json says "channel, server", "Direct Message with name" or "None".
function channelInfo(
  ch: { id: string; type?: string; name?: string | null; recipients?: string[]; guild?: { name?: string } },
  indexName: string | undefined,
  serverNames: string[],
  ownId: string | undefined,
): Channel {
  const type = String(ch.type ?? "");
  if (type === "DM" || type === "1") {
    let name = indexName?.replace(/^Direct Message with /, "") ?? "";
    const other = ch.recipients?.find((r) => r !== ownId);
    if (!name || name === "Unknown Participant") name = other ? `Unknown user (${other})` : `DM ${ch.id}`;
    return { id: ch.id, kind: "dm", name, server: null };
  }
  if (type === "GROUP_DM" || type === "3") {
    const name = ch.name || (indexName && indexName !== "None" ? indexName : "")
      || `Group DM (${ch.recipients?.length ?? "?"} people)`;
    return { id: ch.id, kind: "group", name, server: null };
  }
  let server = ch.guild?.name ?? serverNames.find((s) => indexName?.endsWith(`, ${s}`)) ?? null;
  let name = ch.name ?? "";
  if (indexName) {
    // Servers you've left aren't in Servers/index.json; split at the last ", ".
    if (!server && indexName.includes(", ")) server = indexName.slice(indexName.lastIndexOf(", ") + 2);
    if (!name) name = server && indexName.endsWith(`, ${server}`) ? indexName.slice(0, -server.length - 2) : indexName;
  }
  return { id: ch.id, kind: "server", name: name || `#${ch.id}`, server };
}

async function readMessages(
  zip: Blob,
  entries: ZipEntry[],
  names: Set<string>,
  data: PackageData,
  onProgress: (p: Progress) => void,
) {
  const folders = entries.filter((e) => base(e.name) === "channel.json"
    && (names.has(dir(e.name) + "messages.json") || names.has(dir(e.name) + "messages.csv")));
  const byName = new Map(entries.map((e) => [e.name, e]));
  const serverNames = Object.values(data.serverNames).sort((a, b) => b.length - a.length);
  let done = 0;
  for (const chEntry of folders) {
    if (done++ % 50 === 0) onProgress({ phase: "Reading messages", done, total: folders.length });
    let ch;
    try {
      ch = JSON.parse(await entryText(zip, chEntry));
    } catch {
      continue;
    }
    const c = data.channels.length;
    data.channels.push(channelInfo(ch, data.channelNames[ch.id], serverNames, data.user?.id));

    const json = byName.get(dir(chEntry.name) + "messages.json");
    if (json) {
      // IDs are numbers above 2^53 and lose precision in JSON.parse; they're not used.
      for (const m of JSON.parse(await entryText(zip, json)) as Record<string, unknown>[]) {
        const t = messageTime(String(m.Timestamp ?? ""));
        if (!Number.isFinite(t)) continue;
        data.messages.push({ t, c, text: String(m.Contents ?? ""), att: !!m.Attachments });
      }
      continue;
    }
    const rows = parseCsv(await entryText(zip, byName.get(dir(chEntry.name) + "messages.csv")!));
    const head = rows.shift()?.map((h) => h.trim()) ?? [];
    const [ti, ci, ai] = ["Timestamp", "Contents", "Attachments"].map((h) => head.indexOf(h));
    for (const r of rows) {
      const t = messageTime(r[ti] ?? "");
      if (!Number.isFinite(t)) continue;
      data.messages.push({ t, c, text: r[ci] ?? "", att: !!r[ai] });
    }
  }
  for (const m of data.messages) if (m.t > data.lastEvent) data.lastEvent = m.t;
}

// Game names aren't in the package, only application ids. Resolve them from
// Discord's public endpoints (both allow cross-origin requests). This sends
// nothing about the user except, for the per-app fallback, the app ids.
const API = "https://discord.com/api/v9/applications";

export async function resolveAppNames(ids: string[], library: Record<string, string>): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  try {
    const res = await fetch(`${API}/detectable`, { cache: "force-cache" });
    for (const a of (await res.json()) as { id: string; name: string }[]) names[a.id] = a.name;
  } catch {
    // Offline or blocked: fall through to the library names and lookups.
  }
  for (const [id, n] of Object.entries(library)) names[id] ??= n;

  // Old ids missing from the detectable list (Minecraft, GTA V and CS:GO among them).
  const todo = ids.filter((id) => !names[id]);
  const worker = async () => {
    for (let id = todo.pop(); id; id = todo.pop()) {
      try {
        const res = await fetch(`${API}/${id}/rpc`);
        if (res.ok) names[id] = (await res.json()).name;
      } catch {
        // Leave it unknown.
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return names;
}
