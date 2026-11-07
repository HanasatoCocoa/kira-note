import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  KiraError,
  detail,
  injectionLog,
  move,
  raw,
  recall,
  snapshot,
  status,
  update,
  write,
} from '../lib/core.js';
import { KiraStore } from '../lib/store.js';
import { formatIndexLine } from '../lib/format.js';
import { KiraSyncStore } from '../lib/sync.js';
import { InjectionSource } from '../lib/injection.js';

async function withStore(run) {
  const home = await mkdtemp(path.join(tmpdir(), 'kira-core-'));
  const store = new KiraStore({ home });
  await store.init();
  try {
    return await run(store, home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

const BASE = {
  summary: '一条用于测试的记忆摘要',
  type: 'environment-fact',
  body: '正文内容，包含 `pnpm` 这样的字面量。',
};

test('write stores a file, rebuilds the index and appends one event', async () => {
  await withStore(async (store) => {
    const created = await write(store, { ...BASE, title: '测试条目', scope: 'user' });
    assert.equal(created.entry.status, 'active');
    assert.equal(created.entry.reviewed, false);
    assert.match(created.entry.id, /^kn-[0-9a-z]+-[0-9a-z]{4}$/);

    const stored = await raw(store, created.entry.id);
    assert.equal(stored.entry.title, '测试条目');
    assert.equal(stored.status, 'active');

    const index = await readFile(path.join(store.scopeDir('user'), 'INDEX.md'), 'utf8');
    assert.match(index, new RegExp(`- \\[${created.entry.id}\\] 一条用于测试的记忆摘要`));

    const events = await store.readEvents(created.entry.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].action, 'create');
  });
});

test('duplicate titles are rejected with the existing id', async () => {
  await withStore(async (store) => {
    const first = await write(store, { ...BASE, title: '同名条目', scope: 'user' });
    await assert.rejects(
      write(store, { ...BASE, title: '同名条目', scope: 'user' }),
      (error) => error instanceof KiraError && error.code === 'DUPLICATE_TITLE' && error.message.includes(first.entry.id),
    );
  });
});

test('validation rejects bad summary, type, triggers and body', async () => {
  await withStore(async (store) => {
    await assert.rejects(write(store, { ...BASE, title: 'x', summary: '一'.repeat(41), scope: 'user' }), /summary/);
    await assert.rejects(write(store, { ...BASE, title: 'y', type: 'nope', scope: 'user' }), /type/);
    // Storage allows up to 10 triggers; only the index line caps at 3.
    const many = ['a', 'b', 'c', 'd', 'e'];
    const stored = await write(store, { ...BASE, title: 'z', triggers: many, scope: 'user' });
    assert.deepEqual(stored.entry.triggers, many);
    const line = formatIndexLine(stored.entry);
    assert.equal(line.split('触发:')[1].split('｜')[0].split('、').length, 3);
    await assert.rejects(
      write(store, { ...BASE, title: 'z2', triggers: Array.from({ length: 11 }, (_, i) => `t${i}`), scope: 'user' }),
      /triggers/,
    );
    await assert.rejects(write(store, { ...BASE, title: 'w', body: '   ', scope: 'user' }), /正文/);
  });
});

test('titles are capped at 40 characters', async () => {
  await withStore(async (store) => {
    const ok = await write(store, { ...BASE, title: '标'.repeat(40), scope: 'user' });
    assert.equal(ok.entry.title, '标'.repeat(40));
    await assert.rejects(write(store, { ...BASE, title: '标'.repeat(41), scope: 'user' }), /40/);
  });
});

test('recall keeps projects isolated', async () => {
  await withStore(async (store) => {
    const alpha = await mkdtemp(path.join(tmpdir(), 'kira-alpha-'));
    const beta = await mkdtemp(path.join(tmpdir(), 'kira-beta-'));
    try {
      const alphaScope = await store.resolveProject(alpha);
      const betaScope = await store.resolveProject(beta);
      await write(store, { ...BASE, title: 'alpha 专属', body: 'alpha deploy pipeline', scope: alphaScope.scope });
      await write(store, { ...BASE, title: 'beta 专属', body: 'beta deploy pipeline', scope: betaScope.scope });
      await write(store, { ...BASE, title: '个人偏好', body: 'deploy pipeline 的通用偏好', scope: 'user', type: 'process-preference' });

      const inAlpha = await recall(store, { query: 'deploy pipeline', cwd: alpha });
      const titles = inAlpha.hits.map((hit) => hit.title).sort();
      assert.deepEqual(titles, ['alpha 专属', '个人偏好'].sort());

      const everything = await recall(store, { query: 'deploy pipeline', scope: 'all' });
      assert.equal(everything.hits.length, 3);
    } finally {
      await rm(alpha, { recursive: true, force: true });
      await rm(beta, { recursive: true, force: true });
    }
  });
});

test('recall hides history unless asked', async () => {
  await withStore(async (store) => {
    const created = await write(store, { ...BASE, title: '会被过期', body: 'expire me please', scope: 'user' });
    await status(store, { id: created.entry.id, action: 'expire' });
    assert.equal((await recall(store, { query: 'expire me' })).hits.length, 0);
    const withHistory = await recall(store, { query: 'expire me', include_history: true });
    assert.equal(withHistory.hits.length, 1);
    assert.equal(withHistory.hits[0].status, 'expired');
  });
});

test('updating only the type records exactly one event', async () => {
  await withStore(async (store) => {
    const created = await write(store, { ...BASE, title: '改类型', scope: 'user' });
    const changed = await update(store, { id: created.entry.id, type: 'project-decision', expectedUpdated: created.entry.updated });
    assert.equal(changed.changed, true);
    assert.equal(changed.events.length, 1);
    assert.equal(changed.events[0].action, 'update.type');
    assert.equal(changed.events[0].from, 'environment-fact');
    assert.equal(changed.events[0].to, 'project-decision');

    const events = await store.readEvents(created.entry.id);
    assert.deepEqual(events.map((event) => event.action), ['create', 'update.type']);

    const again = await update(store, { id: created.entry.id, type: 'project-decision' });
    assert.equal(again.changed, false);
    assert.equal((await store.readEvents(created.entry.id)).length, 2);
  });
});

test('update is guarded by expectedUpdated', async () => {
  await withStore(async (store) => {
    const created = await write(store, { ...BASE, title: '并发保护', scope: 'user' });
    await update(store, { id: created.entry.id, summary: '第一次修改后的摘要' });
    await assert.rejects(
      update(store, { id: created.entry.id, summary: '第二次修改后的摘要', expectedUpdated: created.entry.updated }),
      (error) => error instanceof KiraError && error.code === 'CONFLICT',
    );
  });
});

test('status moves through every action without deleting', async () => {
  await withStore(async (store) => {
    const first = await write(store, { ...BASE, title: '旧结论', scope: 'user' });
    const second = await write(store, { ...BASE, title: '新结论', scope: 'user' });

    await assert.rejects(status(store, { id: first.entry.id, action: 'supersede' }), /new_id/);
    const superseded = await status(store, { id: first.entry.id, action: 'supersede', new_id: second.entry.id });
    assert.equal(superseded.entry.status, 'superseded');
    assert.equal(superseded.entry.superseded_by, second.entry.id);

    const archived = await status(store, { id: first.entry.id, action: 'archive' });
    assert.equal(archived.entry.status, 'archived');
    const restored = await status(store, { id: first.entry.id, action: 'restore' });
    assert.equal(restored.entry.status, 'active');
    assert.equal(restored.entry.superseded_by, null);

    const pinned = await status(store, { id: second.entry.id, action: 'pin' });
    assert.equal(pinned.entry.pinned, true);
    const unpinned = await status(store, { id: second.entry.id, action: 'unpin' });
    assert.equal(unpinned.entry.pinned, false);

    const reviewed = await status(store, { id: second.entry.id, action: 'review' });
    assert.equal(reviewed.entry.reviewed, true);

    const expired = await status(store, { id: second.entry.id, action: 'expire' });
    assert.equal(expired.entry.status, 'expired');

    const all = await snapshot(store);
    assert.equal(all.entries.length, 2);
  });
});

test('move relocates an entry between scopes', async () => {
  await withStore(async (store) => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'kira-move-'));
    try {
      const project = await store.resolveProject(projectDir);
      const created = await write(store, { ...BASE, title: '可移动', scope: 'user' });
      const moved = await move(store, { id: created.entry.id, targetScope: project.scope });
      assert.equal(moved.entry.scope, project.scope);
      assert.equal(await raw(store, created.entry.id).then((found) => found.scope), project.scope);
      assert.equal(await store.listEntries('user').then((rows) => rows.length), 0);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});

test('snapshot and detail expose the fields the panel renders', async () => {
  await withStore(async (store) => {
    const created = await write(store, { ...BASE, title: '面板字段', triggers: ['pnpm'], scope: 'user' });
    const view = await snapshot(store);
    assert.equal(view.entries.length, 1);
    assert.equal(view.unreviewedCount, 1);
    const row = view.entries[0];
    for (const key of ['id', 'title', 'summary', 'type', 'scope', 'computedStatus', 'triggers', 'updated', 'created', 'pinned', 'reviewed']) {
      assert.ok(key in row, `missing ${key}`);
    }
    assert.equal(view.scopes[0].kind, 'user');

    const one = await detail(store, created.entry.id);
    assert.equal(one.entry.id, created.entry.id);
    assert.equal(one.events.length, 1);
    assert.equal(one.index.rank, 1);
    assert.equal(one.index.included, 1);
  });
});

test('sync injection provider returns identical text and journals only changes', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'kira-sync-'));
  try {
    const store = new KiraStore({ home });
    await store.init();
    await write(store, { ...BASE, title: '同步快照', body: 'keep {{project}} literal', scope: 'user' });
    const source = new InjectionSource({ home });
    const first = source.text({ session: 's1', cwd: home });
    const second = source.text({ session: 's1', cwd: home });
    assert.equal(first, second);
    assert.match(first, /\{\{project\}\}/);
    assert.match(first, /<kira-note-memory>/);
    assert.match(first, /个人记忆（user，1 条）/);

    const sync = new KiraSyncStore({ home });
    assert.equal(sync.readJournal(10).length, 1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('injection log lists journal rows newest first', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'kira-log-'));
  try {
    const store = new KiraStore({ home });
    await store.init();
    await write(store, { ...BASE, title: '日志条目', scope: 'user' });
    await store.appendJournal({ session: 's1', project: 'user', bytes: 12, ids: [], hash: 'aaaa' });
    await store.appendJournal({ session: 's1', project: 'user', bytes: 13, ids: [], hash: 'bbbb' });
    const log = await injectionLog(store, 10);
    assert.equal(log.rows.length, 2);
    assert.equal(log.rows[0].hash, 'bbbb');
    assert.match(log.rows[0].ts, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('a broken entry file is reported instead of silently dropped', async () => {
  await withStore(async (store) => {
    await write(store, { ...BASE, title: '好条目', scope: 'user' });
    const dir = store.entriesDir('user');
    const bad = path.join(dir, 'kn-bad0001-zzzz.md');
    await writeFile(
      bad,
      '---\nid: kn-bad0001-zzzz\ntitle: 坏条目\nsummary: 坏的\ntype: environment-fact\nscope: user\ntriggers: [a, b]\n---\nbody\n',
      'utf8',
    );
    const entries = await store.listEntries('user');
    assert.equal(entries.length, 1);
    const corrupt = store.corruptEntries();
    assert.equal(corrupt.length, 1);
    assert.equal(corrupt[0].file, bad);
    const shaped = await snapshot(store);
    assert.equal(shaped.corrupt.length, 1);
    assert.equal(shaped.entries.length, 1);
  });
});

test('a missing summary falls back to the title in the index line', async () => {  await withStore(async (store) => {
    const created = await write(store, { ...BASE, title: '没有简介的旧条目', scope: 'user' });
    const entry = { ...created.entry, summary: '' };
    assert.match(formatIndexLine(entry), /没有简介的旧条目/);
    assert.doesNotMatch(formatIndexLine(entry), /undefined/);
    const shaped = await snapshot(store);
    assert.ok(shaped.totals.entries >= 1);
    for (const scope of shaped.scopes) assert.equal(typeof scope.index.bytes, 'number');
  });
});

test('the sync journal stamps ts and dedupes per session', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'kira-journal-'));
  try {
    const sync = new KiraSyncStore({ home });
    const row = sync.appendJournal({ session: 's1', project: 'p', bytes: 12, ids: [], hash: 'hash-1' });
    assert.match(row.ts, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(sync.lastJournalHash('s1'), 'hash-1');
    assert.equal(sync.lastJournalHash('s2'), null);
    const rows = sync.readJournal(10);
    assert.equal(rows.length, 1);
    assert.match(rows[0].ts, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
