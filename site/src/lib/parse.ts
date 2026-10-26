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
  app: string; // share_application_name: the game's name or a window title, "" for screen / window share
  appId: string | null; // share_application_id, on most game streams
  exe: string | null; // share_application_executable, e.g. "javaw.exe"
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

// One app session: session_start and session_end paired on their session id.
export interface SessionRec {
  t: number; // start
  sec: number;
  os: string; // "Windows", "Android", ...
}

// One game session. Two sources that disagree on some sessions, so both are
// kept: application_closed ("app", from 2020 on, only games Discord detected)
// and overlay_usage_stats ("overlay", from late 2023 on, not every session).
export interface GameSessionRec {
  t: number; // end
  sec: number;
  id: string | null;
  name: string; // empty for "app": named from the app list
  src: "app" | "overlay";
}

// Events that are only counted, each kept as a list of times so ranges work.
export const COUNTED = [
  "app_opened", "join_voice_channel", "join_call", "add_reaction", "message_edited",
  "application_command_used", "notification_clicked",
] as const;
export type Counted = (typeof COUNTED)[number];

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

// A payment as Discord recorded it. amount is in the currency's smallest
// unit (cents), after refunds.
export interface Payment {
  t: number;
  what: string;
  amount: number;
  currency: string;
  status: number; // 0 pending, 1 completed, 2 failed, 3 reversed, 4 refunded, 5 cancelled
}

// The Account tab. Email, phone, IP addresses and date of birth are in the
// package but deliberately not read, so screenshots of the page are safe.
export interface Account {
  avatar: string | null; // data: URL (the CSP allows data: images, not blob:)
  legacyUsername: string | null; // the old name#1234
  premiumSince: string | null;
  premiumUntil: string | null;
  boostingSince: string | null;
  flags: string[]; // names, e.g. HYPESQUAD_ONLINE_HOUSE_2
  friends: number;
  blocked: number;
  pending: number;
  connections: { type: string; name: string }[];
  devices: { os: string; platform: string; lastUsed: number }[];
  payments: Payment[];
  apps: string[]; // applications and bots you made
}

