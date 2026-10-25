// The /stats/ page: file input, worker, progress, and rendering the results.
// Plain DOM; every value from the package goes through esc().

import { appIcon, type Apps, type PackageData } from "./parse.ts";
import {
  BADGE_START, LIFETIME, SCREEN_SHARE, STREAM_ROLE_LABELS, badges, canonName, dataSpan, gameIcon, hours, idsByName, messages, pct, playtime,
  ranges, streamNamer, streams, voice,
  type MessageStats, type Range,
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
      render(m.data, m.apps);
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

const count = (n: number) => n.toLocaleString("en-US");

function table(
  rows: [string, number][],
  total = rows.reduce((s, r) => s + r[1], 0),
  max = rows[0]?.[1] ?? 0,
  fmt: (n: number) => string = hours,
  icon?: (name: string) => string | null, // image URL per row; rows without one get a blank square
) {
  if (!rows.length) return `<p class="muted">Nothing in this range.</p>`;
  const pic = (name: string) => {
    if (!icon) return "";
    const url = icon(name);
    return url ? `<img class="row-icon" src="${esc(url)}" alt="" width="24" height="24" loading="lazy">`
      : `<span class="row-icon"></span>`;
  };
  return `<table class="bars">${rows
    .map(([name, s]) => `<tr>
      <td class="name">${pic(name)}${esc(name)}<span class="bar" style="width:${max ? (s / max) * 100 : 0}%"></span></td>
      <td class="num">${fmt(s)}</td><td class="num muted">${pct(s, total)}</td></tr>`)
    .join("")}</table>`;
}

// Vertical bar chart. `label` picks the axis label for a point ("" = none),
// so long series only label a few points; the tooltip always has the full key.
function columns(points: [string, number][], label: (key: string, i: number) => string = (k) => k) {
  if (!points.length) return `<p class="muted">Nothing in this range.</p>`;
  const max = Math.max(...points.map((p) => p[1])) || 1;
  return `<div class="cols">${points
    .map(([key, n], i) => `<div class="col" title="${esc(key)}: ${count(n)}">
      <span class="col-bar" style="height:${(n / max) * 100}%"></span>
      <span class="col-label">${esc(label(key, i))}</span></div>`)
    .join("")}</div>`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function seriesChart(s: MessageStats["series"]) {
  const pts = s.points;
  if (s.unit === "day") return columns(pts, (k, i) => (i % 7 === 0 ? k.slice(5) : ""));
  // Many months: label each January with its year. A year or less: month names.
  if (pts.length > 18) return columns(pts, (k, i) => (k.endsWith("-01") || i === 0 ? k.slice(0, 4) : ""));
  return columns(pts, (k) => MONTHS[Number(k.slice(5, 7)) - 1]);
}

function tile(label: string, value: string, sub = "", img: string | null = null) {
  const text = `<div class="tile-label">${esc(label)}</div><div class="tile-value">${esc(value)}</div>${
    sub ? `<div class="tile-sub muted">${esc(sub)}</div>` : ""}`;
  return img
    ? `<div class="tile has-img"><img src="${esc(img)}" alt="" width="56" height="56"><div>${text}</div></div>`
    : `<div class="tile">${text}</div>`;
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
  { id: "messages", label: "Messages", ranged: true },
  { id: "badges", label: "Badges", ranged: false },
] as const;
type TabId = (typeof TABS)[number]["id"];

const tabFromHash = (): TabId => TABS.find((t) => `#${t.id}` === location.hash)?.id ?? "overview";

// Set while results are shown, so hash changes (tab links, back / forward) redraw.
let redraw: (() => void) | null = null;
window.addEventListener("hashchange", () => redraw?.());

function render(data: PackageData, apps: Apps) {
  const { names, icons, aliases } = apps;
  const streamName = streamNamer(apps);
  const all = ranges(data);
  const play = playtime(data.games, names);
  const badgeRows = badges(data, names);
  const span = dataSpan(data);
  let byName: Map<string, string[]> | null = null; // built on first use; walks Discord's whole app list
  const iconUrl = (ids: string[] | undefined) => {
    const icon = ids && gameIcon(ids, icons);
    return icon ? appIcon(icon.id, icon.hash) : null;
  };
  // Small icons in tables: 64 px covers 24 px at high-DPI.
  const rowIcon = (name: string) => {
    byName ??= idsByName(names, play.rows, aliases);
    const icon = gameIcon(byName.get(canonName(name)) ?? [], icons);
    return icon ? appIcon(icon.id, icon.hash, 64) : null;
  };
  const iconForName = (name: string) => {
    byName ??= idsByName(names, play.rows, aliases);
    return iconUrl(byName.get(canonName(name)));
  };
  const who = data.user ? data.user.globalName || data.user.username : "Your package";
  // Shared by the ranged tabs, so switching between Streaming and Voice keeps it.
  let range: Range = LIFETIME;
  // Word and emoji counting goes over every message, so keep results per range.
  const messageCache = new Map<string, MessageStats>();
  const messagesFor = (r: Range) => {
    if (!messageCache.has(r.label)) messageCache.set(r.label, messages(data, r));
    return messageCache.get(r.label)!;
  };

  const overview = () => {
    const s = streams(data.streams, LIFETIME, streamName);
    const v = voice(data.voice, LIFETIME, data);
    const m = messagesFor(LIFETIME);
    const top = (rows: [string, number][]) => rows[0] ? `${rows[0][0]}` : "–";
    const topGame = s.topApps.find(([name]) => name !== SCREEN_SHARE);
    return `
      <div class="tiles">
        ${tile("Games played", hours(play.total), `${play.rows.length} games`)}
        ${tile("Go Live", hours(s.seconds[0]), `${s.sessions[0].toLocaleString()} streams`)}
        ${tile("Watching streams", hours(s.seconds[1]))}
        ${tile("In voice", hours(v.total), `${v.connections.toLocaleString()} connections`)}
        ${tile("Talking", hours(v.speaking), `${pct(v.speaking, v.connected)} of connected time`)}
        ${tile("Messages sent", count(m.count), `${m.perDay.toFixed(1)} a day`)}
      </div>
      <div class="tiles">
        ${tile("Most played game", play.rows[0]?.name ?? "–", play.rows[0] ? hours(play.rows[0].seconds) : "",
          iconUrl(play.rows[0]?.ids))}
        ${tile("Most streamed game", topGame?.[0] ?? "–", topGame ? hours(topGame[1]) : "",
          topGame ? iconForName(topGame[0]) : null)}
        ${tile("Top voice server", top(v.servers), v.servers[0] ? hours(v.servers[0][1]) : "")}
      </div>`;
  };

  const unnamed = play.rows.filter((r) => r.name.startsWith("Unknown app (")).length;
  const games = () => `
    ${unnamed ? `<div class="notice">${unnamed} ${unnamed === 1 ? "game" : "games"} couldn't be named. Game names come
      from Discord, and the lookup failed or was blocked, which ad and tracker blockers sometimes do. Reloading the
      page and opening the package again usually fixes it.</div>` : ""}
    <section class="card">
      <h2>Playtime</h2>
      <p class="muted">The package has a single total per game, with no dates, so this can't be split by year.</p>
      ${table(play.rows.slice(0, 20).map((r) => [r.name, r.seconds]), play.total, undefined, hours, rowIcon)}
      ${play.rows.length > 20 ? `<details><summary>Show all ${play.rows.length} games</summary>${
        table(play.rows.slice(20).map((r) => [r.name, r.seconds]), play.total, play.rows[0].seconds, hours, rowIcon)}</details>` : ""}
    </section>`;

  const streaming = () => {
    const s = streams(data.streams, range, streamName);
    return `
      <div class="tiles">${STREAM_ROLE_LABELS.map((l, i) =>
        tile(l, hours(s.seconds[i]), `${s.sessions[i].toLocaleString()} sessions`)).join("")}</div>
      <section class="card">
        <div class="split">
          <div>
            <h3>What you streamed</h3>
            ${table(s.topApps, s.seconds[0], undefined, hours, rowIcon)}
          </div>
          <div>
            ${s.longest ? `<p class="muted">Longest stream: ${hours(s.longest.sec)} of ${
              esc(s.longest.name === SCREEN_SHARE ? "a screen share" : s.longest.name)} on ${esc(date(s.longest.t))}.
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

  const messagesTab = () => {
    if (!data.channels.length) return `<p class="muted">There's no Messages folder in this package.</p>`;
    const m = messagesFor(range);
    if (!m.count) return `<p class="muted">No messages in this range.</p>`;
    const busiest = m.hours.indexOf(Math.max(...m.hours));
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const maxWord = m.words[0]?.[1] ?? 1;
    return `
      <div class="tiles">
        ${tile("Messages sent", count(m.count), `${m.perDay.toFixed(1)} a day`)}
        ${tile("Characters typed", count(m.chars), `${Math.round(m.chars / m.count)} per message`)}
        ${tile("Days you sent something", count(m.activeDays))}
        ${tile("With attachments", count(m.attachments), pct(m.attachments, m.count))}
        ${tile("Busiest hour", `${String(busiest).padStart(2, "0")}:00`, tz)}
      </div>
      <section class="card">
        <h3>Messages over time</h3>
        ${seriesChart(m.series)}
        <div class="split">
          <div>
            <h3>Hour of day <span class="muted small">(${esc(tz)})</span></h3>
            ${columns(m.hours.map((n, h) => [`${String(h).padStart(2, "0")}:00`, n] as [string, number]),
              (k, i) => (i % 3 === 0 ? k.slice(0, 2) : ""))}
          </div>
          <div>
            <h3>Day of week</h3>
            ${columns(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => [d, m.weekdays[i]] as [string, number]))}
          </div>
        </div>
      </section>
      <section class="card">
        <div class="split">
          <div>
            <h3>Top DMs</h3>
            ${table(m.dms, m.count, undefined, count)}
            ${m.groups.length ? `<h3>Group DMs</h3>${table(m.groups, m.count, undefined, count)}` : ""}
          </div>
          <div>
            <h3>Top servers</h3>
            ${table(m.servers, m.count, undefined, count)}
            <h3>Top channels</h3>
            ${table(m.channels, m.count, undefined, count)}
          </div>
        </div>
      </section>
      <section class="card">
        <div class="split">
          <div>
            <h3>Favourite words</h3>
            <p class="cloud">${m.words.map(([w, n]) =>
              `<span style="font-size:${(0.85 + (n / maxWord) * 0.9).toFixed(2)}rem" title="${count(n)}×">${esc(w)}</span>`).join(" ")}</p>
            <p class="muted small">Leaves out common English words, links, code and bot commands.</p>
          </div>
          <div>
            <h3>Emoji</h3>
            ${m.emojis.length ? `<div class="emoji-grid">${m.emojis.map(([e, n]) =>
              `<div class="emoji"><span class="${e.startsWith(":") ? "custom" : "glyph"}">${esc(e)}</span><span class="muted">${count(n)}</span></div>`).join("")}</div>`
              : `<p class="muted">No emoji in this range.</p>`}
          </div>
        </div>
      </section>
      ${m.first ? `<section class="card">
        <h3>Oldest message ${range === LIFETIME ? "in the package" : "in this range"}</h3>
        <p><span class="muted">${esc(date(m.first.t))} · ${esc(m.first.where)}</span><br>${esc(m.first.text.slice(0, 280)) || `<span class="muted">(attachment only)</span>`}</p>
      </section>` : ""}`;
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
    overview, games, streaming, voice: voiceTab, messages: messagesTab, badges: badgesTab,
  };

  const draw = () => {
    const tab = tabFromHash();
    const ranged = TABS.find((t) => t.id === tab)!.ranged;
    results.innerHTML = `
      <div class="results-head">
        <div>
          <h1>${esc(who)}</h1>
          <p class="muted">${span.last ? `Data from ${esc(date(span.first))} to ${esc(date(span.last))}.` : ""} Nothing left your browser.</p>
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

    // A missing icon just disappears (inline onerror would be blocked by the CSP).
    results.querySelectorAll("img").forEach((img) =>
      img.addEventListener("error", () => {
        // Keep table rows aligned with the same blank square rows without an icon get.
        if (img.classList.contains("row-icon")) img.replaceWith(Object.assign(document.createElement("span"), { className: "row-icon" }));
        else img.remove();
      }, { once: true }));
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
