/**
 * Kira Note — the core library. Everything the Host tools, the panel remote,
 * and the tests share lives here. No plugin framework imports, no React.
 */
import { createHash } from 'node:crypto';

import {
  INJECT_BYTE_LIMIT,
  INJECT_ITEM_LIMIT,
  INJECT_SIDE_BYTES,
  INJECT_SIDE_ITEMS,
  RECALL_DEFAULT,
  RECALL_LIMIT,
  SCOPE_ENTRY_LIMIT,
  SUMMARY_LIMIT,
  TITLE_LIMIT,
  TYPES,
  TYPE_LABELS,
  TRIGGER_LIMIT,
  bm25,
  byteLength,
  compareEntries,
  computedStatus,
  entrySummary,
  formatIndexLine,
  isEligible,
  isProjectScope,
  nowIso,
  projectIdOfScope,
  renderIndex,
  truncationReport,
  validUntilMs,
} from './format.js';

export class KiraError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'KiraError';
    this.code = code;
  }
}

function assert(condition, code, message) {
  if (!condition) throw new KiraError(code, message);
}

function charLength(text) {
  return [...String(text)].length;
}

function normalizeTriggers(triggers) {
  if (triggers === undefined || triggers === null) return [];
  assert(Array.isArray(triggers), 'INVALID_TRIGGERS', 'triggers 必须是字符串数组');
  // The store keeps up to 10; the index line only renders the first 3.
  assert(triggers.length <= TRIGGER_LIMIT, 'INVALID_TRIGGERS', `triggers 最多 ${TRIGGER_LIMIT} 个（当前 ${triggers.length} 个）`);
  const seen = new Set();
  const list = [];
  for (const raw of triggers) {
    const trigger = String(raw ?? '').trim();
    assert(trigger !== '', 'INVALID_TRIGGERS', 'triggers 不能包含空字符串');
    if (seen.has(trigger)) continue;
    seen.add(trigger);
    list.push(trigger);
  }
  return list;
}

function validateSummary(summary) {
  const text = String(summary ?? '').trim();
  assert(text !== '', 'INVALID_SUMMARY', 'summary 必填');
  assert(charLength(text) <= SUMMARY_LIMIT, 'INVALID_SUMMARY', `summary 不得超过 ${SUMMARY_LIMIT} 字（当前 ${charLength(text)} 字）`);
  return text;
}

function validateTitle(title) {
  const text = String(title ?? '').trim();
  assert(text !== '', 'INVALID_TITLE', 'title 必填');
  assert(charLength(text) <= TITLE_LIMIT, 'INVALID_TITLE', `title 不得超过 ${TITLE_LIMIT} 字（当前 ${charLength(text)} 字）`);
  return text;
}

function validateType(type) {
  assert(TYPES.includes(type), 'INVALID_TYPE', `type 必须是 ${TYPES.join(' / ')} 之一`);
  return type;
}

function validateValidity(validUntil) {
  if (validUntil === undefined || validUntil === null || validUntil === '') return null;
  const time = validUntilMs(validUntil);
  assert(time !== null, 'INVALID_VALIDITY', 'valid_until 必须是 ISO 日期或时间');
  return String(validUntil);
}

async function requireScope(store, scope) {
  if (scope === 'user') return 'user';
  assert(isProjectScope(scope), 'INVALID_SCOPE', 'scope 必须是 user 或 project:<id>');
  const id = projectIdOfScope(scope);
  const projects = await store.readProjects();
  assert(projects[id] !== undefined, 'INVALID_SCOPE', `未知项目作用域 ${scope}`);
  return scope;
}

async function scopeTitle(store, scope) {
  if (scope === 'user') return '个人记忆';
  const projects = await store.readProjects();
  const id = projectIdOfScope(scope);
  return `${projects[id]?.name ?? id}（${scope}）`;
}

/* ------------------------------------------------------------------ write */

