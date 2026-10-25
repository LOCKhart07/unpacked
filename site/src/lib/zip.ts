// Minimal ZIP reader for Blobs: reads the central directory, then streams
// single entries through the native DecompressionStream. Nothing is loaded
// into memory whole, so multi-GB activity files are fine.

export interface ZipEntry {
  name: string;
  method: number; // 0 = stored, 8 = deflate
  compressedSize: number;
  size: number;
  localOffset: number;
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

async function bytes(blob: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

function u64(v: DataView, at: number): number {
  return Number(v.getBigUint64(at, true));
}

export async function readEntries(zip: Blob): Promise<ZipEntry[]> {
  // The end-of-central-directory record is in the last 22 bytes plus an
  // optional comment of up to 64 KB.
  const tailStart = Math.max(0, zip.size - 22 - 0xffff);
  const tail = await bytes(zip, tailStart, zip.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This doesn't look like a ZIP file.");

  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);

  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || tail.getUint32(loc, true) !== ZIP64_LOCATOR) throw new Error("Broken ZIP64 file.");
    const z64At = u64(tail, loc + 8);
    const z64 = await bytes(zip, z64At, z64At + 56);
    if (z64.getUint32(0, true) !== ZIP64_EOCD) throw new Error("Broken ZIP64 file.");
    count = u64(z64, 32);
    cdSize = u64(z64, 40);
    cdOffset = u64(z64, 48);
  }

  const cd = await bytes(zip, cdOffset, cdOffset + cdSize);
  const utf8 = new TextDecoder();
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (cd.getUint32(p, true) !== CENTRAL) break;
    const method = cd.getUint16(p + 10, true);
    let compressedSize = cd.getUint32(p + 20, true);
    let size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let localOffset = cd.getUint32(p + 42, true);
    const name = utf8.decode(new Uint8Array(cd.buffer, p + 46, nameLen));

    // ZIP64 extra field: 64-bit values for whichever fields are 0xffffffff, in this order.
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = cd.getUint16(e, true);
      const len = cd.getUint16(e + 2, true);
      if (id === 0x0001) {
        let f = e + 4;
        if (size === 0xffffffff) { size = u64(cd, f); f += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = u64(cd, f); f += 8; }
        if (localOffset === 0xffffffff) { localOffset = u64(cd, f); }
      }
      e += 4 + len;
    }

    if (!name.endsWith("/")) entries.push({ name, method, compressedSize, size, localOffset });
    p = extraEnd + commentLen;
  }
  return entries;
}

export async function entryStream(zip: Blob, entry: ZipEntry): Promise<ReadableStream<Uint8Array>> {
  const head = await bytes(zip, entry.localOffset, entry.localOffset + 30);
  if (head.getUint32(0, true) !== LOCAL) throw new Error(`Broken ZIP entry: ${entry.name}`);
  const start = entry.localOffset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  const raw = zip.slice(start, start + entry.compressedSize).stream();
  if (entry.method === 0) return raw;
  if (entry.method === 8) return (raw as ReadableStream<BufferSource>).pipeThrough(new DecompressionStream("deflate-raw"));
  throw new Error(`Unsupported compression (method ${entry.method}) in ${entry.name}`);
}

export async function entryText(zip: Blob, entry: ZipEntry): Promise<string> {
  return new Response(await entryStream(zip, entry)).text();
}
