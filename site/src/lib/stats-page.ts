// The /stats/ page: file input, worker, progress, and rendering the results.
// Plain DOM; every value from the package goes through esc().

import { appIcon, type Apps, type PackageData } from "./parse.ts";
import {
  BADGE_START, LIFETIME, SCREEN_SHARE, STREAM_ROLE_LABELS, badges, canonName, dataSpan, gameIcon, hours, idsByName, messages, pct, playtime,
  ranges, streamNamer, streams, voice,
  type MessageStats, type Range, type Series,
} from "./stats.ts";
import { wordCloud } from "./wordcloud.ts";
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

const DAY = 86_400_000;
const count = (n: number) => n.toLocaleString("en-US");
const strong = (s: string) => `<strong>${esc(s)}</strong>`;

// "414 days" for big totals, so a number of hours means something.
function nonstop(sec: number) {
  const d = sec / 86_400;
  return d >= 2 ? `${count(Math.round(d))} days` : `${count(Math.round(sec / 3600))} hours`;
}

function table(
  rows: [string, number][],
  total = rows.reduce((s, r) => s + r[1], 0),
  max = rows[0]?.[1] ?? 0,
  fmt: (n: number) => string = hours,
  icon?: (name: string) => string | null, // image URL per row; rows without one get a blank square
  firstRank: number | null = 1, // null for tables in date order, which aren't a ranking
) {
  if (!rows.length) return `<p class="muted">Nothing in this range.</p>`;
  const pic = (name: string) => {
    if (!icon) return "";
    const url = icon(name);
    return url ? `<img class="row-icon" src="${esc(url)}" alt="" width="24" height="24" loading="lazy">`
      : `<span class="row-icon"></span>`;
  };
  // Fixed column widths, so tables side by side line up.
  return `<table class="bars"><colgroup><col class="c-rank"><col><col class="c-num"><col class="c-pct"></colgroup>${rows
    .map(([name, s], i) => `<tr${firstRank !== null && i + firstRank <= 3 ? ` class="podium"` : ""}>
      <td class="rank muted">${firstRank === null ? "" : i + firstRank}</td>
      <td class="name">${pic(name)}${esc(name)}<span class="bar" style="width:${max ? (s / max) * 100 : 0}%"></span></td>
      <td class="num">${fmt(s)}</td><td class="num muted">${pct(s, total)}</td></tr>`)
    .join("")}</table>`;
}