export async function write(store, input = {}) {
  const title = validateTitle(input.title);
  const summary = validateSummary(input.summary);
  const type = validateType(input.type);
  const body = String(input.body ?? '').trim();
  assert(body !== '', 'INVALID_BODY', '正文不能为空');
  const triggers = normalizeTriggers(input.triggers);
  const validUntil = validateValidity(input.valid_until);
  const scope = await requireScope(store, input.scope ?? 'user');

  return store.run(async () => {
    const existing = await store.listEntries(scope);
    const duplicate = existing.find((entry) => entry.title === title && entry.status !== 'archived');
    assert(duplicate === undefined, 'DUPLICATE_TITLE', `同一作用域已有同名条目 ${duplicate?.id ?? ''}，请用 kira_status(action="supersede") 取代它`);
    assert(existing.length < SCOPE_ENTRY_LIMIT, 'SCOPE_FULL', `作用域已达 ${SCOPE_ENTRY_LIMIT} 条上限，请先归档旧条目`);

    const timestamp = nowIso();
    const entry = {
      id: store.nextId(),
      title,
      summary,
      type,
      scope,
      triggers,
      created: timestamp,
      updated: timestamp,
      valid_from: timestamp,
      valid_until: validUntil,
      superseded_by: null,
      status: 'active',
      pinned: false,
      reviewed: false,
      source: {
        session: typeof input.session === 'string' ? input.session : (input.session?.id ?? null),
        cwd: input.cwd ?? null,
        actor: input.actor ?? 'model',
      },
      body,
    };
    await store.writeEntry(entry);
    await store.rebuildIndex(scope, await scopeTitle(store, scope));
    const event = await store.appendEvent({
      actor: entry.source.actor,
      entry_id: entry.id,
      action: 'create',
      from: null,
      to: null,
      note: '',
    });
    return { ok: true, entry, event, indexFull: existing.length + 1 >= SCOPE_ENTRY_LIMIT };
  });
}

/* ----------------------------------------------------------------- recall */

export async function recall(store, input = {}) {
  const query = String(input.query ?? '').trim();
  assert(query !== '', 'EMPTY_QUERY', 'query 不能为空');
  const limit = Math.min(RECALL_LIMIT, Math.max(1, Number(input.limit ?? RECALL_DEFAULT) || RECALL_DEFAULT));
  const now = store.clock();
  const includeHistory = Boolean(input.include_history);

  let scopes;
  if (input.scope === undefined || input.scope === null || input.scope === '') {
    const project = await store.resolveProject(input.cwd ?? process.cwd());
    scopes = ['user', project.scope];
  } else if (input.scope === 'all') {
    scopes = (await store.listScopes()).map((scope) => scope.key);
  } else if (input.scope === 'project') {
    const project = await store.resolveProject(input.cwd ?? process.cwd());
    scopes = [project.scope];
  } else {
    scopes = [await requireScope(store, input.scope)];
  }

  const documents = [];
  for (const scope of scopes) {
    for (const entry of await store.listEntries(scope)) {
      const status = computedStatus(entry, now);
      if (status === 'archived') continue;
      if (!includeHistory && !isEligible(entry, now)) continue;
      documents.push({
        id: entry.id,
        scope,
        entry,
        text: [entry.title, entry.summary, (entry.triggers ?? []).join(' '), entry.body].join('\n'),
      });
    }
  }
  const hits = bm25(query, documents).slice(0, limit);
  return {
    ok: true,
    query,
    scopes,
    total: documents.length,
    hits: hits.map(({ entry, score }) => ({
      id: entry.id,
      title: entry.title,
      summary: entry.summary,
      type: entry.type,
      scope: entry.scope,
      status: computedStatus(entry, now),
      updated: entry.updated,
      score: Math.round(score * 1000) / 1000,
      body: entry.body,
    })),
  };
}

/* -------------------------------------------------------------------- raw */

export async function raw(store, id) {
  assert(typeof id === 'string' && id !== '', 'INVALID_ID', 'id 必填');
  const found = await store.findEntry(id);
  assert(found !== null, 'NOT_FOUND', `找不到条目 ${id}`);
  const { entry, scope, scopeInfo } = found;
  return {
    ok: true,
    entry,
    scope,
    scopeName: scopeInfo.name,
    status: computedStatus(entry, store.clock()),
    indexLine: formatIndexLine(entry),
  };
}

/* ----------------------------------------------------------------- status */

const STATUS_ACTIONS = new Set(['supersede', 'expire', 'archive', 'restore', 'pin', 'unpin', 'review']);

