// Keeps the last opened package's parsed results in IndexedDB, so reloading
// /stats/ shows them again without choosing the ZIP. Only this browser can
// read them; "Forget" deletes them.

import type { Apps, PackageData } from "./parse.ts";

export interface Saved {
  version: string;
  data: PackageData;
  apps: Apps;
  savedAt: number;
}

const DB = "unpacked", STORE = "package", KEY = "last";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = op(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

// Storage can be off (private windows, blocked site data) or full, so every
// call fails quietly: the page works the same, just without remembering.
export const savePackage = (s: Saved) => run("readwrite", (st) => st.put(s, KEY)).then(() => true, () => false);
export const forgetPackage = () => run("readwrite", (st) => st.delete(KEY)).catch(() => {});

// `version` changes whenever the parser does; older results are dropped,
// since their shape may not match what the page expects any more.
export async function loadPackage(version: string): Promise<Saved | null> {
  const s = await run<Saved | undefined>("readonly", (st) => st.get(KEY)).catch(() => undefined);
  if (!s) return null;
  if (s.version !== version) {
    await forgetPackage();
    return null;
  }
  return s;
}
