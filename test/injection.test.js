import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { assembleInjection, buildInjection, write } from '../lib/core.js';
import { KiraStore } from '../lib/store.js';
import {
  INJECT_BYTE_LIMIT,
  INJECT_ITEM_LIMIT,
  byteLength,
  isEligible,
} from '../lib/format.js';

function entry(index, { scope = 'user', type = 'environment-fact', bodySize = 40, pinned = false, validUntil = null } = {}) {
  const stamp = new Date(Date.UTC(2026, 10, 7, 10, 0, index)).toISOString();
  return {
    id: `kn-test${String(index).padStart(4, '0')}-a1b2`,
    title: `记忆 ${scope} ${index}`,
    summary: `第 ${index} 条测试记忆的摘要`,
    type,
    scope,
    triggers: ['pnpm'],
    created: stamp,
    updated: stamp,
    valid_from: stamp,
    valid_until: validUntil,
    superseded_by: null,
    status: 'active',
    pinned,
    reviewed: false,
    source: { session: null, cwd: null, actor: 'model' },
    body: 'x'.repeat(bodySize),
  };
}

const PROJECT = { id: 'demo-1234abcd', scope: 'project:demo-1234abcd', name: 'demo' };

test('a snapshot never exceeds 25 entries or 25 KB', () => {
  const userAll = Array.from({ length: 40 }, (_, index) => entry(index, { bodySize: 1200 }));
  const projectAll = Array.from({ length: 40 }, (_, index) => entry(index, { scope: PROJECT.scope, bodySize: 1200 }));
  const snapshot = assembleInjection({ userAll, projectAll, project: PROJECT, now: Date.now() });
  assert.ok(snapshot.entryCount <= INJECT_ITEM_LIMIT, `items ${snapshot.entryCount}`);
  assert.ok(byteLength(snapshot.text) <= INJECT_BYTE_LIMIT, `bytes ${byteLength(snapshot.text)}`);
  assert.equal(snapshot.bytes, byteLength(snapshot.text));
  assert.match(snapshot.text, /^<kira-note-memory>/);
  assert.match(snapshot.text, /<\/kira-note-memory>\n$/);
});

test('each side keeps its own ten-entry reservation first', () => {
  const userAll = Array.from({ length: 10 }, (_, index) => entry(index));
  const projectAll = Array.from({ length: 10 }, (_, index) => entry(index, { scope: PROJECT.scope }));
  const snapshot = assembleInjection({ userAll, projectAll, project: PROJECT, now: Date.now() });
  const userPart = snapshot.text.split('## 项目记忆')[0];
  assert.equal((userPart.match(/^### /gm) ?? []).length, 10);
  assert.equal(snapshot.entryCount, 20);
});

test('an under-filled side hands its reservation to the other side', () => {
  const userAll = [entry(0), entry(1)];
  const projectAll = Array.from({ length: 30 }, (_, index) => entry(index + 10, { scope: PROJECT.scope }));
  const snapshot = assembleInjection({ userAll, projectAll, project: PROJECT, now: Date.now() });
  const userPart = snapshot.text.split('## 项目记忆')[0];
  assert.equal((userPart.match(/^### /gm) ?? []).length, 2);
  assert.equal(snapshot.entryCount, 25);
});

test('gap lines report the three kinds of missing memory', () => {
  const userAll = [
    ...Array.from({ length: 30 }, (_, index) => entry(index)),
    entry(90, { validUntil: '2026-01-01T00:00:00.000Z' }),
  ];
  const projectAll = [entry(91, { scope: PROJECT.scope })];
  const snapshot = assembleInjection({ userAll, projectAll, otherWorkspace: 4, project: PROJECT, now: Date.now() });
  assert.ok(snapshot.gaps.overLimit >= 6, `overLimit ${snapshot.gaps.overLimit}`);
  assert.equal(snapshot.gaps.excludedByStatus, 1);
  assert.equal(snapshot.gaps.otherWorkspace, 4);
  assert.match(snapshot.text, /\+\d+ 条超出 25 条注入上限/);
  assert.match(snapshot.text, /\+\d+ 条因状态排除/);
  assert.match(snapshot.text, /\+4 条不属于本工作区/);
  assert.match(snapshot.text, /kira_recall/);
});

test('pinned entries are injected before newer unpinned ones', () => {
  const userAll = [entry(1), entry(2), entry(3, { pinned: true })];
  const snapshot = assembleInjection({ userAll, projectAll: [], project: PROJECT, now: Date.now() });
  const firstHeading = snapshot.text.split('\n').find((line) => line.startsWith('### '));
  assert.match(firstHeading, /记忆 user 3/);
});

test('injection keeps literal braces and is byte-stable across rounds', () => {
  const userAll = [{ ...entry(0), title: 'Templates use {{project}}', body: 'keep {{...}} literal' }];
  const first = assembleInjection({ userAll, projectAll: [], project: PROJECT, now: Date.now() });
  const second = assembleInjection({ userAll, projectAll: [], project: PROJECT, now: Date.now() });
  assert.match(first.text, /\{\{project\}\}/);
  assert.equal(first.text, second.text);
  assert.equal(first.hash, second.hash);
});

test('buildInjection reads the store and counts other workspaces', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'kira-inject-'));
  try {
    const store = new KiraStore({ home });
    await store.init();
    const cwd = path.join(home, 'workspace-a');
    const other = path.join(home, 'workspace-b');
    await store.resolveProject(cwd);
    const otherProject = await store.resolveProject(other);
    await write(store, {
      title: '当前项目约定', summary: '当前项目的构建命令', type: 'workspace-convention', body: 'pnpm build', scope: (await store.resolveProject(cwd)).scope,
    });
    await write(store, {
      title: '别的项目约定', summary: '别的项目的构建命令', type: 'workspace-convention', body: 'npm build', scope: otherProject.scope,
    });
    await write(store, {
      title: '个人偏好', summary: '语言与工具偏好', type: 'process-preference', body: '中文回答', scope: 'user',
    });
    const snapshot = await buildInjection(store, { cwd, session: 's1' });
    assert.equal(snapshot.gaps.otherWorkspace, 1);
    assert.equal(snapshot.entryCount, 2);
    assert.equal(isEligible({ ...entry(0) }, Date.now()), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
