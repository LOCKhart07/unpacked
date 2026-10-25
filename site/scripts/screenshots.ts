// Screenshots of the stats page for the README, using the made-up demo
// package (never a real one). Drives headless Chrome over its debugging
// protocol, so it needs no packages, only Chrome.
//
//   node scripts/demo-package.ts ../data/demo-package.zip
//   npm run build && npm run preview            # in another terminal
//   node scripts/screenshots.ts ../data/demo-package.zip ../docs/screenshots
//
// CHROME and SITE override the Chrome path and the site URL.
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [zip, outDir] = process.argv.slice(2).map((p) => resolve(p));
const SITE = process.env.SITE ?? "http://127.0.0.1:4321";
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(outDir, { recursive: true });
const PORT = 9333;
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(tmpdir(), "unpacked-shots")}`,
  "--force-color-profile=srgb", "--hide-scrollbars", "about:blank",
], { stdio: "ignore" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The CDP replies are untyped JSON.
type Json = any;
let target: Json;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(300);
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t: Json) => t.type === "page"); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map<number, (m: Json) => void>();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
});
const send = (method: string, params: object = {}): Promise<Json> => new Promise((resolve, reject) => {
  const i = ++id;
  pending.set(i, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evaluate = async (expr: string) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

const W = 1200, SCALE = 2;
await send("Emulation.setDeviceMetricsOverride", { width: W, height: 900, deviceScaleFactor: SCALE, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
await send("Page.enable");
await send("DOM.enable");
await send("Page.navigate", { url: `${SITE}/stats/` });
await sleep(2500);
const { root } = await send("DOM.getDocument");
const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: "#file" });
await send("DOM.setFileInputFiles", { nodeId, files: [zip] });
for (let i = 0; i < 120; i++) {
  if (await evaluate(`!document.querySelector("#results").hidden`)) break;
  await sleep(500);
}

// Wait for every image to finish (or fail) loading.
const settle = async () => {
  await evaluate(`Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })))`);
  await sleep(600);
};

// Shoot from the top of `from` (a selector) down to the bottom of `to`.
async function shot(name: string, hash: string, from: string, to: string, pad = 24) {
  await evaluate(`location.hash = ${JSON.stringify(hash)}`);
  await sleep(800);
  await settle();
  const box = await evaluate(`(() => {
    const a = document.querySelector(${JSON.stringify(from)}).getBoundingClientRect();
    const b = document.querySelector(${JSON.stringify(to)}).getBoundingClientRect();
    return { y: a.top + scrollY, h: b.bottom - a.top };
  })()`);
  const { data } = await send("Page.captureScreenshot", {
    format: "png", captureBeyondViewport: true,
    clip: { x: 0, y: Math.max(0, box.y - pad), width: W, height: box.h + pad * 2, scale: 1 },
  });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, "base64"));
  console.log("wrote", name);
}

await shot("overview", "#overview", ".site-header", ".panel");
await shot("streaming", "#streaming", ".results-head", ".panel > section:nth-of-type(1)");
await shot("messages", "#messages", ".panel > section:nth-of-type(3)", ".panel > section:nth-of-type(4)");
await shot("badges", "#badges", ".tabs", ".panel");

ws.close();
chrome.kill();
