// Runs the site's parser on a real package under Node and prints the headline
// numbers, to compare with scripts/stats.py in the repo root.
//
//   node scripts/check.ts ../data/package.zip

import { openAsBlob } from "node:fs";
import { parsePackage, resolveAppNames } from "../src/lib/parse.ts";
import { LIFETIME, badges, hours, playtime, ranges, streams, voice } from "../src/lib/stats.ts";

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

const names = await resolveAppNames(data.games.map((g) => g.id), data.libraryNames);
const p = playtime(data.games, names);
console.log(`\nplaytime: ${p.rows.length} games, ${hours(p.total)}`);
for (const r of p.rows.slice(0, 3)) console.log(`  ${r.name}: ${hours(r.seconds)}`);

const s = streams(data.streams, LIFETIME);
console.log(`\nstreams: Go Live ${hours(s.seconds[0])} (${s.sessions[0]}), watching ${hours(s.seconds[1])},`,
  `camera ${hours(s.seconds[2])}, watching cams ${hours(s.seconds[3])}`);
console.log("  by year:", s.byYear.map(([y, r]) => `${y}: ${hours(r[0])}`).join(", "));

const v = voice(data.voice, LIFETIME, data);
console.log(`\nvoice: ${hours(v.total)}, ${v.connections} connections, talking ${hours(v.speaking)},`,
  `listening ${hours(v.listening)}, connected ${hours(v.connected)}`);
console.log("  top servers:", v.servers.slice(0, 3).map(([n, x]) => `${n} ${hours(x)}`).join(", "));

const since2024 = ranges(data).find((r) => r.label === "2024")!;
console.log(`\nvoice 2024: ${hours(voice(data.voice, since2024, data).total)}`);

console.log("\nbadges:");
for (const b of badges(data, names)) {
  console.log(`  ${b.name}: ${b.tier} (${b.threshold ?? "?"} ${b.unit}) | ${b.oursNote}: ${b.ours.toFixed(0)} | lifetime ${b.lifetime.toFixed(0)}`);
}
