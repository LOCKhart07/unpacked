// The /stats/ page: file input, worker, progress, and rendering the results.
// Plain DOM; every value from the package goes through esc().

import { appIcon, type Apps, type PackageData, type Payment } from "./parse.ts";
import {
  BADGE_START, LIFETIME, SCREEN_SHARE, STREAM_ROLE_LABELS, badges, canonName, dataSpan, gameIcon, hours, idsByName, messages, pct, playtime,
  localDate, ranges, setTimeZone, streamNamer, streams, timeZone, voice,
  type MessageStats, type Range, type Series,
} from "./stats.ts";
import { forgetPackage, loadPackage, savePackage } from "./saved.ts";
import { cardBlob, drawCard, type CardData } from "./share-card.ts";
import { wordCloud } from "./wordcloud.ts";
import { allZones, browserZone, makeZone } from "./zone.ts";
import type { WorkerMessage } from "./worker.ts";
// The built worker's URL has a content hash, which changes whenever the parser
// does, so it also says whether saved results came from this parser.
import workerUrl from "./worker.ts?worker&url";

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

const ISSUES = "https://github.com/LOCKhart07/unpacked/issues/new";
let lastPhase = "";
let fileSize = 0;

// A GitHub issue link with the bug report form filled in. Only the error, the
// step and the browser go in: nothing from the package itself.
function reportUrl(error: string) {
  const q = new URLSearchParams({
    template: "bug_report.yml",
    title: `Couldn't read package: ${error.slice(0, 80)}`,
    error,
    step: lastPhase,
    package: `${(fileSize / 1e6).toFixed(fileSize < 1e7 ? 1 : 0)} MB`,
    browser: navigator.userAgent,
  });
  return `${ISSUES}?${q}`;
}

// `error` set means a bug worth reporting, so the box gets a report link.
function fail(message: string, error?: string) {
  worker?.terminate();
  worker = null;
  errorBox.innerHTML = `${esc(message)}${error === undefined ? "" : `
    <br><a href="${esc(reportUrl(error))}" target="_blank" rel="noopener">Report this bug on GitHub</a>
    <span class="muted small">(opens a form with the error and your browser filled in; nothing is sent until you submit it)</span>`}`;
  errorBox.hidden = false;
  show("drop");
}

// Set while showing the made-up sample package, so the page says so.
let demo = false;
// When the results shown are saved in this browser (never for the sample).
let savedAt: number | null = null;

function start(file: File, isDemo = false) {
  errorBox.hidden = true;
  demo = isDemo;
  if (!/\.zip$/i.test(file.name)) {
    fail("Choose the package.zip file Discord emailed you (not an extracted folder).");
    return;
  }
  show("progress");
  lastPhase = "Starting";
  fileSize = file.size;
  phase.textContent = "Starting";
  bar.style.width = "0%";
  percent.textContent = "";
  worker = new Worker(workerUrl, { type: "module" });
  worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const m = e.data;
    if (m.type === "progress") {
      phase.textContent = lastPhase = m.phase;
      const p = m.total ? Math.round((m.done / m.total) * 100) : null;
      bar.style.width = p === null ? "100%" : `${p}%`;
      bar.classList.toggle("indeterminate", p === null);
      percent.textContent = p === null ? "" : `${p}%`;
    } else if (m.type === "error") {
      fail(`Couldn't read this package: ${m.message}`, m.message);
    } else {
      worker?.terminate();
      worker = null;
      savedAt = null;
      render(m.data, m.apps);
      if (!isDemo) {
        const now = Date.now();
        savePackage({ version: workerUrl, data: m.data, apps: m.apps, savedAt: now }).then((ok) => {
          if (!ok) return;
          savedAt = now;
          redraw?.();
        });
      }
    }
  };
  worker.onerror = (e) => fail(`Something went wrong while reading the package: ${e.message}`, e.message);
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
// The sample package is made at build time by scripts/demo-package.ts:
// invented people and messages, real game ids. /stats/?demo opens it directly.
async function startDemo() {
  try {
    const res = await fetch("/demo-package.zip");
    if (!res.ok) throw new Error(String(res.status));
    start(new File([await res.blob()], "demo-package.zip"), true);
  } catch {
    fail("Couldn't load the sample data. Check your connection and try again.");
  }
}
$<HTMLButtonElement>("#demo").addEventListener("click", startDemo);
if (new URLSearchParams(location.search).has("demo")) startDemo();
else {
  // Show the last package opened in this browser, if any.
  loadPackage(workerUrl).then((s) => {
    // Skip if a package was chosen while this was loading.
    if (!s || worker || !results.hidden) return;
    demo = false;
    savedAt = s.savedAt;
    render(s.data, s.apps);
  });
}

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

