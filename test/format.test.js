import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INDEX_LINE_LIMIT,
  SUMMARY_LIMIT,
  TYPE_LABELS,
  TYPES,
  bm25,
  compareEntries,
  computedStatus,
  formatIndexLine,
  isEligible,
  makeId,
  parseFrontmatter,
  projectIdFor,
  renderEntry,
  tokenize,
  truncateByType,
  validUntilMs,
} from '../lib/format.js';

const ENTRY = {
  id: 'kn-m3k2a1-7f3c',
  title: '这台机器用 pnpm，不用 npm',
  summary: '包管理器统一用 pnpm 12',
  type: 'process-preference',
  scope: 'user',
  triggers: ['pnpm', 'install'],
  created: '2026-11-07T10:00:00.000Z',
  updated: '2026-11-07T10:00:00.000Z',
  valid_from: '2026-11-07T10:00:00.000Z',
  valid_until: null,
  superseded_by: null,
  status: 'active',
  pinned: false,
  reviewed: false,
  source: { session: 'session-1', cwd: 'D:/Work/App', actor: 'model' },
  body: '任何 `pnpm` 与 `npm` 二选一的场合都用 pnpm；不要生成 package-lock.json。',
};

test('entry frontmatter survives a render/parse round trip', () => {
  const text = renderEntry(ENTRY);
  assert.match(text, /^---\n/);
  const { data, body } = parseFrontmatter(text);
  assert.equal(data.id, ENTRY.id);
  assert.equal(data.title, ENTRY.title);
  assert.equal(data.summary, ENTRY.summary);
  assert.deepEqual(data.triggers, ENTRY.triggers);
  assert.deepEqual(data.source, ENTRY.source);
  assert.equal(data.valid_until, null);
  assert.equal(data.reviewed, false);
  assert.equal(body.trim(), ENTRY.body);
});

test('frontmatter keeps literal braces and colons', () => {
  const tricky = {
    ...ENTRY,
    title: 'Rewrites {{project}} only',
    body: 'Keep {{...}} literal: a: b # not a comment',
  };
  const { data, body } = parseFrontmatter(renderEntry(tricky));
  assert.equal(data.title, 'Rewrites {{project}} only');
  assert.equal(body.trim(), 'Keep {{...}} literal: a: b # not a comment');
});

test('ids are kn-<base36 time>-<4 digits>', () => {
  const id = makeId(Date.UTC(2026, 10, 7), () => 0.5);
  assert.match(id, /^kn-[0-9a-z]+-[0-9a-z]{4}$/);
  assert.equal(makeId(1, () => 0), makeId(1, () => 0));
});

test('project ids are deterministic and filesystem safe', () => {
  const a = projectIdFor('D:/Work/App');
  assert.equal(a, projectIdFor('D:\\Work\\App'));
  assert.match(a, /^[a-z0-9-]+-[0-9a-f]{8}$/);
  assert.notEqual(a, projectIdFor('D:/Work/App/plugin'));
  assert.equal(projectIdFor('D:/Work/App'), projectIdFor('d:/work/app'));
});

test('computed status honours validity and supersession', () => {
  const now = Date.parse('2026-11-07T12:00:00.000Z');
  assert.equal(computedStatus({ ...ENTRY }, now), 'active');
  assert.equal(computedStatus({ ...ENTRY, valid_until: '2026-11-06T23:59:59.999Z' }, now), 'expired');
  assert.equal(computedStatus({ ...ENTRY, superseded_by: 'kn-x' }, now), 'superseded');
  assert.equal(computedStatus({ ...ENTRY, status: 'archived' }, now), 'archived');
  assert.equal(isEligible({ ...ENTRY, valid_until: '2026-11-06T23:59:59.999Z' }, now), false);
  assert.equal(validUntilMs('2026-11-07'), Date.parse('2026-11-07T23:59:59.999Z'));
});

test('sort order: pinned, rule types, newest update, id', () => {
  const rows = [
    { ...ENTRY, id: 'kn-b', type: 'project-decision', updated: '2026-11-07T10:00:00.000Z' },
    { ...ENTRY, id: 'kn-a', type: 'process-preference', updated: '2026-11-06T10:00:00.000Z' },
    { ...ENTRY, id: 'kn-c', type: 'project-decision', updated: '2026-11-05T10:00:00.000Z', pinned: true },
  ];
  assert.deepEqual(rows.slice().sort(compareEntries).map((row) => row.id), ['kn-c', 'kn-a', 'kn-b']);
});

test('index lines show id, summary, three triggers, type', () => {
  const line = formatIndexLine({ ...ENTRY, triggers: ['a', 'b', 'c', 'd'] });
  assert.equal(line, `- [${ENTRY.id}] ${ENTRY.summary}｜触发:a、b、c｜类型:process-preference`);
  assert.ok(SUMMARY_LIMIT <= 40);
  assert.equal(TYPES.length, 5);
  assert.equal(TYPE_LABELS[TYPES[0]].length > 0, true);
});

test('index truncation keeps small sections whole and gives the rest to the largest', () => {
  const rows = [];
  for (let index = 0; index < 6; index += 1) rows.push({ ...ENTRY, id: `kn-f${index}`, type: 'environment-fact' });
  for (let index = 0; index < 2; index += 1) rows.push({ ...ENTRY, id: `kn-p${index}`, type: 'project-decision' });
  const { included } = truncateByType(rows, 5);
  const kept = [...included.values()].reduce((sum, list) => sum + list.length, 0);
  assert.equal(kept, 5);
  assert.equal(included.get('project-decision').length, 2);
  assert.equal(included.get('environment-fact').length, 3);
});

test('index limit is two hundred lines', () => {
  const rows = Array.from({ length: 250 }, (_, index) => ({ ...ENTRY, id: `kn-${index}`, type: 'environment-fact' }));
  const { included } = truncateByType(rows);
  const kept = [...included.values()].reduce((sum, list) => sum + list.length, 0);
  assert.equal(kept, INDEX_LINE_LIMIT);
});

test('bm25 ranks the matching document first', () => {
  const hits = bm25('pnpm install', [
    { id: 'a', text: 'pnpm install is the only package manager here' },
    { id: 'b', text: 'the deploy script runs at midnight' },
  ]);
  assert.equal(hits[0].id, 'a');
  assert.ok(hits[0].score > 0);
});

test('tokenizer splits latin words and single CJK characters', () => {
  assert.deepEqual(tokenize('PNPM 安装 慢'), ['pnpm', '安', '装', '慢']);
});
