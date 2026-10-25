// Parses the dropped package off the main thread so the page stays responsive.

import { parsePackage, resolveApps, type Apps, type PackageData, type Progress } from "./parse.ts";

export type WorkerMessage =
  | ({ type: "progress" } & Progress)
  | { type: "done"; data: PackageData; apps: Apps }
  | { type: "error"; message: string };

const post = (m: WorkerMessage) => self.postMessage(m);

self.onmessage = async (e: MessageEvent<File>) => {
  try {
    const data = await parsePackage(e.data, (p) => post({ type: "progress", ...p }));
    post({ type: "progress", phase: "Looking up game names", done: 0, total: 0 });
    // Streams name their game by app id, or failing that by executable.
    const streamIds = data.streams.map((s) => s.appId).filter((id): id is string => !!id);
    const exes = [...new Set(data.streams.filter((s) => !s.appId && s.exe).map((s) => s.exe!))];
    const apps = data.games.length || data.streams.length
      ? await resolveApps([...new Set([...data.games.map((g) => g.id), ...streamIds])], data.libraryNames, exes)
      : { names: {}, icons: {}, aliases: [], exeIds: {} };
    post({ type: "done", data, apps });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
