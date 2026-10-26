// Reads one activity events file for parse.ts, so a package's several events
// files are read at the same time. Started by readInWorkers in parse.ts.

import { scanEvents, type Ev, type EventsWorkerMessage } from "./parse.ts";
import type { ZipEntry } from "./zip.ts";

const post = (m: EventsWorkerMessage) => self.postMessage(m);

self.onmessage = async (e: MessageEvent<{ zip: Blob; file: ZipEntry }>) => {
  try {
    const list: Ev[] = [];
    await scanEvents(e.data.zip, e.data.file, (ev) => list.push(ev), (n) => post({ type: "bytes", n }),
      (id) => post({ type: "app", id }));
    post({ type: "done", list });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