// Vertical bar chart with a value axis and a tooltip per bar. `label` picks
// the axis label under a bar ("" = none), so long series only label a few;
// `name` is the full name in the tooltip and the peak note.
function chart(
  points: [string, number][],
  fmt: (n: number) => string = count,
  label: (key: string, i: number) => string = (k) => k,
  name: (key: string) => string = (k) => k,
) {
  const max = Math.max(0, ...points.map((p) => p[1]));
  if (!max) return `<p class="muted">Nothing in this range.</p>`;
  const peak = points.findIndex((p) => p[1] === max);
  return `<div class="chart">
      <div class="axis muted"><span>${fmt(max)}</span><span>${fmt(max / 2)}</span><span></span></div>
      <div class="cols">${points
        .map(([key, n], i) => `<div class="col${i === peak ? " peak" : ""}" data-tip="${esc(name(key))}: ${esc(fmt(n))}">
          <span class="col-bar" style="height:${(n / max) * 100}%"></span>
          <span class="col-label">${esc(label(key, i))}</span></div>`)
        .join("")}</div>
    </div>`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (k: string) => `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
const dayName = (k: string) => `${Number(k.slice(8, 10))} ${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
const seriesKey = (s: Series, k: string) => (s.unit === "day" ? dayName(k) : monthName(k));

function seriesChart(s: Series, fmt: (n: number) => string = count) {
  const pts = s.points;
  const name = (k: string) => seriesKey(s, k);
  if (s.unit === "day") return chart(pts, fmt, (k, i) => (i % 7 === 0 ? `${Number(k.slice(8))} ${MONTHS[Number(k.slice(5, 7)) - 1]}` : ""), name);
  // Many months: label each January with its year. A year or less: month names.
  if (pts.length > 18) return chart(pts, fmt, (k, i) => (k.endsWith("-01") || i === 0 ? k.slice(0, 4) : ""), name);
  return chart(pts, fmt, (k) => MONTHS[Number(k.slice(5, 7)) - 1], name);
}

// The busiest bucket of a series, as "Mar 2021".
function peakOf(s: Series): [string, number] | null {
  let best: [string, number] | null = null;
  for (const p of s.points) if (p[1] > (best?.[1] ?? 0)) best = p;
  return best && [seriesKey(s, best[0]), best[1]];
}

function tile(label: string, value: string, sub = "", img: string | null = null) {
  const text = `<div class="tile-label">${esc(label)}</div><div class="tile-value">${esc(value)}</div>${
    sub ? `<div class="tile-sub muted">${esc(sub)}</div>` : ""}`;
  return img
    ? `<div class="tile has-img"><img src="${esc(img)}" alt="" width="56" height="56"><div>${text}</div></div>`
    : `<div class="tile">${text}</div>`;
}

// The headline number of a tab: bigger, with a line or two that put it in
// perspective. `lines` are HTML, built with strong() / esc().
function lead(label: string, value: string, lines: string[]) {
  return `<div class="tile lead"><div class="tile-label">${esc(label)}</div>
    <div class="lead-value">${esc(value)}</div>
    ${lines.filter(Boolean).map((l) => `<div class="lead-line">${l}</div>`).join("")}</div>`;
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
  // Days of data a range covers, for "a day" averages.
  const daysIn = (r: Range) => Math.max(1, (Math.min(r.to, span.last + 1) - Math.max(r.from, span.first)) / DAY);
  const perDay = (sec: number, r: Range) => `${hours(sec / daysIn(r))} a day`;
  const since = (r: Range) => (r === LIFETIME ? ` since ${date(span.first)}` : "");

  const overview = () => {
    const s = streams(data.streams, LIFETIME, streamName);
    const v = voice(data.voice, LIFETIME, data);
    const m = messagesFor(LIFETIME);
    const topGame = s.topApps.find(([name]) => name !== SCREEN_SHARE);
    const voicePeak = peakOf(v.series);
    const busiest = m.count ? m.hours.indexOf(Math.max(...m.hours)) : -1;
    const facts = [
      v.connected && `You talked for ${strong(hours(v.speaking))}, ${strong(pct(v.speaking, v.connected))} of your time in voice.`,
      voicePeak && `Your biggest month in voice was ${strong(voicePeak[0])}, with ${strong(hours(voicePeak[1]))}.`,
      v.longest && `Your longest voice call lasted ${strong(hours(v.longest.sec))}, in ${esc(v.longest.where)} on ${esc(date(v.longest.t))}.`,
      s.longest && `Your longest stream was ${strong(hours(s.longest.sec))} of ${
        esc(s.longest.name === SCREEN_SHARE ? "a screen share" : s.longest.name)} on ${esc(date(s.longest.t))}.`,
      s.seconds[1] && `You watched other people stream for ${strong(hours(s.seconds[1]))}.`,
      play.rows[0] && `${strong(play.rows[0].name)} is ${strong(pct(play.rows[0].seconds, play.total))} of all your playtime.`,
      busiest >= 0 && `You send the most messages around ${strong(`${String(busiest).padStart(2, "0")}:00`)}.`,
      m.words[0] && `Your favourite word is ${strong(`“${m.words[0][0]}”`)}, used ${strong(count(m.words[0][1]))} times.`,
      m.emojis[0] && `Your go-to emoji is ${strong(m.emojis[0][0])}, used ${strong(count(m.emojis[0][1]))} times.`,
    ].filter(Boolean);
    return `
      <div class="leads">
        ${lead("In voice", hours(v.total), [`${strong(nonstop(v.total))} nonstop`, `${esc(perDay(v.total, LIFETIME))}${since(LIFETIME)}`])}
        ${lead("Playing games", hours(play.total), [`${strong(nonstop(play.total))} nonstop`, `across ${count(play.rows.length)} games`])}
        ${lead("Streaming on Go Live", hours(s.seconds[0]), [`${strong(nonstop(s.seconds[0]))} nonstop`, `${count(s.sessions[0])} streams`])}
        ${lead("Messages sent", count(m.count), [`${strong(m.perDay.toFixed(1))} a day`, `${count(m.chars)} characters typed`])}
      </div>
      <div class="tiles">
        ${tile("Most played game", play.rows[0]?.name ?? "–", play.rows[0] ? hours(play.rows[0].seconds) : "",
          iconUrl(play.rows[0]?.ids))}
        ${tile("Most streamed game", topGame?.[0] ?? "–", topGame ? hours(topGame[1]) : "",
          topGame ? iconForName(topGame[0]) : null)}
        ${tile("Top voice server", v.servers[0]?.[0] ?? "–", v.servers[0] ? hours(v.servers[0][1]) : "")}
      </div>
      ${facts.length ? `<section class="card"><h2>Highlights</h2><ul class="facts">${
        facts.map((f) => `<li>${f}</li>`).join("")}</ul></section>` : ""}`;
  };

  const unnamed = play.rows.filter((r) => r.name.startsWith("Unknown app (")).length;
  const games = () => `
    ${unnamed ? `<div class="notice">${unnamed} ${unnamed === 1 ? "game" : "games"} couldn't be named. Game names come
      from Discord, and the lookup failed or was blocked, which ad and tracker blockers sometimes do. Reloading the
      page and opening the package again usually fixes it.</div>` : ""}
    <div class="leads">
      ${lead("Playing games", hours(play.total), [`${strong(nonstop(play.total))} nonstop`])}
      ${lead("Games played", count(play.rows.length), [
        play.rows[0] ? `top game: ${strong(play.rows[0].name)}` : "",
        play.rows.length >= 3 ? `top 3 are ${strong(pct(play.rows.slice(0, 3).reduce((t, r) => t + r.seconds, 0), play.total))} of it` : "",
      ])}
    </div>
    <section class="card">
      <h2>Playtime</h2>
      <p class="muted small">The package has a single total per game, with no dates, so this can't be split by year.</p>
      ${table(play.rows.slice(0, 20).map((r) => [r.name, r.seconds]), play.total, undefined, hours, rowIcon)}
      ${play.rows.length > 20 ? `<details><summary>Show all ${play.rows.length} games</summary>${
        table(play.rows.slice(20).map((r) => [r.name, r.seconds]), play.total, play.rows[0].seconds, hours, rowIcon, 21)}</details>` : ""}
    </section>`;

  const streaming = () => {
    const s = streams(data.streams, range, streamName);
    const peak = peakOf(s.series);
    return `
      <div class="tiles">
        ${lead(STREAM_ROLE_LABELS[0], hours(s.seconds[0]), [
          `${strong(count(s.sessions[0]))} streams, ${esc(perDay(s.seconds[0], range))}${since(range)}`,
          s.maxViewers ? `up to ${strong(count(s.maxViewers))} viewers on one stream` : "",
        ])}
        ${STREAM_ROLE_LABELS.slice(1).map((l, i) =>
          tile(l, hours(s.seconds[i + 1]), `${count(s.sessions[i + 1])} sessions`)).join("")}
      </div>
      <section class="card">
        <div class="card-head"><h2>Go Live over time</h2>${peak ? `<p class="muted small">Peak: ${strong(peak[0])}, ${esc(hours(peak[1]))}</p>` : ""}</div>
        ${seriesChart(s.series, hours)}
      </section>
      <section class="card">
        <div class="split">
          <div>
            <h3>What you streamed</h3>
            ${table(s.topApps, s.seconds[0], undefined, hours, rowIcon)}
          </div>
          <div>
            ${s.longest ? `<h3>Longest stream</h3><p>${strong(hours(s.longest.sec))} of ${
              esc(s.longest.name === SCREEN_SHARE ? "a screen share" : s.longest.name)} on ${esc(date(s.longest.t))}</p>` : ""}
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
    const peak = peakOf(v.series);
    return `
      <div class="tiles">
        ${lead("In voice", hours(v.total), [
          `${strong(nonstop(v.total))} nonstop`,
          `${esc(perDay(v.total, range))}${since(range)}, over ${count(v.connections)} connections`,
        ])}
        ${tile("Talking", hours(v.speaking), `${pct(v.speaking, v.connected)} of connected time`)}
        ${tile("Listening", hours(v.listening), `${pct(v.listening, v.connected)}; overlaps with talking`)}
        ${v.longest ? tile("Longest connection", hours(v.longest.sec), `${v.longest.where}, ${date(v.longest.t)}`) : ""}
      </div>
      <section class="card">
        <div class="card-head"><h2>Time in voice</h2>${peak ? `<p class="muted small">Peak: ${strong(peak[0])}, ${esc(hours(peak[1]))}</p>` : ""}</div>
        ${seriesChart(v.series, hours)}
      </section>
      <section class="card">
        <div class="split">
          <div><h3>Top servers</h3>${table(v.servers, v.total)}</div>
          <div><h3>Top channels</h3>${table(v.channels, v.total)}</div>
        </div>
        <div class="split">
          <div><h3>By kind</h3>${table(v.kinds)}</div>
          <div><h3>By year</h3>${table(v.byYear, v.total, Math.max(0, ...v.byYear.map((r) => r[1])), hours, undefined, null)}</div>
        </div>
      </section>`;
  };

  // Phones get fewer words in a squarer cloud, so the small ones stay readable.
  const cloud = (words: [string, number][]) => {
    const narrow = results.clientWidth < 600;
    return wordCloud(narrow ? words.slice(0, 40) : words, getComputedStyle(document.body).fontFamily, narrow ? 1 : 1.7);
  };

  const messagesTab = () => {
    if (!data.channels.length) return `<p class="muted">There's no Messages folder in this package.</p>`;
    const m = messagesFor(range);
    if (!m.count) return `<p class="muted">No messages in this range.</p>`;
    const busiest = m.hours.indexOf(Math.max(...m.hours));
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const peak = peakOf(m.series);
    return `
      <div class="tiles">
        ${lead("Messages sent", count(m.count), [
          `${strong(m.perDay.toFixed(1))} a day${since(range)}`,
          `something sent on ${strong(count(m.activeDays))} days`,
        ])}
        ${tile("Characters typed", count(m.chars), `${Math.round(m.chars / m.count)} per message`)}
        ${tile("With attachments", count(m.attachments), pct(m.attachments, m.count))}
        ${tile("Busiest hour", `${String(busiest).padStart(2, "0")}:00`, tz)}
      </div>
      <section class="card">
        <div class="card-head"><h2>Messages over time</h2>${peak ? `<p class="muted small">Peak: ${strong(peak[0])}, ${esc(count(peak[1]))}</p>` : ""}</div>
        ${seriesChart(m.series)}
        <div class="split">
          <div>
            <h3>Hour of day <span class="muted small">(${esc(tz)})</span></h3>
            ${chart(m.hours.map((n, h) => [`${String(h).padStart(2, "0")}:00`, n] as [string, number]),
              count, (k, i) => (i % 3 === 0 ? k.slice(0, 2) : ""))}
          </div>
          <div>
            <h3>Day of week</h3>
            ${chart(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => [d, m.weekdays[i]] as [string, number]))}
          </div>
        </div>
      </section>
      <section class="card">
        <div class="split">
          <div><h3>Top DMs</h3>${table(m.dms, m.count, undefined, count)}</div>
          <div><h3>Top servers</h3>${table(m.servers, m.count, undefined, count)}</div>
        </div>
        <div class="split">
          <div><h3>Top channels</h3>${table(m.channels, m.count, undefined, count)}</div>
          ${m.groups.length ? `<div><h3>Group DMs</h3>${table(m.groups, m.count, undefined, count)}</div>` : ""}
        </div>
      </section>
      <section class="card">
        <h2>Favourite words</h2>
        ${m.words.length ? cloud(m.words) : `<p class="muted">No words in this range.</p>`}
        <p class="muted small">Hover a word for how often you used it. Leaves out common English words, links, code and bot commands.</p>
      </section>
      <section class="card">
        <h2>Emoji</h2>
        ${m.emojis.length ? `<div class="emoji-grid">${m.emojis.map(([e, n]) =>
          `<div class="emoji"><span class="${e.startsWith(":") ? "custom" : "glyph"}">${esc(e)}</span><span class="muted">${count(n)}</span></div>`).join("")}</div>`
          : `<p class="muted">No emoji in this range.</p>`}
      </section>
      ${m.first ? `<section class="card">
        <h3>Oldest message ${range === LIFETIME ? "in the package" : "in this range"}</h3>
        <blockquote class="quote">${esc(m.first.text.slice(0, 280)) || `<span class="muted">(attachment only)</span>`}
          <footer class="muted small">${esc(date(m.first.t))} · ${esc(m.first.where)}</footer></blockquote>
      </section>` : ""}`;
  };

  // Each badge as progress from the tier you have to the next one.
  const badgesTab = () => badgeRows.length ? `
    <p class="muted">Discord's badges probably only count from about ${BADGE_START} (Discord doesn't say; that's the date that best fits the data). Here's how that compares with everything in your package.</p>
    <div class="badge-list">${badgeRows.map((b) => {
      const fmt = (n: number) => `${count(Math.round(n))}${b.unit === "h" ? " h" : " games"}`;
      const tier = `${b.tier[0].toUpperCase()}${b.tier.slice(1)}`;
      const toward = b.next ? Math.min(100, (b.ours / b.next) * 100) : 100;
      return `<section class="card badge">
        <div class="card-head"><h2>${esc(b.name)}</h2><span class="pill">${esc(tier)}</span></div>
        <div class="lead-value">${esc(fmt(b.ours))}</div>
        <div class="muted small">${esc(b.oursNote)}</div>
        ${b.next ? `<div class="meter" role="img" aria-label="${esc(`${fmt(b.ours)} of ${fmt(b.next)}`)}"><span style="width:${toward}%"></span></div>
          <div class="small">${strong(fmt(Math.max(0, b.next - b.ours)))} to the next tier, at ${esc(fmt(b.next))}</div>` : ""}
        <div class="muted small badge-life">Everything in your package: ${strong(fmt(b.lifetime))}</div>
      </section>`;
    }).join("")}</div>` : `<p class="muted">No profile badges in this package.</p>`;

  const panels: Record<TabId, () => string> = {
    overview, games, streaming, voice: voiceTab, messages: messagesTab, badges: badgesTab,
  };

  const draw = () => {
    const tab = tabFromHash();
    const ranged = TABS.find((t) => t.id === tab)!.ranged;
    results.innerHTML = `
      <div class="results-head">
        <div>
          <p class="eyebrow">Your Discord, unpacked</p>
          <h1>${esc(who)}</h1>
          <p class="muted">${span.last ? `Data from ${strong(date(span.first))} to ${strong(date(span.last))}.` : ""} Nothing left your browser.</p>
        </div>
        <button class="button ghost small" id="again">Open another package</button>
      </div>
      ${data.missing.length ? `<div class="notice"><strong>Some sections weren't in this package.</strong><ul>${
        data.missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}
      <div class="sticky">
        <nav class="tabs" aria-label="Sections">${TABS.map((t) =>
          `<a href="#${t.id}" class="tab"${t.id === tab ? ` aria-current="page"` : ""}>${t.label}</a>`).join("")}</nav>
        ${ranged
          ? `<div class="chips" role="group" aria-label="Time range">${all.map((r, i) =>
              `<button class="chip" data-i="${i}" aria-pressed="${r.label === range.label}">${esc(r.label)}</button>`).join("")}</div>`
          : `<p class="range-note muted">Lifetime totals</p>`}
      </div>
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