const date = localDate;

// The zone picked in the picker, kept for next time (only in this browser).
const ZONE_KEY = "unpacked-time-zone";
const validZone = (z: string | null | undefined) => {
  try {
    return z ? (makeZone(z), z) : null;
  } catch {
    return null; // not a zone this browser knows
  }
};
const storedZone = () => {
  try { return localStorage.getItem(ZONE_KEY); } catch { return null; }
};
const storeZone = (z: string | null) => {
  try { z ? localStorage.setItem(ZONE_KEY, z) : localStorage.removeItem(ZONE_KEY); } catch {}
};

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
  { id: "account", label: "Account", ranged: false },
] as const;
type TabId = (typeof TABS)[number]["id"];

// ---- Account tab helpers ----------------------------------------------

// Discord ids encode when they were made: milliseconds since 2015 in the top bits.
const snowflakeTime = (id: string) => Number(BigInt(id) >> 22n) + 1_420_070_400_000;

function age(t: number) {
  const years = (Date.now() - t) / (365.25 * DAY);
  return years >= 1 ? `${Math.floor(years)} ${Math.floor(years) === 1 ? "year" : "years"}`
    : `${Math.max(1, Math.round(years * 12))} months`;
}

const FLAG_LABELS: Record<string, string> = {
  STAFF: "Discord Staff", PARTNER: "Partnered Server Owner", HYPESQUAD: "HypeSquad Events",
  BUG_HUNTER_LEVEL_1: "Bug Hunter", BUG_HUNTER_LEVEL_2: "Gold Bug Hunter",
  HYPESQUAD_ONLINE_HOUSE_1: "HypeSquad Bravery", HYPESQUAD_ONLINE_HOUSE_2: "HypeSquad Brilliance",
  HYPESQUAD_ONLINE_HOUSE_3: "HypeSquad Balance", PREMIUM_EARLY_SUPPORTER: "Early Supporter",
  VERIFIED_DEVELOPER: "Early Verified Bot Developer", CERTIFIED_MODERATOR: "Moderator Programs Alumni",
  ACTIVE_DEVELOPER: "Active Developer",
};
const titleCase = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const flagLabel = (f: string) => FLAG_LABELS[f] ?? titleCase(f);

const CONNECTIONS: Record<string, string> = {
  battlenet: "Battle.net", bluesky: "Bluesky", bungie: "Bungie.net", crunchyroll: "Crunchyroll", domain: "Domain",
  ebay: "eBay", epicgames: "Epic Games", facebook: "Facebook", github: "GitHub", instagram: "Instagram",
  leagueoflegends: "League of Legends", paypal: "PayPal", playstation: "PlayStation", reddit: "Reddit",
  riotgames: "Riot Games", roblox: "Roblox", spotify: "Spotify", steam: "Steam", tiktok: "TikTok",
  twitch: "Twitch", twitter: "X (Twitter)", xbox: "Xbox", youtube: "YouTube",
};
const connectionLabel = (t: string) => CONNECTIONS[t] ?? titleCase(t);

