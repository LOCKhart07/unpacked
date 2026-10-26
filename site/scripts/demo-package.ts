// Writes a made-up Discord data package for screenshots and demos, so nobody's
// real data has to be shown. Same seed, same package.
//
//   node scripts/demo-package.ts ../data/demo-package.zip
//
// Game ids are real public ids from Discord's detectable list, so names and
// icons resolve; every person, server, channel and message is invented.

import { writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

const out = process.argv[2];
if (!out) {
  console.error("usage: node scripts/demo-package.ts <out.zip>");
  process.exit(1);
}

// ---- Random, but repeatable ----------------------------------------------

let seed = 20261026;
function rand() {
  // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
// Zipf-ish: early items much more likely.
const pickRanked = <T>(xs: T[], skew = 1) => xs[Math.min(xs.length - 1, Math.floor(xs.length * rand() ** (1 + skew)))];

const DAY = 86_400_000;
const START = Date.UTC(2018, 2, 1);
const END = Date.UTC(2026, 9, 20, 22);
let nextId = 1;
const eventId = () => `demo-${nextId++}`;
const iso = (t: number) => new Date(t).toISOString();

// How active the made-up player was in a given month: a busy stretch around
// 2020-21, quieter after, picking up again lately.
function activity(t: number) {
  const y = (t - START) / (365.25 * DAY) + 2018;
  return 0.35 + 0.9 * Math.exp(-((y - 2021) ** 2) / 1.2) + 0.45 * Math.exp(-((y - 2025.9) ** 2) / 0.5);
}

// ---- Games -----------------------------------------------------------------

const GAMES: [string, string, number][] = [ // id, name, lifetime hours
  ["1402418491272986635", "Minecraft", 612],
  ["1402418696126992445", "League of Legends", 455],
  ["356877880938070016", "Rocket League", 318],
  ["359509387670192128", "Stardew Valley", 240],
  ["1402418344912752671", "Terraria", 205],
  ["428054228511227914", "Deep Rock Galactic", 176],
  ["1124358970618953818", "Valheim", 151],
  ["358422126602223616", "Factorio", 138],
  ["1209665818464358430", "Balatro", 96],
  ["1402418342127472751", "Hades", 88],
  ["363431029484027904", "Hollow Knight", 74],
  ["1167674267748540516", "Lethal Company", 63],
  ["787443973538971748", "Cyberpunk 2077", 58],
  ["1161772927566495865", "It Takes Two", 41],
  ["1402418440685486130", "Among Us", 37],
  ["1402418087793528862", "Risk of Rain 2", 33],
  ["356888577310851072", "Team Fortress 2", 29],
  ["1402418103702524046", "Phasmophobia", 24],
  ["1402416901551816837", "Celeste", 19],
  ["359508941782122496", "Portal 2", 14],
  ["1402418606364688549", "Slay the Spire", 11],
  ["1237101681695522867", "Hades II", 9],
  ["357607133254254632", "Dead by Daylight", 6],
  ["1402418594532298837", "Rust", 3.5],
];
// Games first played since late 2024, for the badge comparison.
const NEW_GAMES = new Set(["Balatro", "Hades II", "Lethal Company", "Slay the Spire", "Celeste"]);

const stats = GAMES.map(([id, name, h], i) => {
  const first = NEW_GAMES.has(name) ? Date.UTC(2024, 11, 1) + i * 9 * DAY : START + i * 40 * DAY;
  return {
    application_id: id,
    total_duration: Math.round(h * 3600 + int(0, 3599)),
    first_played_at: NEW_GAMES.has(name) || i > 15 ? iso(first) : null, // only filled for newer games, like real packages
    last_played_at: iso(END - int(0, 400) * DAY),
  };
});

const user = {
  id: "100000000000000001",
  username: "demo_player",
  global_name: "Demo Player",
  // A new-style package: flags as names, payments in discord_billing/.
  flags: ["HYPESQUAD_ONLINE_HOUSE_3", "PREMIUM_EARLY_SUPPORTER", "USED_DESKTOP_CLIENT", "USED_MOBILE_CLIENT", "HAS_SESSION_STARTED"],
  premium_until: "2027-03-14T00:00:00+00:00",
  relationships: [
    ...Array.from({ length: 64 }, (_, i) => ({ id: `90000000000000${String(i).padStart(4, "0")}`, type: "FRIEND" })),
    { id: "900000000000009998", type: "BLOCKED" },
    { id: "900000000000009999", type: "PENDING_INCOMING" },
  ],
  connections: [
    { type: "steam", name: "demo_player", revoked: false },
    { type: "spotify", name: "Demo Player", revoked: false },
    { type: "twitch", name: "demoplayer_live", revoked: false },
    { type: "xbox", name: "DemoPlayer42", revoked: false },
    { type: "github", name: "old-account", revoked: true },
  ],
  user_sessions: [
    ["Windows", "Discord Client", "2026-10-20"], ["Android", "Discord Android", "2026-10-19"],
    ["Windows", "Chrome", "2026-08-02"], ["iOS", "Discord iOS", "2025-12-24"],
  ].map(([os, platform, day]) => ({ user_data: { approx_last_used_time: `${day}T18:00:00+00:00`, client_info: { os, platform } } })),
  user_activity_application_statistics: stats,
  library_applications: [],
  user_profile_metadata: {
    legacy_username: "DemoPlayer#4821",
    premium_started_at: "2020-03-14T00:00:00+00:00",
    owned_badges: [
      { badge: { type: 19, tier_base: { tier: "standout", tier_obtained_at: { newcomer: "2024-11-03", fledgling: "2024-11-10", breakout: "2024-12-20", standout: "2025-05-02" } } } },
      { badge: { type: 20, tier_base: { tier: "devoted", tier_obtained_at: { casual: "2024-11-02", recreational: "2024-11-04", dedicated: "2024-11-20", committed: "2025-02-11", serious: "2025-06-30", devoted: "2026-04-18" } } } },
      { badge: { type: 21, tier_base: { tier: "dabbler", tier_obtained_at: { sampler: "2024-12-05", dabbler: "2025-03-01" } } } },
    ],
  },
};

// ---- Servers, channels, people ---------------------------------------------

const SERVERS: [string, string][] = [
  ["300000000000000001", "Pixel Pals"],
  ["300000000000000002", "Late Night Raids"],
  ["300000000000000003", "Cozy Farm Club"],
  ["300000000000000004", "Uni Study Group"],
  ["300000000000000005", "Rocket Garage"],
];
const VOICE: [string, string, string][] = [ // server, channel id, name
  ["300000000000000001", "400000000000000001", "Hangout"],
  ["300000000000000001", "400000000000000002", "Gaming 1"],
  ["300000000000000002", "400000000000000003", "Raid Room"],
  ["300000000000000003", "400000000000000004", "Porch"],
  ["300000000000000004", "400000000000000005", "Library"],
  ["300000000000000005", "400000000000000006", "Garage"],
  ["300000000000000001", "400000000000000007", "AFK"],
];
const TEXT: [string, string, string][] = [
  ["300000000000000001", "500000000000000001", "general"],
  ["300000000000000001", "500000000000000002", "memes"],
  ["300000000000000002", "500000000000000003", "lfg"],
  ["300000000000000003", "500000000000000004", "farm-talk"],
  ["300000000000000004", "500000000000000005", "homework-help"],
  ["300000000000000005", "500000000000000006", "replays"],
  ["300000000000000001", "500000000000000007", "music"],
];
const FRIENDS = ["sunny_side", "milo.exe", "ravenclaw42", "pancake_queen", "night_owl", "tofu_tom", "kiwi_kat", "byte_me"];
const DMS = FRIENDS.map((name, i) => ({ id: `600000000000000${String(i + 1).padStart(3, "0")}`, name, other: `70000000000000${String(i + 1).padStart(4, "0")}` }));
const GROUPS = [{ id: "800000000000000001", name: "weekend squad" }, { id: "800000000000000002", name: "" }];

// ---- Activity events ---------------------------------------------------------

const events: string[] = [];
// Mostly home, with the odd trip, like a real package. Not from rand(), so
// adding it didn't change the rest of the made-up data.
const zoneOf = () => (events.length % 40 === 39 ? "Europe/London" : "America/New_York");
const push = (e: Record<string, unknown>) => events.push(JSON.stringify({ event_id: eventId(), time_zone: zoneOf(), ...e }));
const STREAMED = GAMES.slice(0, 14);

for (let day = START; day < END; day += DAY) {
  const a = activity(day);
  // Evenings in India (UTC+5:30), as UTC.
  const at = () => day + (12 + rand() * 7) * 3_600_000;

  // Voice: most days, longer in busy periods.
  if (rand() < 0.55 * a + 0.15) {
    const calls = int(1, 2);
    for (let c = 0; c < calls; c++) {
      const dm = rand() < 0.12;
      const [guild, channel] = dm ? [null, pick(DMS).id] : pickRanked(VOICE, 0.6);
      const sec = Math.round((0.4 + rand() * 3.2 * a) * 3600);
      const speak = sec * (0.15 + rand() * 0.2), listen = sec * (0.35 + rand() * 0.25);
      push({
        event_type: "voice_disconnect", timestamp: iso(at()), duration: sec * 1000,
        duration_connected: sec, duration_speaking: Math.round(speak), duration_listening: Math.round(listen),
        channel_type: dm ? 1 : 2, guild_id: guild, channel_id: channel, context: "default",
      });
    }
  }
  // Go Live.
  if (rand() < 0.22 * a) {
    const g = pickRanked(STREAMED, 0.5);
    const screen = rand() < 0.15;
    push({
      event_type: "video_stream_ended", timestamp: iso(at()), context: "stream", participant_type: "streamer",
      duration: Math.round((0.3 + rand() * 2.6 * a) * 3600), max_viewers: int(1, 6) + (rand() < 0.04 ? int(4, 10) : 0),
      share_application_name: screen ? "" : g[1], share_application_id: screen ? null : g[0],
    });
  }
  // Watching friends stream.
  if (rand() < 0.25 * a) {
    push({ event_type: "video_stream_ended", timestamp: iso(at()), context: "stream", participant_type: "receiver",
      duration: Math.round((0.2 + rand() * 1.8) * 3600), max_viewers: int(1, 5) });
  }
  // Cameras, now and then.
  if (rand() < 0.04) {
    push({ event_type: "video_stream_ended", timestamp: iso(at()), context: "default", participant_type: rand() < 0.4 ? "sender" : "receiver",
      duration: Math.round((0.1 + rand()) * 3600), max_viewers: 0 });
  }
}

// ---- Messages ----------------------------------------------------------------

const WORDS = `game tonight anyone raid ready nice play server stream later tomorrow build base loot ranked queue
clutch update patch map mod join voice farm crops boss cave dive night morning coffee pizza music song playlist
movie weekend work exam homework deadline lecture notes dog cat meme bro dude wait what sure maybe sounds good
thanks sorry hype cozy chill sleep tired busy free soon again round match win lose carry team strat spawn craft
mine dig diamonds redstone pickaxe rocket goal save replay`.split(/\s+/);
const EMOJI = ["😂", "😭", "🔥", "👀", "💀", "❤️", "🙏", "😅", "🎉", "👍", "🥲", "😎", "<:pepehype:900000000000000001>", "<:catjam:900000000000000002>"];

function sentence() {
  const n = int(2, 11);
  const words: string[] = [];
  for (let i = 0; i < n; i++) words.push(pickRanked(WORDS, 0.35));
  let s = words.join(" ");
  if (rand() < 0.25) s += " " + pickRanked(EMOJI, 0.8);
  if (rand() < 0.05) s = pickRanked(EMOJI, 0.6);
  return s;
}

const channels: { meta: Record<string, unknown>; index: string; msgs: { ID: number; Timestamp: string; Contents: string; Attachments: string }[] }[] = [
  ...TEXT.map(([g, id, name]) => ({
    meta: { id, type: 0, name, guild: { id: g, name: SERVERS.find((s) => s[0] === g)![1] } },
    index: `${name}, ${SERVERS.find((s) => s[0] === g)![1]}`, msgs: [],
  })),
  ...DMS.map((d) => ({ meta: { id: d.id, type: 1, recipients: [user.id, d.other] }, index: `Direct Message with ${d.name}`, msgs: [] })),
  ...GROUPS.map((gr) => ({ meta: { id: gr.id, type: 3, name: gr.name || null, recipients: [user.id, ...DMS.slice(0, 4).map((d) => d.other)] }, index: "None", msgs: [] })),
];

for (let day = START; day < END; day += DAY) {
  const n = Math.round(rand() * 9 * activity(day));
  for (let i = 0; i < n; i++) {
    const ch = pickRanked(channels, 0.7);
    // Mostly evenings, some afternoons, a few late nights (India time, as UTC).
    const hour = rand() < 0.7 ? 12.5 + rand() * 6 : rand() < 0.5 ? 5 + rand() * 4 : 18.5 + rand() * 3;
    const t = day + hour * 3_600_000;
    ch.msgs.push({
      ID: 1e18 + nextId++,
      Timestamp: iso(t).slice(0, 19).replace("T", " "),
      Contents: sentence(),
      Attachments: rand() < 0.06 ? "https://cdn.discordapp.com/attachments/demo/image.png" : "",
    });
  }
}

// ---- ZIP ---------------------------------------------------------------------

const files: [string, string][] = [
  ["Account/user.json", JSON.stringify(user)],
  ["Account/user_data_exports/discord_billing/payments.json", JSON.stringify({
    section: "payments",
    records: [
      ...[2020, 2021, 2022, 2023, 2024, 2025, 2026].map((y) =>
        ({ created_at: `${y}-03-14T09:30:00+00:00`, description: "Nitro Yearly", amount: 9999, amount_refunded: 0, currency: "usd", status: 1 })),
      { created_at: "2023-12-24T20:00:00+00:00", description: "Nitro Monthly (gift)", amount: 999, amount_refunded: 0, currency: "usd", status: 1 },
      { created_at: "2024-07-01T12:00:00+00:00", description: "Server Boost", amount: 499, amount_refunded: 499, currency: "usd", status: 4 },
      { created_at: "2025-02-10T12:00:00+00:00", description: "Nitro Basic Monthly", amount: 299, amount_refunded: 0, currency: "usd", status: 2 },
    ],
  })],
  ["Account/applications/110000000000000001/application.json", JSON.stringify({ id: "110000000000000001", name: "Raid Reminder Bot" })],
  ["Servers/index.json", JSON.stringify(Object.fromEntries(SERVERS))],
  ...SERVERS.map(([id, name]): [string, string] => [`Servers/${id}/guild.json`, JSON.stringify({ id, name })]),
  ["Messages/index.json", JSON.stringify(Object.fromEntries(channels.map((c) => [c.meta.id, c.index])))],
  ...channels.flatMap((c): [string, string][] => [
    [`Messages/c${c.meta.id}/channel.json`, JSON.stringify(c.meta)],
    [`Messages/c${c.meta.id}/messages.json`, JSON.stringify(c.msgs)],
  ]),
  ["Activity/reporting/events-2026-00000-of-00001.json", events.join("\n") + "\n"],
];

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(b: Uint8Array) {
  let c = -1;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const parts: Buffer[] = [];
const central: Buffer[] = [];
let offset = 0;
for (const [name, text] of files) {
  const raw = Buffer.from(text, "utf8");
  const data = deflateRawSync(raw);
  const nameBuf = Buffer.from(name, "utf8");
  const crc = crc32(raw);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0x0800, 8);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(raw.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt32LE(offset, 42);
  parts.push(local, nameBuf, data);
  central.push(cd, nameBuf);
  offset += local.length + nameBuf.length + data.length;
}
const cdSize = central.reduce((s, b) => s + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cdSize, 12);
end.writeUInt32LE(offset, 16);
writeFileSync(out, Buffer.concat([...parts, ...central, end]));
console.log(`wrote ${out}: ${files.length} files, ${events.length} events, ${channels.reduce((s, c) => s + c.msgs.length, 0)} messages`);
