// The /stats/ page: file input, worker, progress, and rendering the results.
// Plain DOM; every value from the package goes through esc().

import type { PackageData } from "./parse.ts";
import {
  BADGE_START, LIFETIME, STREAM_ROLE_LABELS, badges, hours, pct, playtime, ranges, streams, voice, type Range,
} from "./stats.ts";
import type { WorkerMessage } from "./worker.ts";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const drop = $<HTMLElement>("#drop");
const input = $<HTMLInputElement>("#file");
const progress = $<HTMLElement>("#progress");
const phase = $<HTMLElement>("#phase");
const bar = $<HTMLElement>("#bar");
const percent = $<HTMLElement>("#percent");
const cancel = $<HTMLButtonElement>("#cancel");
const errorBox = $<HTMLElement>("#error");
const results = $<HTMLElement>("#results");

let worker: Worker | null = null;

function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function show(which: "drop" | "progress" | "results") {
  drop.hidden = which !== "drop";
  progress.hidden = which !== "progress";
  results.hidden = which !== "results";
}

function fail(message: string) {
  worker?.terminate();
  worker = null;
  errorBox.textContent = message;
  errorBox.hidden = false;
  show("drop");
}

function start(file: File) {
  errorBox.hidden = true;
  if (!/\.zip$/i.test(file.name)) {
    fail("Choose the package.zip file Discord emailed you (not an extracted folder).");
    return;
  }
  show("progress");
  phase.textContent = "Starting";
  bar.style.width = "0%";
  percent.textContent = "";
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const m = e.data;
    if (m.type === "progress") {
      phase.textContent = m.phase;
      const p = m.total ? Math.round((m.done / m.total) * 100) : null;
      bar.style.width = p === null ? "100%" : `${p}%`;
      bar.classList.toggle("indeterminate", p === null);
      percent.textContent = p === null ? "" : `${p}%`;
    } else if (m.type === "error") {
      fail(`Couldn't read this package: ${m.message}`);
    } else {
      worker?.terminate();
      worker = null;
      render(m.data, m.names);
    }
  };
  worker.onerror = (e) => fail(`Something went wrong while reading the package: ${e.message}`);
  worker.postMessage(file);
}

input.addEventListener("change", () => input.files?.[0] && start(input.files[0]));
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const file = e.dataTransfer?.files[0];
  if (file) start(file);
});
cancel.addEventListener("click", () => {
  worker?.terminate();
  worker = null;
  show("drop");
});

// ---- Rendering ---------------------------------------------------------

function table(rows: [string, number][], total = rows.reduce((s, r) => s + r[1], 0), max = rows[0]?.[1] ?? 0) {
  if (!rows.length) return `<p class="muted">Nothing in this range.</p>`;
  return `<table class="bars">${rows
    .map(([name, s]) => `<tr>
      <td class="name">${esc(name)}<span class="bar" style="width:${max ? (s / max) * 100 : 0}%"></span></td>
      <td class="num">${hours(s)}</td><td class="num muted">${pct(s, total)}</td></tr>`)
    .join("")}</table>`;
}

function tile(label: string, value: string, sub = "") {
  return `<div class="tile"><div class="tile-label">${esc(label)}</div><div class="tile-value">${esc(value)}</div>${
    sub ? `<div class="tile-sub muted">${esc(sub)}</div>` : ""}</div>`;
}

const date = (t: number) => new Date(t).toISOString().slice(0, 10);

// ---- Tabs ----------------------------------------------------------------
// One tab per topic. Only tabs whose data has dates get the range chips; the
// rest say "Lifetime", since the package only has lifetime totals for them.

const TABS = [
  { id: "overview", label: "Overview", ranged: false },
  { id: "games", label: "Games", ranged: false },
  { id: "streaming", label: "Streaming", ranged: true },
  { id: "voice", label: "Voice", ranged: true },
  { id: "badges", label: "Badges", ranged: false },
] as const;
type TabId = (typeof TABS)[number]["id"];

const tabFromHash = (): TabId => TABS.find((t) => `#${t.id}` === location.hash)?.id ?? "overview";

// Set while results are shown, so hash changes (tab links, back / forward) redraw.
let redraw: (() => void) | null = null;
window.addEventListener("hashchange", () => redraw?.());