export async function status(store, input = {}) {
  const id = String(input.id ?? '');
  const action = String(input.action ?? '');
  assert(STATUS_ACTIONS.has(action), 'INVALID_ACTION', `action 必须是 ${[...STATUS_ACTIONS].join(' / ')} 之一`);

  return store.run(async () => {
    const found = await store.findEntry(id);
    assert(found !== null, 'NOT_FOUND', `找不到条目 ${id}`);
    const entry = { ...found.entry };
    const before = { status: entry.status, pinned: entry.pinned, reviewed: entry.reviewed, superseded_by: entry.superseded_by, valid_until: entry.valid_until };
    let eventAction = action;

    if (action === 'supersede') {
      const newId = String(input.new_id ?? '');
      assert(newId !== '', 'NEW_ID_REQUIRED', 'supersede 必须传 new_id');
      const replacement = await store.findEntry(newId);
      assert(replacement !== null, 'NOT_FOUND', `找不到取代条目 ${newId}`);
      assert(newId !== id, 'INVALID_ARGUMENT', '不能取代自己');
      entry.superseded_by = newId;
      entry.status = 'superseded';
    } else if (action === 'expire') {
      entry.valid_until = nowIso();
      entry.status = 'expired';
    } else if (action === 'archive') {
      entry.status = 'archived';
    } else if (action === 'restore') {
      entry.status = 'active';
      entry.superseded_by = null;
      if (entry.valid_until !== null && validUntilMs(entry.valid_until) <= store.clock()) entry.valid_until = null;
    } else if (action === 'pin' || action === 'unpin') {
      entry.pinned = action === 'pin';
    } else if (action === 'review') {
      entry.reviewed = true;
    }

    entry.updated = nowIso();
    await store.writeEntry(entry);
    await store.rebuildIndex(entry.scope, await scopeTitle(store, entry.scope));
    const after = { status: entry.status, pinned: entry.pinned, reviewed: entry.reviewed, superseded_by: entry.superseded_by, valid_until: entry.valid_until };
    const event = await store.appendEvent({
      actor: input.actor ?? 'user',
      entry_id: entry.id,
      action: eventAction,
      from: JSON.stringify(before),
      to: JSON.stringify(after),
      note: input.note ?? '',
    });
    return { ok: true, entry, event };
  });
}

/* ----------------------------------------------------------------- update */

export async function update(store, input = {}) {
  const id = String(input.id ?? '');
  assert(id !== '', 'INVALID_ID', 'id 必填');

  return store.run(async () => {
    const found = await store.findEntry(id);
    assert(found !== null, 'NOT_FOUND', `找不到条目 ${id}`);
    const entry = { ...found.entry };
    if (input.expectedUpdated !== undefined && input.expectedUpdated !== null && input.expectedUpdated !== entry.updated) {
      throw new KiraError('CONFLICT', `条目已在别处更新（当前 updated=${entry.updated}），请刷新后重试`);
    }
    const before = { ...entry };
    const changes = [];

    if (input.title !== undefined) {
      const title = validateTitle(input.title);
      if (title !== entry.title) {
        const siblings = await store.listEntries(entry.scope);
        const duplicate = siblings.find((sibling) => sibling.id !== entry.id && sibling.title === title && sibling.status !== 'archived');
        assert(duplicate === undefined, 'DUPLICATE_TITLE', `同一作用域已有同名条目 ${duplicate?.id ?? ''}`);
        entry.title = title;
      }
    }
    if (input.summary !== undefined) entry.summary = validateSummary(input.summary);
    if (input.type !== undefined) entry.type = validateType(input.type);
    if (input.triggers !== undefined) entry.triggers = normalizeTriggers(input.triggers);
    if (input.body !== undefined) {
      const body = String(input.body ?? '').trim();
      assert(body !== '', 'INVALID_BODY', '正文不能为空');
      entry.body = body;
    }
    if (input.valid_from !== undefined) entry.valid_from = input.valid_from === null ? nowIso() : String(input.valid_from);
    if (input.valid_until !== undefined) entry.valid_until = validateValidity(input.valid_until);

    const fieldPairs = [
      ['title', before.title, entry.title],
      ['summary', before.summary, entry.summary],
      ['type', before.type, entry.type],
      ['triggers', JSON.stringify(before.triggers ?? []), JSON.stringify(entry.triggers ?? [])],
      ['body', before.body, entry.body],
      ['validity', `${before.valid_from}|${before.valid_until ?? ''}`, `${entry.valid_from}|${entry.valid_until ?? ''}`],
    ];
    for (const [field, from, to] of fieldPairs) {
      if (from !== to) changes.push({ field, from, to });
    }
    if (changes.length === 0) {
      return { ok: true, changed: false, entry: found.entry, events: [] };
    }

    entry.updated = nowIso();
    await store.writeEntry(entry);
    await store.rebuildIndex(entry.scope, await scopeTitle(store, entry.scope));
    const events = [];
    for (const change of changes) {
      events.push(
        await store.appendEvent({
          actor: input.actor ?? 'user',
          entry_id: entry.id,
          action: `update.${change.field}`,
          from: change.from,
          to: change.to,
          note: input.note ?? '',
        }),
      );
    }
    return { ok: true, changed: true, entry, events };
  });
}