export interface PackageData {
  user: { id: string; username: string; globalName: string | null } | null;
  account: Account | null;
  games: GameStat[];
  libraryNames: Record<string, string>;
  badges: OwnedBadge[];
  streams: StreamRec[];
  voice: VoiceRec[];
  sessions: SessionRec[];
  gameSessions: GameSessionRec[];
  counted: Record<Counted, number[]>;
  channels: Channel[];
  messages: MessageRec[];
  serverNames: Record<string, string>;
  serverIcons: Record<string, string>; // server id -> icon hash, only for servers you own
  channelNames: Record<string, string>;
  lastEvent: number; // latest event time, about when the package was exported
  timeZones: string[]; // the events' time_zone values, most used first
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

const NEEDLES = ["video_stream_ended", "voice_disconnect", "leave_voice_channel", "session_start", "session_end", "overlay_usage_stats", "application_closed", ...COUNTED].map(
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

// Old packages have flags as a bitfield, new ones as a list of names (DP #149).
const FLAG_BITS: [number, string][] = [
  [0, "STAFF"], [1, "PARTNER"], [2, "HYPESQUAD"], [3, "BUG_HUNTER_LEVEL_1"],
  [6, "HYPESQUAD_ONLINE_HOUSE_1"], [7, "HYPESQUAD_ONLINE_HOUSE_2"], [8, "HYPESQUAD_ONLINE_HOUSE_3"],
  [9, "PREMIUM_EARLY_SUPPORTER"], [14, "BUG_HUNTER_LEVEL_2"], [17, "VERIFIED_DEVELOPER"],
  [18, "CERTIFIED_MODERATOR"], [22, "ACTIVE_DEVELOPER"],
];
function flagNames(f: unknown): string[] {
  if (Array.isArray(f)) return f.map(String);
  if (typeof f !== "number") return [];
  return FLAG_BITS.filter(([bit]) => Math.floor(f / 2 ** bit) % 2 === 1).map(([, name]) => name);
}

// Relationship types are names in new packages and numbers in old ones.
const RELATIONSHIPS: Record<string, "friend" | "blocked" | "pending"> = {
  FRIEND: "friend", 1: "friend", BLOCKED: "blocked", 2: "blocked",
  PENDING_INCOMING: "pending", 3: "pending", PENDING_OUTGOING: "pending", 4: "pending",
};

async function dataUrl(zip: Blob, entry: ZipEntry, type: string): Promise<string> {
  const b = new Uint8Array(await new Response(await entryStream(zip, entry)).arrayBuffer());
  let bin = "";
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

type Json = Record<string, any>;

// Everything else next to user.json. Folder names are translated, so files
// are found by name relative to user.json's folder.
async function readAccount(zip: Blob, entries: ZipEntry[], userEntry: ZipEntry, u: Json): Promise<Account> {
  const home = dir(userEntry.name);
  const avatar = entries.find((e) => e.name === `${home}avatar.png`);
  const counts = { friend: 0, blocked: 0, pending: 0 };
  for (const r of u.relationships ?? []) {
    const kind = RELATIONSHIPS[String(r?.type)];
    if (kind) counts[kind]++;
  }

  // New packages: user_data_exports/discord_billing/payments.json as
  // {records: [...]}. Old ones: user.json → payments.
  let records: Json[] = Array.isArray(u.payments) ? u.payments : [];
  const billing = entries.find((e) => e.name.startsWith(home) && base(e.name) === "payments.json");
  if (billing) {
    try {
      const j = JSON.parse(await entryText(zip, billing));
      if (Array.isArray(j?.records)) records = j.records;
    } catch {
      // Unreadable: fall back to user.json's list.
    }
  }
  const payments: Payment[] = records.map((p) => ({
    t: Date.parse(String(p.created_at)),
    what: String(p.description ?? p.sku?.name ?? ""),
    amount: num(p.amount) - num(p.amount_refunded),
    currency: String(p.currency ?? "usd").toUpperCase(),
    status: num(p.status),
  })).filter((p) => Number.isFinite(p.t)).sort((a, b) => b.t - a.t);

  const apps: string[] = [];
  for (const e of entries) {
    if (!e.name.startsWith(home) || base(e.name) !== "application.json") continue;
    try {
      const a = JSON.parse(await entryText(zip, e));
      if (a?.name) apps.push(String(a.name));
    } catch {
      // Skip a broken file.
    }
  }

  const meta = u.user_profile_metadata ?? {};
  return {
    avatar: avatar ? await dataUrl(zip, avatar, "image/png").catch(() => null) : null,
    legacyUsername: meta.legacy_username ?? null,
    premiumSince: meta.premium_started_at ?? null,
    premiumUntil: u.premium_until ?? null,
    boostingSince: meta.boosting_started_at ?? null,
    flags: flagNames(u.flags),
    friends: counts.friend,
    blocked: counts.blocked,
    pending: counts.pending,
    // The same account can be linked twice (two Xbox links with one gamertag).
    connections: [...new Map<string, Account["connections"][number]>((u.connections ?? []).filter((c: Json) => !c?.revoked)
      .map((c: Json) => [`${c.type}/${c.name}`, { type: String(c.type ?? ""), name: String(c.name ?? "") }])).values()],
    devices: (u.user_sessions ?? []).map((s: Json) => ({
      os: String(s?.user_data?.client_info?.os ?? ""),
      platform: String(s?.user_data?.client_info?.platform ?? ""),
      lastUsed: Date.parse(String(s?.user_data?.approx_last_used_time)),
    })).filter((d: Json) => d.os || d.platform).sort((a: Json, b: Json) => (b.lastUsed || 0) - (a.lastUsed || 0)),
    payments,
    apps: apps.sort((a, b) => a.localeCompare(b)),
  };
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

// `onAppIds` gets app ids as they're found (played games from user.json, then
// streamed apps), so their names can be looked up while the rest is read.
export async function parsePackage(
  zip: Blob, onProgress: (p: Progress) => void = () => {},
  onAppIds: (ids: string[], library: Record<string, string>) => void = () => {},
): Promise<PackageData> {
  onProgress({ phase: "Reading the ZIP", done: 0, total: 1 });
  const entries = await readEntries(zip);
  const names = new Set(entries.map((e) => e.name));
  const missing: string[] = [];

  const data: PackageData = {
    user: null,
    account: null,
    games: [],
    libraryNames: {},
    badges: [],
    streams: [],
    voice: [],
    sessions: [],
    gameSessions: [],
    counted: Object.fromEntries(COUNTED.map((k) => [k, []])) as unknown as Record<Counted, number[]>,
    channels: [],
    messages: [],
    serverNames: {},
    serverIcons: {},
    channelNames: {},
    lastEvent: 0,
    timeZones: [],
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
    data.account = await readAccount(zip, entries, e, u);
    break;
  }
  if (!data.user) missing.push("Account (user.json): needed for playtime per game and badges.");
  if (data.games.length) onAppIds(data.games.map((g) => g.id), data.libraryNames);

  const servers = findIndex(entries, names, "guild.json");
  if (servers) data.serverNames = JSON.parse(await entryText(zip, servers));
  // Most guild.json files are just id and name; servers you own also have the icon.
  for (const e of entries.filter((e) => base(e.name) === "guild.json")) {
    const text = await entryText(zip, e);
    if (!text.includes('"icon_hash"')) continue;
    const g = JSON.parse(text);
    if (g.icon_hash) data.serverIcons[String(g.id)] = g.icon_hash;
  }
  const channels = findIndex(entries, names, "channel.json");
  if (channels) data.channelNames = JSON.parse(await entryText(zip, channels));

  await readMessages(zip, entries, names, data, onProgress);
  if (!data.channels.length) missing.push("Messages: needed for message stats.");

  // Activity: events-*.json, newline-delimited. New packages split them into
  // modeling/, reporting/ and tns/, which overlap, so dedupe by event_id.
  const eventFiles = entries.filter((e) => /^events-.*\.json$/.test(base(e.name)));
  if (!eventFiles.length) missing.push("Activity (events-*.json): needed for streaming, voice and badge comparisons.");
  const total = eventFiles.reduce((s, e) => s + e.size, 0);
  const progress = (done: number) => onProgress({ phase: "Reading activity events", done, total });
  // Streamed apps are named while the rest is read; the first time each shows up is enough.
  const streamApps = new Set<string>();
  const onApp = (id: string) => {
    if (streamApps.has(id)) return;
    streamApps.add(id);
    onAppIds([id], data.libraryNames);
  };

  // Several files are read at the same time, one worker each. The duplicates
  // between files can differ (timestamps a few seconds apart), so the results
  // are applied in file order afterwards, exactly as reading them one by one.
  const fold = new EventFolder(data);
  const lists = eventFiles.length > 1 ? await readInWorkers(zip, eventFiles, progress, onApp) : null;
  if (lists) {
    for (const list of lists) for (const ev of list) fold.add(ev);
  } else {
    let before = 0;
    for (const file of eventFiles) {
      await scanEvents(zip, file, (ev) => fold.add(ev), (n) => progress(before + n), onApp);
      before += file.size;
    }
  }
  fold.finish();

  return data;
}

// ---- Activity events -------------------------------------------------------

// One matching event line, reduced to what EventFolder needs. Small enough to
// send back from a worker by the hundred thousand.
export type Ev = { id: string; t: number; zone: string | null } & (
  | { k: "start" | "end"; session: string | null; os: string }
  | { k: "count"; type: Counted }
  | { k: "stream"; rec: StreamRec | null; rtc: string | null }
  | { k: "game"; rec: GameSessionRec | null }
  // `streamConn`: connected seconds of a Go Live connection, which has no rec.
  | { k: "voice"; rec: VoiceRec | null; rtc: string | null; streamConn?: number | null }
);

function extractEvent(line: string): Ev | null {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(line);
  } catch {
    return null;
  }
  const t = eventTime(d);
  const head = { id: String(d.event_id), t, zone: typeof d.time_zone === "string" && d.time_zone ? d.time_zone : null };
  const type = String(d.event_type);
  if (type === "session_start" || type === "session_end") {
    return { ...head, k: type === "session_end" ? "end" : "start",
      session: typeof d.session === "string" && d.session ? d.session : null, os: String(d.os ?? "") };
  }
  if ((COUNTED as readonly string[]).includes(type)) return { ...head, k: "count", type: type as Counted };
  if (type === "overlay_usage_stats") {
    // Launchers (Steam, Battle.net) run alongside the game; game_duration is ms.
    const sec = num(d.game_duration) / 1000;
    return { ...head, k: "game", rec: d.game_is_launcher === true || !sec ? null : {
      t, sec, id: d.game_id ? String(d.game_id) : null, name: String(d.game_name ?? ""), src: "overlay",
    } };
  }
  if (type === "application_closed") {
    const sec = num(d.activity_duration_s);
    return { ...head, k: "game", rec: !sec || !d.application_id ? null : {
      t, sec, id: String(d.application_id), name: "", src: "app",
    } };
  }
  if (type === "video_stream_ended") {
    const role = STREAM_ROLES[`${d.context}/${d.participant_type}`];
    return { ...head, k: "stream", rtc: d.rtc_connection_id ? String(d.rtc_connection_id) : null, rec: role === undefined ? null : {
      t,
      role,
      sec: num(d.duration),
      app: String(d.share_application_name ?? ""),
      appId: d.share_application_id ? String(d.share_application_id) : null,
      exe: d.share_application_executable ? String(d.share_application_executable).toLowerCase() : null,
      viewers: num(d.max_viewers),
    } };
  }
  const lv = type === "leave_voice_channel";
  // voice_disconnect also fires for the separate connection Go Live opens
  // (context=stream); counting it would add stream time to voice time.
  const rtc = d.rtc_connection_id ? String(d.rtc_connection_id) : null;
  if (!lv && d.context === "stream") return { ...head, k: "voice", rtc, rec: null, streamConn: secs(d, "duration_connected") };
  return { ...head, k: "voice", rtc, rec: {
    t,
    src: lv ? "lv" : "vd",
    sec: num(d.duration) / 1000, // milliseconds in both event types
    kind: String(d.channel_type ?? ""),
    guild: d.guild_id && d.guild_id !== "0" ? String(d.guild_id) : null,
    channel: d.channel_id ? String(d.channel_id) : null,
    conn: lv ? null : secs(d, "duration_connected"),
    speak: lv ? 0 : secs(d, "duration_speaking") ?? 0,
    listen: lv ? 0 : secs(d, "duration_listening") ?? 0,
  } };
}

// Reads one events file, passing each matching event to `onEvent` in a fixed
// order (chunk by chunk, event type by event type). Used inline and by
// events-worker.ts, so both see the same events in the same order. `onBytes`
// gets the uncompressed bytes read so far.
export async function scanEvents(
  zip: Blob, file: ZipEntry, onEvent: (ev: Ev) => void, onBytes: (n: number) => void, onApp: (id: string) => void,
) {
  const reader = (await entryStream(zip, file)).getReader();
  const decoder = new TextDecoder();
  let carry = "";
  let done = 0, lastReport = 0;
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
          const ev = extractEvent(body.slice(s, e));
          if (ev) {
            onEvent(ev);
            if (ev.k === "stream" && ev.rec?.appId) onApp(ev.rec.appId);
            if (ev.k === "game" && ev.rec?.id) onApp(ev.rec.id);
          }
          i = body.indexOf(needle, e);
        }
      }
    }
    if (end) break;
    done += value.byteLength;
    if (done - lastReport > 8_000_000) {
      lastReport = done;
      onBytes(done);
    }
  }
}