function render(data: PackageData, names: Record<string, string>) {
  const all = ranges(data);
  const play = playtime(data.games, names);
  const badgeRows = badges(data, names);
  const who = data.user ? data.user.globalName || data.user.username : "Your package";
  // Shared by the ranged tabs, so switching between Streaming and Voice keeps it.
  let range: Range = LIFETIME;

  const overview = () => {
    const s = streams(data.streams, LIFETIME);
    const v = voice(data.voice, LIFETIME, data);
    const top = (rows: [string, number][]) => rows[0] ? `${rows[0][0]}` : "–";
    return `
      <div class="tiles">
        ${tile("Games played", hours(play.total), `${play.rows.length} games`)}
        ${tile("Go Live", hours(s.seconds[0]), `${s.sessions[0].toLocaleString()} streams`)}
        ${tile("Watching streams", hours(s.seconds[1]))}
        ${tile("In voice", hours(v.total), `${v.connections.toLocaleString()} connections`)}
        ${tile("Talking", hours(v.speaking), `${pct(v.speaking, v.connected)} of connected time`)}
      </div>
      <div class="tiles">
        ${tile("Most played game", play.rows[0]?.name ?? "–", play.rows[0] ? hours(play.rows[0].seconds) : "")}
        ${tile("Most streamed", top(s.topApps), s.topApps[0] ? hours(s.topApps[0][1]) : "")}
        ${tile("Top voice server", top(v.servers), v.servers[0] ? hours(v.servers[0][1]) : "")}
      </div>`;
  };

  const games = () => `
    <section class="card">
      <h2>Playtime</h2>
      <p class="muted">The package has a single total per game, with no dates, so this can't be split by year.</p>
      ${table(play.rows.slice(0, 20).map((r) => [r.name, r.seconds]), play.total)}
      ${play.rows.length > 20 ? `<details><summary>Show all ${play.rows.length} games</summary>${
        table(play.rows.slice(20).map((r) => [r.name, r.seconds]), play.total, play.rows[0].seconds)}</details>` : ""}
    </section>`;

  const streaming = () => {
    const s = streams(data.streams, range);
    return `
      <div class="tiles">${STREAM_ROLE_LABELS.map((l, i) =>
        tile(l, hours(s.seconds[i]), `${s.sessions[i].toLocaleString()} sessions`)).join("")}</div>
      <section class="card">
        <div class="split">
          <div>
            <h3>What you streamed</h3>
            ${table(s.topApps, s.seconds[0])}
          </div>
          <div>
            ${s.longest ? `<p class="muted">Longest stream: ${hours(s.longest.sec)} of ${
              esc(s.longest.app || "a screen share")} on ${esc(date(s.longest.t))}.
              Most viewers on one stream: ${s.maxViewers}.</p>` : ""}
            <h3>By year</h3>
            <table class="plain"><tr class="muted"><td></td><td class="num">Go Live</td><td class="num">Watching</td><td class="num">Camera</td><td class="num">Cams</td></tr>
              ${s.byYear.map(([y, r]) => `<tr><td>${y}</td>${r.map((x) => `<td class="num">${hours(x)}</td>`).join("")}</tr>`).join("")}
            </table>
          </div>
        </div>
      </section>`;
  };

  const voiceTab = () => {
    const v = voice(data.voice, range, data);
    return `
      <div class="tiles">
        ${tile("In voice", hours(v.total), `${v.connections.toLocaleString()} connections`)}
        ${tile("Talking", hours(v.speaking), `${pct(v.speaking, v.connected)} of connected time`)}
        ${tile("Listening", hours(v.listening), `${pct(v.listening, v.connected)}; overlaps with talking`)}
        ${v.longest ? tile("Longest connection", hours(v.longest.sec), `${v.longest.where}, ${date(v.longest.t)}`) : ""}
      </div>
      <section class="card">
        <div class="split">
          <div>
            <h3>Top servers</h3>
            ${table(v.servers, v.total)}
            <h3>Top channels</h3>
            ${table(v.channels, v.total)}
          </div>
          <div>
            <h3>By kind</h3>
            ${table(v.kinds)}
            <h3>By year</h3>
            ${table(v.byYear, v.total, Math.max(0, ...v.byYear.map((r) => r[1])))}
          </div>
        </div>
      </section>`;
  };

  const badgesTab = () => badgeRows.length ? `
    <section class="card">
      <p class="muted">Discord's badges probably only count from about ${BADGE_START} (Discord doesn't say; that's the date that best fits the data). Here's how that compares with everything in your package.</p>
      <div class="tiles">${badgeRows.map((b) => {
        const fmt = (n: number) => `${Math.round(n).toLocaleString()}${b.unit === "h" ? " h" : " games"}`;
        return tile(
          `${b.name}: ${b.tier[0].toUpperCase()}${b.tier.slice(1)}`,
          fmt(b.ours),
          `${b.oursNote}. Lifetime: ${fmt(b.lifetime)}.${b.next ? ` Next tier at ${fmt(b.next)}.` : ""}`,
        );
      }).join("")}</div>
    </section>` : `<p class="muted">No profile badges in this package.</p>`;

  const panels: Record<TabId, () => string> = {
    overview, games, streaming, voice: voiceTab, badges: badgesTab,
  };

  const draw = () => {
    const tab = tabFromHash();
    const ranged = TABS.find((t) => t.id === tab)!.ranged;
    results.innerHTML = `
      <div class="results-head">
        <div>
          <h1>${esc(who)}</h1>
          <p class="muted">Data up to ${esc(date(data.lastEvent || Date.now()))}. Nothing left your browser.</p>
        </div>
        <button class="button ghost small" id="again">Open another package</button>
      </div>
      ${data.missing.length ? `<div class="notice"><strong>Some sections weren't in this package.</strong><ul>${
        data.missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}
      <nav class="tabs" aria-label="Sections">${TABS.map((t) =>
        `<a href="#${t.id}" class="tab"${t.id === tab ? ` aria-current="page"` : ""}>${t.label}</a>`).join("")}</nav>
      ${ranged
        ? `<div class="chips" role="group" aria-label="Time range">${all.map((r, i) =>
            `<button class="chip" data-i="${i}" aria-pressed="${r.label === range.label}">${esc(r.label)}</button>`).join("")}</div>`
        : `<p class="range-note muted">Lifetime totals</p>`}
      <div class="panel">${panels[tab]()}</div>
    `;

    results.querySelectorAll<HTMLButtonElement>(".chips .chip").forEach((c) =>
      c.addEventListener("click", () => {
        range = all[Number(c.dataset.i)];
        draw();
      }));
    $<HTMLButtonElement>("#again").addEventListener("click", () => {
      redraw = null;
      input.value = "";
      show("drop");
    });
  };

  redraw = draw;
  draw();
  show("results");
  window.scrollTo({ top: 0 });
}