/* ------------------------------------------------------------------- move */

export async function move(store, input = {}) {
  const id = String(input.id ?? '');
  const targetScope = await requireScope(store, input.targetScope);
  assert(id !== '', 'INVALID_ID', 'id 必填');

  return store.run(async () => {
    const found = await store.findEntry(id);
    assert(found !== null, 'NOT_FOUND', `找不到条目 ${id}`);
    const entry = found.entry;
    assert(entry.scope !== targetScope, 'INVALID_ARGUMENT', '条目已经在该作用域');
    const targetEntries = await store.listEntries(targetScope);
    assert(targetEntries.length < SCOPE_ENTRY_LIMIT, 'SCOPE_FULL', `目标作用域已达 ${SCOPE_ENTRY_LIMIT} 条上限`);
    const duplicate = targetEntries.find((candidate) => candidate.title === entry.title && candidate.status !== 'archived');
    assert(duplicate === undefined, 'DUPLICATE_TITLE', `目标作用域已有同名条目 ${duplicate?.id ?? ''}`);

    const moved = { ...entry, scope: targetScope, updated: nowIso() };
    await store.writeEntry(moved);
    await store.removeEntry(entry);
    await store.rebuildIndex(entry.scope, await scopeTitle(store, entry.scope));
    await store.rebuildIndex(targetScope, await scopeTitle(store, targetScope));
    const event = await store.appendEvent({
      actor: input.actor ?? 'user',
      entry_id: entry.id,
      action: 'move',
      from: entry.scope,
      to: targetScope,
      note: '',
    });
    return { ok: true, entry: moved, event };
  });
}

/* --------------------------------------------------------------- snapshot */

export async function snapshot(store) {
  const now = store.clock();
  const scopes = await store.listScopes();
  const entries = [];
  const scopeRows = [];
  let unreviewedCount = 0;
  const byType = Object.fromEntries(TYPES.map((type) => [type, 0]));

  for (const scope of scopes) {
    const list = await store.listEntries(scope.key);
    const eligible = list.filter((entry) => isEligible(entry, now));
    for (const entry of list.sort(compareEntries)) {
      const row = {
        id: entry.id,
        title: entry.title,
        summary: entry.summary,
        type: entry.type,
        scope: entry.scope,
        computedStatus: computedStatus(entry, now),
        eligible: isEligible(entry, now),
        triggers: entry.triggers ?? [],
        updated: entry.updated,
        created: entry.created,
        pinned: Boolean(entry.pinned),
        reviewed: Boolean(entry.reviewed),
        valid_from: entry.valid_from ?? null,
        valid_until: entry.valid_until ?? null,
      };
      entries.push(row);
      byType[entry.type] = (byType[entry.type] ?? 0) + 1;
      if (!row.reviewed && row.computedStatus !== 'archived') unreviewedCount += 1;
    }
    const report = truncationReport(eligible);
    scopeRows.push({
      key: scope.key,
      id: scope.id ?? 'user',
      kind: scope.kind,
      name: scope.name,
      path: scope.path,
      total: list.length,
      eligible: eligible.length,
      unreviewed: list.filter((entry) => !entry.reviewed && computedStatus(entry, now) !== 'archived').length,
      index: { ...report, bytes: byteLength(renderIndex(scope.name, eligible)) },
    });
  }

  return {
    scopes: scopeRows,
    entries,
    unreviewedCount,
    corrupt: typeof store.corruptEntries === 'function' ? store.corruptEntries() : [],
    totals: { entries: entries.length, byType, scopes: scopeRows.length },
    generatedAt: nowIso(),
  };
}

