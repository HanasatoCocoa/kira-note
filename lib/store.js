/**
 * Kira Note — the file-backed store.
 *
 * Layout (all plain files, no database):
 *   ~/.kira-note/
 *     user/entries/<id>.md          user/INDEX.md
 *     projects/<project-id>/entries/<id>.md   projects/<project-id>/INDEX.md
 *     projects.json                 id -> { path, name, gitRemote?, created }
 *     events.jsonl                  append-only entry history
 *     injection-journal.jsonl       one row per changed injection snapshot
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  compareEntries,
  isEligible,
  makeId,
  nowIso,
  parseFrontmatter,
  projectIdFor,
  renderEntry,
  renderIndex,
} from './format.js';

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export class KiraStore {
  /**
   * @param {{ home?: string, clock?: () => number }} options
   */
  constructor(options = {}) {
    this.home = path.resolve(options.home ?? path.join(os.homedir(), '.kira-note'));
    this.clock = options.clock ?? Date.now;
    this.queue = Promise.resolve();
    this.ready = null;
    // Files that failed to parse, so the panel can say "N rows skipped" instead
    // of silently showing a smaller library.
    this.corrupt = new Map();
  }

  /** Rows skipped by the last scan of each scope. */
  corruptEntries() {
    return [...this.corrupt.values()].flat();
  }

  get userDir() {
    return path.join(this.home, 'user');
  }

  get projectsDir() {
    return path.join(this.home, 'projects');
  }

  get projectsFile() {
    return path.join(this.home, 'projects.json');
  }

  get eventsFile() {
    return path.join(this.home, 'events.jsonl');
  }

  get journalFile() {
    return path.join(this.home, 'injection-journal.jsonl');
  }

  scopeDir(scope) {
    if (scope === 'user') return this.userDir;
    if (typeof scope === 'string' && scope.startsWith('project:')) {
      return path.join(this.projectsDir, scope.slice('project:'.length));
    }
    throw new Error(`kira-note: unknown scope ${String(scope)}`);
  }

  entriesDir(scope) {
    return path.join(this.scopeDir(scope), 'entries');
  }

  indexFile(scope) {
    return path.join(this.scopeDir(scope), 'INDEX.md');
  }

  async init() {
    this.ready ??= (async () => {
      await fs.mkdir(path.join(this.userDir, 'entries'), { recursive: true });
      await fs.mkdir(this.projectsDir, { recursive: true });
      if (!(await exists(this.projectsFile))) await this.writeProjects({});
    })();
    return this.ready;
  }

  /** Serialize mutations so two tool calls never interleave a read-modify-write. */
  run(operation) {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async writeAtomic(file, text) {
    const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(temporary, text, 'utf8');
    await fs.rename(temporary, file);
  }

  async readProjects() {
    return readJson(this.projectsFile, {});
  }

  async writeProjects(projects) {
    await this.writeAtomic(this.projectsFile, `${JSON.stringify(projects, null, 2)}\n`);
  }

  /** Resolve the project scope for a working directory, registering it on first use. */
  async resolveProject(cwd) {
    const start = path.resolve(cwd || process.cwd());
    const root = await this.gitRoot(start);
    const id = projectIdFor(root);
    const projects = await this.readProjects();
    if (projects[id] === undefined) {
      projects[id] = {
        path: root,
        name: path.basename(root) || root,
        created: nowIso(),
      };
      await this.writeProjects(projects);
      await fs.mkdir(path.join(this.projectsDir, id, 'entries'), { recursive: true });
    }
    return { id, scope: `project:${id}`, path: root, name: projects[id].name };
  }

  async gitRoot(start) {
    let current = start;
    for (;;) {
      if (await exists(path.join(current, '.git'))) return current;
      const parent = path.dirname(current);
      if (parent === current) return start;
      current = parent;
    }
  }

  async listScopes() {
    const projects = await this.readProjects();
    const scopes = [{ key: 'user', name: '个人记忆', path: null, kind: 'user' }];
    for (const [id, info] of Object.entries(projects)) {
      scopes.push({ key: `project:${id}`, id, name: info.name, path: info.path, kind: 'project' });
    }
    return scopes;
  }

  async listEntries(scope) {
    const dir = this.entriesDir(scope);
    const corrupt = [];
    this.corrupt.set(scope, corrupt);
    let names;
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const entries = [];
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      try {
        const text = await fs.readFile(path.join(dir, name), 'utf8');
        const { data, body } = parseFrontmatter(text);
        entries.push({ ...data, body });
      } catch (error) {
        // A hand-edited broken file must not break the whole library, but it
        // must not disappear silently either.
        corrupt.push({ scope, file: path.join(dir, name), reason: error?.message ?? String(error) });
      }
    }
    entries.sort((left, right) => (left.created < right.created ? -1 : 1));
    return entries;
  }

  async listAllEntries() {
    const scopes = await this.listScopes();
    const rows = [];
    for (const scope of scopes) {
      for (const entry of await this.listEntries(scope.key)) rows.push({ entry, scope });
    }
    return rows;
  }

  async findEntry(id) {
    for (const scope of await this.listScopes()) {
      const entry = (await this.listEntries(scope.key)).find((candidate) => candidate.id === id);
      if (entry !== undefined) return { entry, scope: scope.key, scopeInfo: scope };
    }
    return null;
  }

  entryFile(entry) {
    return path.join(this.entriesDir(entry.scope), `${entry.id}.md`);
  }

  async writeEntry(entry) {
    await fs.mkdir(this.entriesDir(entry.scope), { recursive: true });
    await this.writeAtomic(this.entryFile(entry), renderEntry(entry));
  }

  async removeEntry(entry) {
    await fs.rm(this.entryFile(entry), { force: true });
  }

  async rebuildIndex(scope, title) {
    const entries = await this.listEntries(scope);
    const now = this.clock();
    const eligible = entries.filter((entry) => isEligible(entry, now)).sort(compareEntries);
    await fs.mkdir(this.scopeDir(scope), { recursive: true });
    await this.writeAtomic(this.indexFile(scope), renderIndex(title, eligible));
    return eligible.length;
  }

  async appendEvent(event) {
    const row = { ts: nowIso(), ...event };
    await fs.appendFile(this.eventsFile, `${JSON.stringify(row)}\n`, 'utf8');
    return row;
  }

  async readEvents(entryId) {
    let text;
    try {
      text = await fs.readFile(this.eventsFile, 'utf8');
    } catch {
      return [];
    }
    const rows = [];
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      try {
        const row = JSON.parse(line);
        if (entryId === undefined || row.entry_id === entryId) rows.push(row);
      } catch {
        // ignore a torn line
      }
    }
    return rows;
  }

  async appendJournal(row) {
    await fs.appendFile(this.journalFile, `${JSON.stringify({ ts: nowIso(), ...row })}\n`, 'utf8');
  }

  async readJournal(limit = 50) {
    let text;
    try {
      text = await fs.readFile(this.journalFile, 'utf8');
    } catch {
      return [];
    }
    const rows = [];
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        // ignore a torn line
      }
    }
    return rows.slice(-Math.max(1, limit));
  }

  async countEntries(scope) {
    return (await this.listEntries(scope)).length;
  }

  nextId() {
    return makeId(this.clock());
  }
}
