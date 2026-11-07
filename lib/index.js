/**
 * Kira Note — Host entry.
 *
 * Three surfaces share one on-disk library:
 *   1. the resident prompt context (`kira-note` system-prompt block),
 *   2. the four Agent tools (`kira_recall` / `kira_raw` / `kira_write` / `kira_status`),
 *   3. the Remote service behind the sidebar panel.
 *
 * Memory lives in plain Markdown under `~/.kira-note/`; nothing here needs a
 * database, a network call, or a background timer.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { InjectionSource } from './injection.js';
import { KiraRemoteService } from './service.js';
import { KiraStore } from './store.js';
import { createKiraTools } from './tools.js';

export const name = 'kira-note';
export const inject = ['tools', 'systemPrompt', 'workingDirectory'];

/** Where the library lives; `KIRA_NOTE_HOME` keeps tests and power users off the default. */
export function homeDirectory() {
  const override = process.env.KIRA_NOTE_HOME;
  return override !== undefined && override.trim() !== '' ? override : path.join(os.homedir(), '.kira-note');
}

/**
 * A mount-time failure in one surface must not take the others down, and a plugin
 * cannot rely on the Desktop shell surfacing `ctx.logger` anywhere visible: append
 * the failure beside the library instead.
 */
function report(home, surface, error) {
  const line = `${new Date().toISOString()} ${surface}: ${error?.stack ?? String(error)}\n`;
  try {
    fs.mkdirSync(home, { recursive: true });
    fs.appendFileSync(path.join(home, 'boot-errors.log'), line, 'utf8');
  } catch {
    // Diagnostics are best effort only.
  }
}

export function apply(ctx, config = {}) {
  const home = config.home ?? homeDirectory();
  const store = new KiraStore({ home });
  const injection = new InjectionSource({ home });

  const sessionOf = (agent) => agent?.session ?? null;
  const cwdOf = (session) => {
    try {
      const cwd = ctx.workingDirectory.get(session);
      return typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd();
    } catch {
      return process.cwd();
    }
  };

  void store.init().catch((error) => {
    ctx.logger?.warn?.(`kira-note: cannot prepare ${home}: ${String(error)}`);
  });

  ctx.effect(() =>
    ctx.systemPrompt.context({
      name: 'kira-note',
      order: 1000,
      required: true,
      interpolate: false,
      text: (context) => {
        const session = sessionOf(context?.agent);
        const cwd = session === null ? process.cwd() : cwdOf(session);
        try {
          return injection.text({ session: session?.id ?? null, cwd });
        } catch (error) {
          ctx.logger?.warn?.(`kira-note: injection failed: ${String(error)}`);
          return '<kira-note-memory>\n（Kira Note 记忆库暂时不可读，用 kira_recall 再试一次。）\n</kira-note-memory>';
        }
      },
    }),
  );

  ctx.inject(['tools'], (toolCtx) => {
    try {
      const definitions = createKiraTools({
        store,
        cwdOf: (exec) => cwdOf(sessionOf(exec?.agent)),
        scopeFor: (cwd) => store.resolveProject(cwd),
      });
      for (const definition of definitions) {
        toolCtx.effect(() => toolCtx.tools.register(definition));
      }
    } catch (error) {
      report(home, 'tools', error);
    }
  });

  try {
    return new KiraRemoteService(ctx, store);
  } catch (error) {
    report(home, 'service', error);
    return undefined;
  }
}
