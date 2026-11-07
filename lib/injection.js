/**
 * Kira Note — the resident prompt-context provider.
 *
 * The Host calls `text(context)` synchronously, and it must return the same
 * complete string on every turn while the content is unchanged (returning an
 * empty string would make the Host append a second snapshot each turn).
 */
import { assembleInjection } from './core.js';
import { isEligible } from './format.js';
import { KiraSyncStore } from './sync.js';

export class InjectionSource {
  constructor(options = {}) {
    this.sync = new KiraSyncStore(options);
    this.hashes = new Map();
  }

  /**
   * @param {{ session?: string | null, cwd?: string | null }} context
   * @returns {string} the full snapshot text, never empty
   */
  text(context = {}) {
    const session = context.session ?? null;
    const project = this.sync.resolveProject(context.cwd ?? process.cwd());
    const now = this.sync.clock();
    const userAll = this.sync.entries('user');
    const projectAll = this.sync.entries(project.scope);

    let otherWorkspace = 0;
    for (const scope of this.sync.scopes()) {
      if (scope.key === 'user' || scope.key === project.scope) continue;
      otherWorkspace += this.sync.entries(scope.key).filter((entry) => isEligible(entry, now)).length;
    }

    const snapshot = assembleInjection({
      userAll,
      projectAll,
      otherWorkspace,
      project,
      session,
      now,
    });

    const key = `${session ?? ''}|${project.scope}`;
    const previous = this.hashes.has(key) ? this.hashes.get(key) : this.sync.lastJournalHash(session);
    if (previous !== snapshot.hash) {
      this.sync.appendJournal({
        session,
        project: project.id,
        bytes: snapshot.bytes,
        ids: snapshot.ids,
        hash: snapshot.hash,
      });
    }
    this.hashes.set(key, snapshot.hash);
    return snapshot.text;
  }
}
