// The shareable image: a 1200×630 card drawn on a canvas, so it never leaves
// the browser unless the viewer copies or saves it. Looks like public/og.png.

export interface CardData {
  name: string | null; // null when the viewer hides it
  range: string; // "Lifetime", "2025", "Last 30 days"...
  period: string; // "2019-03-02 to 2026-10-20"
  stats: [label: string, value: string][]; // up to four
  listTitle: string;
  list: { name: string; value: string; icon: string | null }[]; // up to three
  sample: boolean;
}

export const W = 1200, H = 630;
const SCALE = 2;
const C = {
  bg: "#0f1014", surface: "#181a20", border: "#2a2e38", text: "#e8e9ee",
  muted: "#9a9fae", accent: "#7c6cf0", accent2: "#a597ff",
};

// Icons come from Discord's CDN, which allows cross-origin reads, so drawing
// them doesn't taint the canvas. A failed or slow icon gets a blank square.
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => resolve(null), 5000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = src;
  });
}

function box(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fillStyle = fill;
  g.fill();
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = 1;
    g.stroke();
  }
}

// Shortens text with an ellipsis until it fits in `max` pixels.
function fit(g: CanvasRenderingContext2D, text: string, max: number) {
  if (g.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && g.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

// `current` says whether this draw is still wanted once the icons are in.
export async function drawCard(canvas: HTMLCanvasElement, d: CardData, font: string, current = () => true) {
  const icons = await Promise.all(d.list.map((r) => (r.icon ? loadImage(r.icon) : null)));
  if (!current()) return;
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const g = canvas.getContext("2d")!;
  g.scale(SCALE, SCALE);
  const f = (weight: number, size: number) => `${weight} ${size}px ${font}`;
  g.textBaseline = "alphabetic";

  g.fillStyle = C.bg;
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W, 0, 0, W, 0, 700);
  glow.addColorStop(0, "rgba(124, 108, 240, 0.22)");
  glow.addColorStop(1, "rgba(124, 108, 240, 0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // Brand: the favicon's three bars, then the name.
  const P = 64;
  box(g, P, 52, 40, 40, 10, C.accent);
  g.fillStyle = "#fff";
  // Same bars as public/favicon.svg (a 32-unit box), at 40 px.
  const u = 40 / 32;
  for (const [x, y, h] of [[7, 17, 8], [14, 11, 14], [21, 7, 18]]) {
    g.beginPath();
    g.roundRect(P + x * u, 52 + y * u, 4 * u, h * u, u);
    g.fill();
  }
  g.fillStyle = C.text;
  g.font = f(700, 24);
  g.fillText("Unpacked", P + 54, 81);

  // Range pill, top right.
  g.font = f(600, 18);
  const pill = d.range;
  const pw = g.measureText(pill).width + 36;
  box(g, W - P - pw, 54, pw, 36, 18, C.accent);
  g.fillStyle = "#fff";
  g.fillText(pill, W - P - pw + 18, 78);
  if (d.sample) {
    g.font = f(600, 16);
    const sw = g.measureText("Sample data").width + 28;
    box(g, W - P - pw - sw - 10, 54, sw, 36, 18, "transparent", C.border);
    g.fillStyle = C.muted;
    g.fillText("Sample data", W - P - pw - sw - 10 + 14, 77);
  }

  // Title and period.
  g.fillStyle = C.text;
  g.font = f(700, 48);
  g.fillText(fit(g, d.name ? `${d.name}'s Discord` : "My Discord, unpacked", 640), P, 172);
  g.fillStyle = C.muted;
  g.font = f(400, 20);
  g.fillText(d.period, P, 206);

  // 2×2 stat tiles on the left.
  const gap = 14, tw = 300, th = 132, top = 240;
  d.stats.slice(0, 4).forEach(([label, value], i) => {
    const x = P + (i % 2) * (tw + gap), y = top + Math.floor(i / 2) * (th + gap);
    box(g, x, y, tw, th, 16, C.surface, C.border);
    g.fillStyle = C.muted;
    g.font = f(400, 18);
    g.fillText(fit(g, label, tw - 44), x + 22, y + 40);
    g.fillStyle = C.text;
    g.font = f(700, 44);
    g.fillText(fit(g, value, tw - 44), x + 22, y + 98);
  });

  // Top three on the right.
  const lx = P + 2 * tw + gap + 32, lw = W - P - lx;
  box(g, lx, top, lw, 2 * th + gap, 16, C.surface, C.border);
  g.fillStyle = C.muted;
  g.font = f(400, 18);
  g.fillText(d.listTitle, lx + 22, top + 40);
  if (!d.list.length) {
    g.fillText("Nothing in this range", lx + 22, top + 84);
  }
  d.list.slice(0, 3).forEach((r, i) => {
    const y = top + 62 + i * 70, s = 52;
    const img = icons[i];
    if (img) {
      g.save();
      g.beginPath();
      g.roundRect(lx + 22, y, s, s, 12);
      g.clip();
      g.drawImage(img, lx + 22, y, s, s);
      g.restore();
    } else {
      box(g, lx + 22, y, s, s, 12, "#20232b");
    }
    const tx = lx + 22 + s + 16, tmax = lw - (tx - lx) - 22;
    g.fillStyle = C.text;
    g.font = f(600, 21);
    g.fillText(fit(g, r.name, tmax), tx, y + 22);
    g.fillStyle = C.accent2;
    g.font = f(600, 18);
    g.fillText(r.value, tx, y + 46);
  });

  // Footer: the way back to the site.
  g.fillStyle = C.muted;
  g.font = f(400, 18);
  g.fillText("Made from my Discord data package, in the browser. Make yours at", P, H - 44);
  const lead = g.measureText("Made from my Discord data package, in the browser. Make yours at ").width;
  g.fillStyle = C.accent2;
  g.font = f(600, 18);
  g.fillText("unpacked.lockhart.in", P + lead, H - 44);
}

export const cardBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the image"))), "image/png"));