// Applies events in order: the first copy of an event_id wins.
class EventFolder {
  private seen = new Set<string>();
  private zones = new Map<string, number>();
  // Session id -> earliest start / latest end, paired once everything is added.
  private starts = new Map<string, { t: number; os: string }>();
  private ends = new Map<string, number>();
  // rtc_connection_id -> that connection's voice records, checked in finish().
  private calls = new Map<string, VoiceRec[]>();
  // The same for streams, with the Go Live connection's connected time.
  private streamCalls = new Map<string, { recs: StreamRec[]; conn: number | null }>();
  private data: PackageData;
  constructor(data: PackageData) {
    this.data = data;
  }

  add(ev: Ev) {
    if (this.seen.has(ev.id)) return;
    this.seen.add(ev.id);
    const t = ev.t;
    if (!Number.isFinite(t)) return;
    const data = this.data;
    if (t > data.lastEvent) data.lastEvent = t;
    if (ev.zone) this.zones.set(ev.zone, (this.zones.get(ev.zone) ?? 0) + 1);
    if (ev.k === "start" || ev.k === "end") {
      if (!ev.session) return;
      if (ev.k === "end") this.ends.set(ev.session, Math.max(t, this.ends.get(ev.session) ?? t));
      else if (!this.starts.has(ev.session) || t < this.starts.get(ev.session)!.t) this.starts.set(ev.session, { t, os: ev.os });
    } else if (ev.k === "count") {
      data.counted[ev.type].push(t);
    } else if (ev.k === "game") {
      if (ev.rec) data.gameSessions.push(ev.rec);
    } else if (ev.k === "stream") {
      if (!ev.rec) return;
      data.streams.push(ev.rec);
      if (ev.rtc) this.streamCall(ev.rtc).recs.push(ev.rec);
    } else if (ev.k === "voice" && ev.streamConn != null && ev.rtc) {
      const call = this.streamCall(ev.rtc);
      call.conn = Math.max(call.conn ?? 0, ev.streamConn);
    } else if (ev.k === "voice" && ev.rec) {
      data.voice.push(ev.rec);
      if (ev.rtc) {
        const list = this.calls.get(ev.rtc);
        if (list) list.push(ev.rec);
        else this.calls.set(ev.rtc, [ev.rec]);
      }
    }
  }

