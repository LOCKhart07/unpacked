// Runs the site's parser on a real package under Node and prints the headline
// numbers, to compare with scripts/stats.py in the repo root.
//
//   node scripts/check.ts ../data/package.zip

import { openAsBlob } from "node:fs";
import { parsePackage, resolveApps } from "../src/lib/parse.ts";
import { LIFETIME, badges, hours, messages, playtime, ranges, streamNamer, streams, voice } from "../src/lib/stats.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/check.ts <package.zip>");
  process.exit(1);
}

const started = performance.now();
const data = await parsePackage(await openAsBlob(path), (p) =>
  process.stderr.write(`\r${p.phase} ${Math.round((p.done / p.total) * 100)}%   `),
);
console.error(`\nparsed in ${((performance.now() - started) / 1000).toFixed(1)} s`);
console.log("missing:", data.missing.length ? data.missing : "nothing");
console.log("user:", data.user?.username, "| streams:", data.streams.length, "| voice:", data.voice.length,
  "| last event:", new Date(data.lastEvent).toISOString());

const streamIds = data.streams.map((s) => s.appId).filter((id): id is string => !!id);
const exes = [...new Set(data.streams.filter((s) => !s.appId && s.exe).map((s) => s.exe!))];
const apps = await resolveApps([...new Set([...data.games.map((g) => g.id), ...streamIds])], data.libraryNames, exes);
const { names } = apps;
const p = playtime(data.games, names);
console.log(`\nplaytime: ${p.rows.length} games, ${hours(p.total)}`);
for (const r of p.rows.slice(0, 3)) console.log(`  ${r.name}: ${hours(r.seconds)}`);

const s = streams(data.streams, LIFETIME, streamNamer(apps));
console.log(`\nstreams: Go Live ${hours(s.seconds[0])} (${s.sessions[0]}), watching ${hours(s.seconds[1])},`,
  `camera ${hours(s.seconds[2])}, watching cams ${hours(s.seconds[3])}`);
console.log("  by year:", s.byYear.map(([y, r]) => `${y}: ${hours(r[0])}`).join(", "));
console.log("  top streamed:", s.topApps.slice(0, 16).map(([n, x]) => `${n} ${hours(x)}`).join(" | "));
console.log("  executables matched:", apps.exeIds);

const v = voice(data.voice, LIFETIME, data);
console.log(`\nvoice: ${hours(v.total)}, ${v.connections} connections, talking ${hours(v.speaking)},`,
  `listening ${hours(v.listening)}, connected ${hours(v.connected)}`);
console.log("  top servers:", v.servers.slice(0, 3).map(([n, x]) => `${n} ${hours(x)}`).join(", "));

const since2024 = ranges(data).find((r) => r.label === "2024")!;
console.log(`\nvoice 2024: ${hours(voice(data.voice, since2024, data).total)}`);

const m = messages(data, LIFETIME);
console.log(`\nmessages: ${m.count} in ${data.channels.length} channels, ${m.chars} chars, ${m.attachments} with attachments,`,
  `${m.activeDays} active days, ${m.perDay.toFixed(1)}/day`);
console.log("  top DMs:", m.dms.slice(0, 3).map(([n, c]) => `${n} ${c}`).join(", "));
console.log("  top channels:", m.channels.slice(0, 3).map(([n, c]) => `${n} ${c}`).join(", "));
console.log("  top servers:", m.servers.slice(0, 3).map(([n, c]) => `${n} ${c}`).join(", "));
console.log("  groups:", m.groups.map(([n, c]) => `${n} ${c}`).join(", "));
console.log("  words:", m.words.slice(0, 12).map(([w, c]) => `${w} ${c}`).join(", "));
console.log("  emojis:", m.emojis.slice(0, 10).map(([e, c]) => `${e} ${c}`).join(", "));
console.log("  series:", m.series.unit, m.series.points.length, "points; first", m.series.points[0], "| busiest hour:",
  m.hours.indexOf(Math.max(...m.hours)), "| first message:", m.first && new Date(m.first.t).toISOString(), m.first?.where);
const m2024 = messages(data, ranges(data).find((r) => r.label === "2024")!);
console.log(`  2024: ${m2024.count} messages, series ${m2024.series.unit} x${m2024.series.points.length}`);

console.log("\nbadges:");
for (const b of badges(data, names)) {
  console.log(`  ${b.name}: ${b.tier} (${b.threshold ?? "?"} ${b.unit}) | ${b.oursNote}: ${b.ours.toFixed(0)} | lifetime ${b.lifetime.toFixed(0)}`);
}
