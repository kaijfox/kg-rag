/**
 * Keeps an index current while a server runs: when a file under a registered source changes, the sources are read again
 * after a short quiet period. A change that arrives during a run is not lost; it starts another run when the first ends.
 * The first run happens at once, so changes made while the server was down are picked up.
 */
import { existsSync, statSync, watch, type FSWatcher } from 'node:fs';
import { dirname, isAbsolute, join, basename } from 'node:path';
import type { Kg } from '@kg/kernel';

export interface Watcher {
  close(): void;
  /** resolves when no run is pending or in progress (used by tests) */
  idle(): Promise<void>;
}

export function watchSources(kg: Kg, run: () => Promise<void>, o: { debounceMs?: number; log?: (line: string) => void } = {}): Watcher {
  const debounce = o.debounceMs ?? 1500;
  const log = o.log ?? (() => undefined);
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | null = null;
  let dirty = false;
  const trigger = (): void => {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(go, debounce);
  };
  const go = (): void => {
    if (running) return;
    dirty = false;
    running = run()
      .catch((e) => log(`re-ingest failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        running = null;
        if (dirty) trigger();
      });
  };
  const watchers: FSWatcher[] = [];
  for (const s of kg.config.sources) {
    const abs = isAbsolute(s.path) ? s.path : join(kg.dir, s.path);
    if (!existsSync(abs)) continue;
    const isDir = statSync(abs).isDirectory();
    // an editor often replaces a file instead of writing it, which ends a watch on the file itself: watch its folder
    const target = isDir ? abs : dirname(abs);
    const only = isDir ? null : basename(abs);
    try {
      watchers.push(watch(target, { recursive: isDir }, (_event, name) => {
        const file = name ? String(name) : '';
        if (only !== null && file !== only) return;
        if (file.split(/[\\/]/).some((p) => p.startsWith('.'))) return;
        trigger();
      }));
    } catch (e) {
      log(`cannot watch ${abs}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  go();
  return {
    close() {
      clearTimeout(timer);
      watchers.forEach((w) => w.close());
    },
    async idle() {
      for (;;) {
        if (running) await running;
        else if (timer && dirty) await new Promise((r) => setTimeout(r, debounce + 20));
        else return;
      }
    },
  };
}