/* ----------------------------------------------------------------- detail */

export async function detail(store, id) {
  const found = await raw(store, id);
  const now = store.clock();
  const scopeEntries = (await store.listEntries(found.entry.scope)).filter((entry) => isEligible(entry, now)).sort(compareEntries);
  const rank = scopeEntries.findIndex((entry) => entry.id === id);
  const events = (await store.readEvents(id)).reverse();
  const report = truncationReport(scopeEntries);
  return {
    ...found,
    events,
    index: {
      total: scopeEntries.length,
      included: report.included,
      rank: rank < 0 ? null : rank + 1,
      byType: report.byType,
      bytes: byteLength(renderIndex(found.scopeName, scopeEntries)),
    },
  };
}

/* ------------------------------------------------------------ injectionLog */

export async function injectionLog(store, limit = 50) {
  return { ok: true, rows: (await store.readJournal(Math.min(500, Math.max(1, Number(limit) || 50)))).reverse() };
}

/* ---------------------------------------------------------- buildInjection */

const FULL_LABEL = (entry) => {
  const triggers = (entry.triggers ?? []).join('、');
  return `### ${entry.id} · ${entry.title}\n简介：${entrySummary(entry)}｜类型：${entry.type}${triggers === '' ? '' : `｜触发：${triggers}`}\n\n${String(entry.body ?? '').trim()}\n`;
};

function gapLines(gaps) {
  return [
    `+${gaps.overLimit} 条超出 25 条注入上限`,
    `+${gaps.excludedByStatus} 条因状态排除`,
    `+${gaps.otherWorkspace} 条不属于本工作区`,
  ].join('\n');
}

/**
 * Selection: each side reserves 10 items / 10 KB; unused reservation flows to the
 * other side; leftovers compete globally until 25 items / 25 KB.
 */
function selectSide(entries, items, bytes) {
  const picked = [];
  let used = 0;
  for (const entry of entries) {
    if (picked.length >= items) break;
    const full = FULL_LABEL(entry);
    const fullBytes = byteLength(full);
    if (used + fullBytes <= bytes) {
      used += fullBytes;
      picked.push({ entry, text: full });
      continue;
    }
    const line = `${formatIndexLine(entry)}\n`;
    const lineBytes = byteLength(line);
    if (used + lineBytes <= bytes) {
      used += lineBytes;
      picked.push({ entry, text: line });
    }
  }
  return { picked, bytes: used };
}

/**
 * Pure assembly over already-read entry lists. The sync injection provider and
 * the async `buildInjection` gatherer both call this, so selection rules exist once.
 */