  private streamCall(rtc: string) {
    let call = this.streamCalls.get(rtc);
    if (!call) this.streamCalls.set(rtc, (call = { recs: [], conn: null }));
    return call;
  }

  finish() {
    const data = this.data;
    data.timeZones = [...this.zones].sort((a, b) => b[1] - a[1]).map(([z]) => z);
    // Sessions without an end (the app crashed, or the end fell outside the
    // export) have no length, so they're left out.
    for (const [id, st] of this.starts) {
      const end = this.ends.get(id);
      if (end !== undefined && end >= st.t) data.sessions.push({ t: st.t, sec: (end - st.t) / 1000, os: st.os });
    }
    data.sessions.sort((a, b) => a.t - b.t);
    // On some abnormal disconnects (Force Close, websocket errors; mostly
    // 2020-22) `duration` runs on for hours or days past the call, while
    // duration_connected stays right: 84 h against 39 min connected. Cut
    // those connections, and their leave_voice_channel, to the connected time.
    for (const recs of this.calls.values()) {
      const vd = recs.find((r) => r.src === "vd" && r.conn != null && r.sec > r.conn * 1.5 + 600);
      if (!vd) continue;
      const conn = vd.conn!;
      for (const r of recs) r.sec = Math.min(r.sec, conn);
    }
    // Streams have the same fault (a "17.6 h" Go Live against 1.1 h on its
    // own connection), so cut them to their Go Live connection's time too.
    for (const { recs, conn } of this.streamCalls.values()) {
      if (conn == null) continue;
      for (const r of recs) if (r.sec > conn * 1.5 + 600) r.sec = conn;
    }
  }
}

