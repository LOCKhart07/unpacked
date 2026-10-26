// Wall-clock time in one IANA timezone. local(t) shifts an epoch time by the
// zone's UTC offset, so the getUTC* methods and toISOString() of the result
// read as local time. Offsets are looked up once per 15 minutes of data:
// clocks change on a quarter hour in UTC, never in between (Adelaide's is at :30).

export interface Zone {
  name: string;
  local: (t: number) => number;
  // Epoch ms of a local midnight; month is 0-based, like Date.UTC.
  fromLocal: (year: number, month: number, day?: number) => number;
}

const BLOCK = 15 * 60_000;

export function makeZone(name: string): Zone {
  if (name === "UTC") return { name, local: (t) => t, fromLocal: (y, m, d = 1) => Date.UTC(y, m, d) };
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: name, hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  });
  const offsets = new Map<number, number>();
  const offset = (t: number) => {
    const b = Math.floor(t / BLOCK);
    let o = offsets.get(b);
    if (o === undefined) {
      const at = b * BLOCK;
      const p: Record<string, number> = {};
      for (const { type, value } of fmt.formatToParts(at)) p[type] = Number(value);
      o = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at;
      offsets.set(b, o);
    }
    return o;
  };
  return {
    name,
    local: (t) => t + offset(t),
    fromLocal: (y, m, d = 1) => {
      const guess = Date.UTC(y, m, d);
      // Twice, in case the offset changes between the guess and the answer (DST).
      const t = guess - offset(guess);
      return guess - offset(t);
    },
  };
}

export const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// Every zone the browser knows, for the picker. Old browsers only get UTC.
export const allZones = (): string[] =>
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
