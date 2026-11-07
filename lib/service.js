/**
 * Kira Note — the Host half of the Web panel's data channel.
 *
 * The panel is a browser plugin, so every library operation the panel needs
 * crosses one generated Typert Remote method. Each method takes a single JSON
 * request object and answers one JSON string; a failure is still a value
 * (`{ok:false,...}`), never a rejected Remote call, so the panel can show the
 * exact reason instead of a transport error.
 */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';

import { KiraError, detail, injectionLog, move, snapshot, status, update, write } from './core.js';

export const SERVICE_KEY = 'kiraNote';

/** One Remote marker, applied without a TypeScript decorator transform. */
function markRemote(prototype, method, exportName) {
  const decorator = Remote(exportName);
  let initializer;
  decorator(prototype[method], {
    kind: 'method',
    name: method,
    static: false,
    private: false,
    addInitializer(callback) {
      initializer = callback;
    },
  });
  initializer.call(Object.create(prototype));
}

export class KiraRemoteService extends TypertRemoteService {
  constructor(ctx, store) {
    super(ctx, SERVICE_KEY);
    this.store = store;
  }

  remoteSnapshot(request = {}) {
    return this.answer(() => snapshot(this.store));
  }

  remoteDetail(request = {}) {
    return this.answer(() => detail(this.store, request.id));
  }

  remoteWrite(request = {}) {
    return this.answer(async () => {
      const result = await write(this.store, {
        title: request.title,
        summary: request.summary,
        body: request.body,
        type: request.type,
        triggers: request.triggers,
        valid_until: request.valid_until,
        scope: request.scope,
        cwd: request.cwd,
        session: request.session ?? null,
        actor: request.actor ?? 'user',
      });
      // A human typed this in the panel, so it is already reviewed: otherwise the
      // new entry would immediately appear in its own review queue.
      const reviewed = await status(this.store, {
        id: result.entry.id,
        action: 'review',
        actor: request.actor ?? 'user',
        note: 'written from panel',
      });
      return { ...result, entry: reviewed.entry, event: reviewed.event, id: reviewed.entry.id };
    });
  }

  remoteUpdate(request = {}) {
    return this.answer(() =>
      update(this.store, {
        id: request.id,
        title: request.title,
        summary: request.summary,
        type: request.type,
        triggers: request.triggers,
        body: request.body,
        valid_from: request.valid_from,
        valid_until: request.valid_until,
        expectedUpdated: request.expectedUpdated ?? request.expected_updated,
        actor: request.actor ?? 'user',
      }),
    );
  }

  remoteStatus(request = {}) {
    return this.answer(() =>
      status(this.store, {
        id: request.id,
        action: request.action,
        new_id: request.new_id ?? request.newId,
        actor: request.actor ?? 'user',
      }),
    );
  }

  remoteMove(request = {}) {
    return this.answer(() =>
      move(this.store, {
        id: request.id,
        targetScope: request.targetScope ?? request.target_scope,
        actor: request.actor ?? 'user',
      }),
    );
  }

  remoteInjectionLog(request = {}) {
    return this.answer(() => injectionLog(this.store, request.limit ?? 50));
  }

  /**
   * Resolve one JSON string, keeping the Remote carrier free of thrown errors.
   *
   * Deliberately a normal method: Cordis hands the Gateway a Proxy of this
   * instance, and a `#private` method called through that Proxy throws
   * "Receiver must be an instance of class KiraRemoteService".
   */
  async answer(operation) {
    try {
      const value = await operation();
      return JSON.stringify({ ok: true, value });
    } catch (error) {
      if (error instanceof KiraError) {
        return JSON.stringify({ ok: false, errorCode: error.code, errorMessage: error.message });
      }
      return JSON.stringify({
        ok: false,
        errorCode: 'INTERNAL',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const REMOTE_METHODS = [
  ['remoteSnapshot', 'snapshot'],
  ['remoteDetail', 'detail'],
  ['remoteWrite', 'write'],
  ['remoteUpdate', 'update'],
  ['remoteStatus', 'status'],
  ['remoteMove', 'move'],
  ['remoteInjectionLog', 'injectionLog'],
];

for (const [method, exportName] of REMOTE_METHODS) {
  markRemote(KiraRemoteService.prototype, method, exportName);
}