export type EventsWorkerMessage =
  | { type: "bytes"; n: number }
  | { type: "app"; id: string }
  | { type: "done"; list: Ev[] }
  | { type: "error"; message: string };

// Reads each file in its own worker (biggest first, a few at a time) and
// returns the lists in file order. Null when workers aren't available or one
// fails: the caller then reads the files one by one, so the worst case is the
// old speed, never a wrong result.
async function readInWorkers(
  zip: Blob, files: ZipEntry[], onBytes: (n: number) => void, onApp: (id: string) => void,
): Promise<Ev[][] | null> {
  if (typeof Worker === "undefined") return null;
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 2;
  const slots = Math.min(files.length, Math.max(2, cores - 1));
  const read = new Array<number>(files.length).fill(0);
  const lists = new Array<Ev[]>(files.length);
  const order = files.map((_, i) => i).sort((a, b) => files[b].size - files[a].size);
  const running = new Set<Worker>();

  const one = (i: number) => new Promise<void>((resolve, reject) => {
    const w = new Worker(new URL("./events-worker.ts", import.meta.url), { type: "module" });
    running.add(w);
    w.onmessage = (e: MessageEvent<EventsWorkerMessage>) => {
      const m = e.data;
      if (m.type === "bytes") {
        read[i] = m.n;
        onBytes(read.reduce((s, n) => s + n, 0));
      } else if (m.type === "app") {
        onApp(m.id);
      } else {
        w.terminate();
        running.delete(w);
        if (m.type === "done") {
          lists[i] = m.list;
          read[i] = files[i].size;
          resolve();
        } else {
          reject(new Error(m.message));
        }
      }
    };
    w.onerror = (e) => {
      e.preventDefault();
      reject(new Error(e.message || "events worker failed"));
    };
    w.postMessage({ zip, file: files[i] });
  });

  try {
    const queue = [...order];
    await Promise.all(Array.from({ length: slots }, async () => {
      for (let i = queue.shift(); i !== undefined; i = queue.shift()) await one(i);
    }));
    return lists;
  } catch {
    return null;
  } finally {
    for (const w of running) w.terminate();
  }
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

export interface Apps {
  names: Record<string, string>; // app id -> name
  icons: Record<string, string>; // app id -> icon hash, see appIcon()
  aliases: [string, string][]; // [old or alternate name, app id]: Discord renames apps, streams keep the old name
  exeIds: Record<string, string>; // executable file name -> app id, for the executables asked about
}

// `exes`: executable names to identify (streams without an app id). Discord's
// list gives each app's executables, either as an exact file name (">javaw.exe")
// or as the end of a path ("minecraft/runtime/.../javaw.exe").
export type Detectable = {
  id: string; name: string; icon_hash?: string | null; aliases?: string[];
  executables?: { name?: string; is_launcher?: boolean }[];
};

// Discord's list of detectable apps (about 2.5 MB gzipped). Empty if offline or blocked.
export const fetchDetectable = (): Promise<Detectable[]> =>
  fetch(`${API}/detectable`, { cache: "force-cache" }).then((r) => r.json(), () => []).catch(() => []);

// Pass `detectable` to reuse a list already being fetched.
export async function resolveApps(
  ids: string[], library: Record<string, string>, exes: string[] = [], detectable = fetchDetectable(),
): Promise<Apps> {
  const names: Record<string, string> = {};
  const icons: Record<string, string> = {};
  const aliases: [string, string][] = [];
  const exeIds: Record<string, string> = {};
  const wanted = new Set(exes);
  const byPath = new Map<string, Set<string>>(); // file name -> apps listing it at the end of a path
  // Offline or blocked, the list is empty: fall through to the library names and lookups.
  for (const a of await detectable) {
    names[a.id] = a.name;
    if (a.icon_hash) icons[a.id] = a.icon_hash;
    for (const alias of a.aliases ?? []) aliases.push([alias, a.id]);
    for (const e of a.executables ?? []) {
      if (!e.name || e.is_launcher) continue;
      const exe = e.name.toLowerCase();
      if (exe.startsWith(">")) {
        if (wanted.has(exe.slice(1))) exeIds[exe.slice(1)] ??= a.id;
      } else {
        const file = exe.slice(exe.lastIndexOf("/") + 1);
        if (wanted.has(file)) byPath.set(file, (byPath.get(file) ?? new Set()).add(a.id));
      }
    }
  }
  // A file name only found inside paths counts if a single app has it.
  for (const [file, apps] of byPath) if (!exeIds[file] && apps.size === 1) exeIds[file] = [...apps][0];
  for (const [id, n] of Object.entries(library)) names[id] ??= n;

  // Old ids missing from the detectable list (Minecraft, GTA V and CS:GO among them).
  await Promise.all(ids.filter((id) => !names[id]).map(async (id) => {
    const app = await rpcLookup(id);
    if (!app) return;
    names[id] = app.name;
    if (app.icon) icons[id] = app.icon;
  }));
  return { names, icons, aliases, exeIds };
}

// Starts looking up apps missing from Discord's list as soon as their ids are
// known, while the package is still being read; resolveApps then finds the
// answers ready.
const listed = new WeakMap<Detectable[], Set<string>>();
export function prefetchApps(ids: string[], library: Record<string, string>, detectable: Promise<Detectable[]>) {
  detectable.then((list) => {
    if (!listed.has(list)) listed.set(list, new Set(list.map((a) => a.id)));
    for (const id of ids) if (!listed.get(list)!.has(id) && !library[id]) rpcLookup(id);
  });
}

// One app's public info. Retries rate limits and network errors with backoff,
// and keeps answers in Cache Storage so reloading the page doesn't ask again
// (repeated loads are what get rate-limited). Returns null if it can't be named.
const RPC_CACHE = "app-rpc-v1";

type RpcApp = { name: string; icon?: string | null };
// Each id is asked once (also kept in memory: prefetchApps and resolveApps
// both ask, and Cache Storage can be off), two at a time to stay under the
// rate limit.
const rpcAsked = new Map<string, Promise<RpcApp | null>>();
let rpcFree = 2;
const rpcWaiting: (() => void)[] = [];
function rpcLookup(id: string): Promise<RpcApp | null> {
  if (!rpcAsked.has(id)) rpcAsked.set(id, (async () => {
    while (!rpcFree) await new Promise<void>((r) => rpcWaiting.push(r));
    rpcFree--;
    try {
      return await rpcFetch(id);
    } catch {
      return null;
    } finally {
      rpcFree++;
      rpcWaiting.shift()?.();
    }
  })());
  return rpcAsked.get(id)!;
}

async function rpcFetch(id: string): Promise<RpcApp | null> {
  const url = `${API}/${id}/rpc`;
  const cache = typeof caches === "undefined" ? null : await caches.open(RPC_CACHE).catch(() => null);
  const hit = await cache?.match(url);
  if (hit) return hit.json();
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        await cache?.put(url, res.clone()).catch(() => {});
        return res.json();
      }
      if (res.status === 404) return null; // not a public app
    } catch {
      // Network error, or blocked by an extension: retry, then give up.
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  return null;
}

// Square game icon on Discord's CDN. The browser fetches it straight from
// Discord, which only learns the app id (the page sends no referrer).
export const serverIcon = (id: string, hash: string, size = 128) =>
  `https://cdn.discordapp.com/icons/${id}/${hash}.webp?size=${size}`;

export const emojiImage =(id: string, animated: boolean, size = 64) =>
  `https://cdn.discordapp.com/emojis/${id}.webp?size=${size}${animated ? "&animated=true" : ""}`;

export const appIcon = (id: string, hash: string, size = 128) =>
  `https://cdn.discordapp.com/app-icons/${id}/${hash}.png?size=${size}`;
