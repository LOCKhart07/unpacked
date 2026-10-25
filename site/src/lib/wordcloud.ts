// A word cloud as an SVG string: bigger words for more uses, packed along a
// spiral from the centre. Text is measured on a canvas, so this runs in the
// page (not the worker or Node).

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

interface Box { x: number; y: number; w: number; h: number } // centre, size

const overlaps = (a: Box, b: Box) =>
  Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;

// `stretch` is how much wider than tall the cloud grows: lower for narrow screens.
export function wordCloud(words: [string, number][], font: string, stretch = 1.7): string {
  if (!words.length) return "";
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return "";
  const max = words[0][1];
  const min = words[words.length - 1][1];
  const PAD = 3;
  const placed: (Box & { word: string; n: number; size: number; up: boolean; base: number })[] = [];

  words.forEach(([word, n], i) => {
    // Square-root scale, so the top word doesn't dwarf everything else.
    const size = Math.round(14 + 50 * Math.sqrt((n - min) / (max - min || 1)));
    ctx.font = `700 ${size}px ${font}`;
    const m = ctx.measureText(word);
    const asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
    // Every fourth word (never the biggest) runs vertically.
    const up = i > 0 && i % 4 === 2;
    const w = m.width + PAD * 2, h = asc + desc + PAD * 2;
    const box: Box = { x: 0, y: 0, w: up ? h : w, h: up ? w : h };
    for (let t = 0; t < 600; t += 0.08) {
      box.x = stretch * 4 * t * Math.cos(t + i);
      box.y = 4 * t * Math.sin(t + i);
      if (!placed.some((p) => overlaps(p, box))) {
        // `base` moves the text's baseline so its inked box is centred on (x, y).
        placed.push({ ...box, word, n, size, up, base: (asc - desc) / 2 });
        return;
      }
    }
  });

  const left = Math.min(...placed.map((p) => p.x - p.w / 2));
  const right = Math.max(...placed.map((p) => p.x + p.w / 2));
  const top = Math.min(...placed.map((p) => p.y - p.h / 2));
  const bottom = Math.max(...placed.map((p) => p.y + p.h / 2));
  const r = (v: number) => v.toFixed(1);
  return `<svg class="wordcloud" viewBox="${r(left)} ${r(top)} ${r(right - left)} ${r(bottom - top)}" role="img"
    aria-label="Word cloud of your most used words">${placed.map((p, i) =>
      `<text class="wc-${i % 5}" x="${r(p.x)}" y="${r(p.y + p.base)}" font-size="${p.size}" text-anchor="middle"${
        p.up ? ` transform="rotate(-90 ${r(p.x)} ${r(p.y)})"` : ""}><title>${esc(p.word)}: ${p.n.toLocaleString("en-US")}</title>${esc(p.word)}</text>`).join("")}</svg>`;
}