export function assembleInjection({ userAll, projectAll, otherWorkspace = 0, project, session = null, now = Date.now() }) {
  const userEligible = userAll.filter((entry) => isEligible(entry, now)).sort(compareEntries);
  const projectEligible = projectAll.filter((entry) => isEligible(entry, now)).sort(compareEntries);

  const excludedByStatus =
    userAll.filter((entry) => !isEligible(entry, now)).length +
    projectAll.filter((entry) => !isEligible(entry, now)).length;

  const userReserve = Math.min(INJECT_SIDE_ITEMS, userEligible.length);
  const projectReserve = Math.min(INJECT_SIDE_ITEMS, projectEligible.length);
  // A side that cannot fill its reservation hands the slack to the other side.
  const userItems = Math.min(userEligible.length, INJECT_SIDE_ITEMS + (INJECT_SIDE_ITEMS - projectReserve));
  const projectItems = Math.min(projectEligible.length, INJECT_SIDE_ITEMS + (INJECT_SIDE_ITEMS - userReserve));

  const userSide = selectSide(userEligible, userItems, INJECT_SIDE_BYTES);
  const projectSide = selectSide(projectEligible, projectItems, INJECT_SIDE_BYTES);
  const userPicked = userSide.picked;
  const projectPicked = projectSide.picked;

  let itemsLeft = INJECT_ITEM_LIMIT - (userPicked.length + projectPicked.length);
  let bytes = userSide.bytes + projectSide.bytes;

  // Remaining budget competes across both sides by the same ordering.
  const userRest = userEligible.slice(userPicked.length);
  const projectRest = projectEligible.slice(projectPicked.length);
  const pool = [...userRest.map((entry) => ({ entry, side: 'user' })), ...projectRest.map((entry) => ({ entry, side: 'project' }))].sort(
    (left, right) => compareEntries(left.entry, right.entry),
  );

  for (const candidate of pool) {
    if (itemsLeft <= 0) break;
    const full = FULL_LABEL(candidate.entry);
    let text = null;
    if (bytes + byteLength(full) <= INJECT_BYTE_LIMIT) {
      text = full;
    } else {
      const line = `${formatIndexLine(candidate.entry)}\n`;
      if (bytes + byteLength(line) <= INJECT_BYTE_LIMIT) text = line;
    }
    if (text === null) continue;
    bytes += byteLength(text);
    itemsLeft -= 1;
    (candidate.side === 'user' ? userPicked : projectPicked).push({ entry: candidate.entry, text });
  }

  const header = [
    '<kira-note-memory>',
    'Kira Note 是跨会话长期记忆库。下面是你已记录的、与本工作区相关的记忆条目。',
    '需要更多细节时调用 kira_recall(query)；取回任意条目原文用 kira_raw(id)；记录新记忆用 kira_write；修改状态用 kira_status。',
    '',
  ].join('\n');

  const renderSections = (gaps) => {
    const sections = [header];
    const appendSection = (label, picked) => {
      sections.push(`## ${label}`);
      if (picked.length === 0) sections.push('（暂无记忆）');
      for (const item of picked) sections.push(item.text);
      sections.push('');
    };
    appendSection(`个人记忆（user，${userPicked.length} 条）`, userPicked);
    appendSection(`项目记忆（${project.name}，${projectPicked.length} 条）`, projectPicked);
    sections.push(gapLines(gaps));
    sections.push('</kira-note-memory>');
    sections.push('');
    return sections.join('\n');
  };

  // The 25 KB ceiling covers the whole block, header and gap lines included, so a
  // snapshot that overshoots after assembling sheds its lowest-priority tail.
  let text = '';
  let gaps = null;
  for (;;) {
    const ids = [...userPicked, ...projectPicked].map((item) => item.entry.id);
    const injected = new Set(ids);
    gaps = {
      overLimit: [...userEligible, ...projectEligible].filter((entry) => !injected.has(entry.id)).length,
      excludedByStatus,
      otherWorkspace,
    };
    text = renderSections(gaps);
    if (byteLength(text) <= INJECT_BYTE_LIMIT) break;
    if (projectPicked.length > 0) projectPicked.pop();
    else if (userPicked.length > 0) userPicked.pop();
    else break;
  }

  const ids = [...userPicked, ...projectPicked].map((item) => item.entry.id);
  return {
    text,
    ids,
    bytes: byteLength(text),
    hash: createHash('sha1').update(text).digest('hex').slice(0, 16),
    gaps,
    project: { id: project.id, scope: project.scope, name: project.name },
    session,
    entryCount: ids.length,
  };
}

/** Async gatherer used by tests and by callers that already live in an async context. */
export async function buildInjection(store, context = {}) {
  const now = store.clock();
  const project = await store.resolveProject(context.cwd ?? process.cwd());
  const userAll = await store.listEntries('user');
  const projectAll = await store.listEntries(project.scope);
  let otherWorkspace = 0;
  for (const scope of await store.listScopes()) {
    if (scope.key === 'user' || scope.key === project.scope) continue;
    otherWorkspace += (await store.listEntries(scope.key)).filter((entry) => isEligible(entry, now)).length;
  }
  return assembleInjection({ userAll, projectAll, otherWorkspace, project, session: context.session ?? null, now });
}

export const TYPE_NAME = TYPE_LABELS;