// Amounts are in the currency's smallest unit, which isn't always cents (yen has none).
function money(minor: number, currency: string) {
  try {
    const f = new Intl.NumberFormat("en-US", { style: "currency", currency });
    return f.format(minor / 10 ** (f.resolvedOptions().maximumFractionDigits ?? 2));
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

const PAYMENT_STATUS: Record<number, string> = { 0: "pending", 2: "failed", 3: "reversed", 5: "cancelled" };
const paymentNote = (p: Payment) =>
  p.status === 4 ? (p.amount ? "partly refunded" : "refunded") : PAYMENT_STATUS[p.status] ?? "";

const tabFromHash = (): TabId => TABS.find((t) => `#${t.id}` === location.hash)?.id ?? "overview";

// Set while results are shown, so hash changes (tab links, back / forward) redraw.
let redraw: (() => void) | null = null;
window.addEventListener("hashchange", () => redraw?.());

// ---- Share image -------------------------------------------------------

// Set by render(): the ranges to offer and how to fill the card for one.
let share: { ranges: Range[]; card: (r: Range) => CardData } | null = null;
let shareRange: Range = LIFETIME;
let shareBlob: Promise<Blob> | null = null;
let shareDraws = 0; // icons load async, so only the latest draw may finish
const dialog = $<HTMLDialogElement>("#share");
const canvas = $<HTMLCanvasElement>("#share-canvas");
const showName = $<HTMLInputElement>("#share-name");
const shareStatus = $<HTMLElement>("#share-status");
const copyBtn = $<HTMLButtonElement>("#share-copy");
const nativeBtn = $<HTMLButtonElement>("#share-native");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const shareFile = (b: Blob) => new File([b], `unpacked-${slug(shareRange.label)}.png`, { type: "image/png" });

copyBtn.hidden = !("ClipboardItem" in window && navigator.clipboard?.write);
nativeBtn.hidden = !navigator.canShare?.({ files: [new File([""], "x.png", { type: "image/png" })] });

async function drawShare() {
  if (!share) return;
  const card = share.card(shareRange);
  if (!showName.checked) card.name = null;
  $<HTMLElement>("#share-ranges").innerHTML = share.ranges.map((r, i) =>
    `<button class="chip" data-i="${i}" aria-pressed="${r.label === shareRange.label}">${esc(r.label)}</button>`).join("");
  shareStatus.textContent = "";
  const n = ++shareDraws;
  const done = drawCard(canvas, card, getComputedStyle(document.body).fontFamily, () => n === shareDraws);
  shareBlob = done.then(() => cardBlob(canvas));
  await done;
}

function openShare(r: Range) {
  shareRange = r;
  dialog.showModal();
  drawShare();
}

$<HTMLElement>("#share-ranges").addEventListener("click", (e) => {
  const chip = (e.target as HTMLElement).closest<HTMLButtonElement>(".chip");
  if (!chip || !share) return;
  shareRange = share.ranges[Number(chip.dataset.i)];
  drawShare();
});
showName.addEventListener("change", drawShare);
$<HTMLButtonElement>("#share-close").addEventListener("click", () => dialog.close());
// Clicks on the backdrop land on the dialog itself.
dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

copyBtn.addEventListener("click", async () => {
  try {
    // Safari wants the ClipboardItem made during the click, with a promise.
    await navigator.clipboard.write([new ClipboardItem({ "image/png": shareBlob! })]);
    shareStatus.textContent = "Copied. Paste it into Discord.";
  } catch {
    shareStatus.textContent = "Couldn't copy here. Use Download instead.";
  }
});
$<HTMLButtonElement>("#share-download").addEventListener("click", async () => {
  const url = URL.createObjectURL(shareFile(await shareBlob!));
  Object.assign(document.createElement("a"), { href: url, download: `unpacked-${slug(shareRange.label)}.png` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
nativeBtn.addEventListener("click", async () => {
  try {
    // The link goes in the text: some apps drop `url` when there's a file.
    const files = [shareFile(await shareBlob!)];
    const text = "My Discord, unpacked: https://unpacked.lockhart.in";
    await navigator.share(navigator.canShare({ files, text }) ? { files, text } : { files });
  } catch {
    // Cancelled from the share sheet.
  }
});

function render(data: PackageData, apps: Apps) {
  const { names, icons, aliases } = apps;
  const streamName = streamNamer(apps);
  // The package's own zone: where most of its events were sent from.
  const packageZones = data.timeZones.filter((z) => validZone(z));
  const defaultZone = packageZones[0] ?? browserZone();
  setTimeZone(validZone(storedZone()) ?? defaultZone);
  let all = ranges(data);
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

  // Playtime has no dates, so it's only on the lifetime card; other ranges
  // show watch time and the most streamed games instead.
  const cardFor = (r: Range): CardData => {
    const s = streams(data.streams, r, streamName);
    const v = voice(data.voice, r, data);
    const m = messagesFor(r);
    const lifetime = r === LIFETIME;
    const streamed = s.topApps.filter(([name]) => name !== SCREEN_SHARE).slice(0, 3);
    return {
      name: data.user ? who : null,
      range: r.label,
      period: span.last ? `${date(Math.max(r.from, span.first))} to ${date(Math.min(r.to - 1, span.last))}` : "",
      stats: [
        lifetime ? ["Playing games", hours(play.total)] : ["Watching streams", hours(s.seconds[1])],
        ["In voice", hours(v.total)],
        ["Streaming on Go Live", hours(s.seconds[0])],
        ["Messages sent", count(m.count)],
      ],
      listTitle: lifetime ? "Most played games" : "Most streamed games",
      list: lifetime
        ? play.rows.slice(0, 3).map((g) => ({ name: g.name, value: hours(g.seconds), icon: iconUrl(g.ids) }))
        : streamed.map(([name, sec]) => ({ name, value: hours(sec), icon: iconForName(name) })),
      sample: demo,
    };
  };
  share = { ranges: all, card: cardFor };

  // The package's zones first (the most used is the default), then the rest.
  const zonePicker = () => {
    const current = timeZone();
    const opt = (z: string, note = "") => `<option value="${esc(z)}"${z === current ? " selected" : ""}>${esc(z)}${note}</option>`;
    const mine = packageZones.length ? packageZones : [defaultZone];
    const rest = allZones().filter((z) => !mine.includes(z));
    return `<select id="zone">
      <optgroup label="${packageZones.length ? "From your package" : "Your browser"}">${mine.map((z) =>
        opt(z, z === defaultZone ? " (default)" : "")).join("")}</optgroup>
      <optgroup label="All time zones">${rest.map((z) => opt(z)).join("")}</optgroup>
    </select>`;
  };

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
    const tz = timeZone();
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

  const accountTab = () => {
    const a = data.account;
    if (!a || !data.user) return `<p class="muted">There's no Account folder (user.json) in this package.</p>`;
    const created = snowflakeTime(data.user.id);
    const nitro = a.premiumUntil ? `Nitro until ${strong(date(Date.parse(a.premiumUntil)))}`
      : a.premiumSince ? `Nitro since ${strong(date(Date.parse(a.premiumSince)))}` : "";
    const badgeNames = a.flags.filter((f) => !/^(USED_|HAS_)/.test(f)).map(flagLabel);
    const clients = a.flags.filter((f) => /^USED_.*_CLIENT$/.test(f)).map((f) => f.slice(5, -7).toLowerCase());

    // Servers you're in (the Messages and Voice tabs rank them by activity).
    const servers = Object.values(data.serverNames);
    const active = new Set(data.channels.filter((c) => c.kind === "server" && c.server).map((c) => c.server));

    const paid = a.payments.filter((p) => p.status === 1 || p.status === 4);
    const spent = new Map<string, number>();
    for (const p of paid) spent.set(p.currency, (spent.get(p.currency) ?? 0) + p.amount);

    return `
      <section class="card profile">
        ${a.avatar ? `<img class="avatar" src="${esc(a.avatar)}" alt="" width="88" height="88">`
          : `<span class="avatar">${esc(who.slice(0, 1).toUpperCase())}</span>`}
        <div>
          <h2>${esc(who)}</h2>
          <p class="muted">@${esc(data.user.username)}${a.legacyUsername ? ` · was ${esc(a.legacyUsername)}` : ""}</p>
          <p>Account made ${strong(date(created))}, ${esc(age(created))} ago${nitro ? ` · ${nitro}` : ""}${
            a.boostingSince ? ` · boosting since ${strong(date(Date.parse(a.boostingSince)))}` : ""}</p>
          ${badgeNames.length ? `<div class="pills">${badgeNames.map((b) => `<span class="pill">${esc(b)}</span>`).join("")}</div>` : ""}
        </div>
      </section>
      <div class="tiles">
        ${tile("Friends", count(a.friends), [a.pending && `${count(a.pending)} pending`, a.blocked && `${count(a.blocked)} blocked`].filter(Boolean).join(", "))}
        ${tile("Servers", count(servers.length), `messages in ${count(servers.filter((n) => active.has(n)).length)} of them`)}
        ${tile("Connected accounts", count(a.connections.length))}
        ${tile("Signed-in devices", count(a.devices.length), clients.length ? `has used ${clients.join(", ")}` : "")}
      </div>
      <section class="card">
        <div class="split">
          <div>
            <h3>Connected accounts</h3>
            ${a.connections.length ? `<table class="plain">${a.connections.map((c) =>
              `<tr><td>${esc(connectionLabel(c.type))}</td><td class="muted">${esc(c.name)}</td></tr>`).join("")}</table>`
              : `<p class="muted">None.</p>`}
            ${a.apps.length ? `<h3>Apps and bots you made</h3><p>${a.apps.map(esc).join(", ")}</p>` : ""}
          </div>
          <div>
            <h3>Signed-in devices</h3>
            ${a.devices.length ? `<table class="plain"><tr class="muted"><td></td><td class="num">Last used</td></tr>${a.devices.map((d) =>
              `<tr><td>${esc(d.platform.includes(d.os) ? d.platform : [d.platform, d.os].filter(Boolean).join(" on "))}</td><td class="num">${
                Number.isFinite(d.lastUsed) ? esc(date(d.lastUsed)) : "–"}</td></tr>`).join("")}</table>
              <p class="muted small">IP addresses are in the package too, but this page doesn't show them.</p>`
              : `<p class="muted">None listed.</p>`}
          </div>
        </div>
      </section>
      <section class="card money">
        <h3>Money spent on Discord</h3>
        ${spent.size ? `<div class="lead-value">${[...spent].map(([c, n]) => esc(money(n, c))).join(" + ")}</div>
          <p class="muted small">Completed payments, minus refunds.</p>` : `<p class="muted">Nothing.</p>`}
        ${a.payments.length ? `<table class="plain">${a.payments.map((p) => `<tr>
          <td>${esc(date(p.t))}</td><td>${esc(p.what || "Payment")}${paymentNote(p) ? ` <span class="muted small">${esc(paymentNote(p))}</span>` : ""}</td>
          <td class="num${p.status === 1 || p.status === 4 ? "" : " muted"}">${esc(money(p.amount, p.currency))}</td></tr>`).join("")}</table>` : ""}
      </section>`;
  };

  const panels: Record<TabId, () => string> = {
    overview, games, streaming, voice: voiceTab, messages: messagesTab, badges: badgesTab, account: accountTab,
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
          <p class="muted small zone-line"><label>Dates and times in ${zonePicker()}</label></p>
          ${savedAt ? `<p class="muted small saved">Saved in this browser on ${esc(date(savedAt))}, so it's here when you come back.
            <button class="link" id="forget">Forget it</button></p>` : ""}
        </div>
        <div class="head-actions">
          <button class="button small" id="share-open">Share image</button>
          <button class="button ghost small" id="again">Open another package</button>
        </div>
      </div>
      ${demo ? `<div class="notice demo">This is <strong>made-up sample data</strong>, so you can see what Unpacked shows.
        <a href="/stats/">Open your own package</a></div>` : ""}
      ${data.missing.length ? `<div class="notice"><strong>Some sections weren't in this package.</strong><ul>${
        data.missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}
      <div class="sticky">
        <nav class="tabs" aria-label="Sections">${TABS.map((t) =>
          `<a href="#${t.id}" class="tab"${t.id === tab ? ` aria-current="page"` : ""}>${t.label}</a>`).join("")}</nav>
        ${ranged
          ? `<div class="chips" role="group" aria-label="Time range">${all.map((r, i) =>
              `<button class="chip" data-i="${i}" aria-pressed="${r.label === range.label}">${esc(r.label)}</button>`).join("")}</div>`
          : `<p class="range-note muted">${tab === "account" ? "From your account settings" : "Lifetime totals"}</p>`}
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
    $<HTMLSelectElement>("#zone").addEventListener("change", (e) => {
      const z = (e.target as HTMLSelectElement).value;
      storeZone(z === defaultZone ? null : z);
      setTimeZone(z);
      // Year ranges and every per-day count move with the zone.
      all = ranges(data);
      range = all.find((r) => r.label === range.label) ?? LIFETIME;
      messageCache.clear();
      share = { ranges: all, card: cardFor };
      draw();
    });
    // The card starts on the range the viewer is looking at.
    $<HTMLButtonElement>("#share-open").addEventListener("click", () => openShare(ranged ? range : LIFETIME));
    document.querySelector("#forget")?.addEventListener("click", async () => {
      await forgetPackage();
      savedAt = null;
      redraw = null;
      share = null;
      input.value = "";
      show("drop");
    });
    $<HTMLButtonElement>("#again").addEventListener("click", () => {
      redraw = null;
      share = null;
      input.value = "";
      show("drop");
    });
  };

  redraw = draw;
  draw();
  show("results");
  window.scrollTo({ top: 0 });
}
