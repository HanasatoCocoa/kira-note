/**
 * Kira Note — synchronous reader used by the prompt-context provider.
 *
 * The Host renders context contributions synchronously (the text function must
 * return a string, not a promise), so the injection path reads the library with
 * `node:fs` sync calls. Writes still travel the async store.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseFrontmatter, projectIdFor } from './format.js';

export class KiraSyncStore {
  constructor({ home, clock } = {}) {
    this.home = path.resolve(home ?? path.join(os.homedir(), '.kira-note'));
    this.clock = clock ?? Date.now;
  }

  get projectsFile() {
    return path.join(this.home, 'projects.json');
  }

  get journalFile() {
    return path.join(this.home, 'injection-journal.jsonl');
  }

  scopeDir(scope) {
    if (scope === 'user') return path.join(this.home, 'user');
    return path.join(this.home, 'projects', scope.slice('project:'.length));
  }

  projects() {
    try {
      return JSON.parse(fs.readFileSync(this.projectsFile, 'utf8'));
    } catch {
      return {};
    }
  }

  entries(scope) {
    const dir = path.join(this.scopeDir(scope), 'entries');
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const entries = [];
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      try {
        const { data, body } = parseFrontmatter(fs.readFileSync(path.join(dir, name), 'utf8'));
        entries.push({ ...data, body });
      } catch {
        // Skip an unreadable entry rather than break the turn.
      }
    }
    return entries;
  }

  /** Same project identity rule as the async store; pure read, no directory or registry writes. */
  resolveProject(cwd) {
    const start = path.resolve(cwd || process.cwd());
    const root = this.gitRoot(start);
    const id = projectIdFor(root);
    const info = this.projects()[id];
    return {
      id,
      scope: `project:${id}`,
      path: root,
      name: info?.name ?? (path.basename(root) || root),
      registered: info !== undefined,
    };
  }

  gitRoot(start) {
    let current = start;
    for (;;) {
      try {
        if (fs.statSync(path.join(current, '.git'))) return current;
      } catch {
        // keep walking up
      }
      const parent = path.dirname(current);
      if (parent === current) return start;
      current = parent;
    }
  }

  scopes() {
    const rows = [{ key: 'user', name: '个人记忆' }];
    for (const [id, info] of Object.entries(this.projects())) {
      rows.push({ key: `project:${id}`, name: info.name, path: info.path });
    }
    return rows;
  }

  appendJournal(row) {
    try {
      fs.mkdirSync(this.home, { recursive: true });
      const stamped = { ts: new Date(this.clock()).toISOString(), ...row };
      fs.appendFileSync(this.journalFile, `${JSON.stringify(stamped)}\n`, 'utf8');
      return stamped;
    } catch {
      // Journaling is diagnostic; never fail a turn because of it.
      return null;
    }
  }

  readJournal(limit = 50) {
    let text;
    try {
      text = fs.readFileSync(this.journalFile, 'utf8');
    } catch {
      return [];
    }
    const rows = [];
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        // skip a torn line
      }
    }
    return rows.slice(-Math.max(1, limit));
  }

  /** C8: only the last row decides whether the snapshot changed. */
  lastJournalHash(session) {
    let text;
    try {
      text = fs.readFileSync(this.journalFile, 'utf8');
    } catch {
      return null;
    }
    const lines = text.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) return null;
    try {
      const row = JSON.parse(lines[lines.length - 1]);
      return typeof row.hash === 'string' && (row.session ?? null) === (session ?? null) ? row.hash : null;
    } catch {
      return null;
    }
  }
}
