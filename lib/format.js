/**
 * Kira Note — pure formatting, identity, ordering, and scoring helpers.
 * Zero dependencies; safe to import from the Host half and from tests.
 */

export const TYPES = [
  'environment-fact',
  'process-preference',
  'persona-language',
  'workspace-convention',
  'project-decision',
];

export const TYPE_LABELS = {
  'environment-fact': '环境事实',
  'process-preference': '流程偏好',
  'persona-language': '说话偏好',
  'workspace-convention': '工作区约定',
  'project-decision': '项目决策',
};

export const RULE_TYPES = new Set(['persona-language', 'process-preference']);
export const STATUSES = ['active', 'expired', 'superseded', 'archived'];
export const SUMMARY_LIMIT = 40;
/** Titles and summaries share one ruler: 40 characters. */
export const TITLE_LIMIT = 40;
/** Stored triggers per entry. The index line shows only the first INDEX_TRIGGER_LIMIT. */
export const TRIGGER_LIMIT = 10;
export const INDEX_TRIGGER_LIMIT = 3;
export const SCOPE_ENTRY_LIMIT = 500;
export const INDEX_LINE_LIMIT = 200;
export const INJECT_ITEM_LIMIT = 25;
export const INJECT_BYTE_LIMIT = 25 * 1024;
export const INJECT_SIDE_ITEMS = 10;
export const INJECT_SIDE_BYTES = 10 * 1024;
export const RECALL_DEFAULT = 8;
export const RECALL_LIMIT = 25;

export const TOKEN_RE = /[a-z0-9]+|[\u4e00-\u9fa5]/g;

export function byteLength(text) {
  return Buffer.byteLength(String(text), 'utf8');
}

export function nowIso() {
  return new Date().toISOString();
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function makeId(now = Date.now(), random = Math.random) {
  let suffix = '';
  for (let i = 0; i < 4; i += 1) {
    suffix += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length) % ID_ALPHABET.length];
  }
  return `kn-${now.toString(36)}-${suffix}`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

export function crc32(text) {
  let crc = 0xffffffff;
  for (const byte of Buffer.from(String(text), 'utf8')) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function crc32Hex(text) {
  return crc32(text).toString(16).padStart(8, '0');
}

/** Deterministic project scope id: normalized path plus a short CRC32 of the raw path. */
export function projectIdFor(path) {
  const raw = String(path).replace(/\\/g, '/').replace(/\/+$/, '');
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-48) || 'project';
  return `${slug}-${crc32Hex(raw.toLowerCase())}`;
}

export function scopeKeyOf(entry) {
  return entry.scope;
}

export function isProjectScope(scope) {
  return typeof scope === 'string' && scope.startsWith('project:');
}

export function projectIdOfScope(scope) {
  return isProjectScope(scope) ? scope.slice('project:'.length) : null;
}

/** Parse the tiny YAML subset Kira Note writes (block mapping, flow sequences, JSON scalars). */
export function parseFrontmatter(text) {
  const source = String(text);
  if (!source.startsWith('---\n')) throw new Error('entry: missing frontmatter');
  const end = source.indexOf('\n---\n', 4);
  if (end < 0) throw new Error('entry: unterminated frontmatter');
  const head = source.slice(4, end);
  const body = source.slice(end + 5);
  const data = {};
  let owner = null;
  for (const line of head.split('\n')) {
    if (line.trim() === '') continue;
    const nested = /^\s+([A-Za-z0-9_-]+):\s?(.*)$/.exec(line);
    if (nested && owner !== null) {
      data[owner][nested[1]] = parseScalar(nested[2]);
      continue;
    }
    const top = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(line);
    if (!top) throw new Error(`entry: unsupported frontmatter line "${line}"`);
    const [, key, raw] = top;
    if (raw === '') {
      data[key] = {};
      owner = key;
    } else {
      data[key] = parseScalar(raw);
      owner = null;
    }
  }
  return { data, body };
}

function parseScalar(raw) {
  const value = String(raw).trim();
  if (value === '' || value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.startsWith('"')) return JSON.parse(value);
  if (value.startsWith('[')) return JSON.parse(value);
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function scalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return JSON.stringify(String(value));
}

export function renderEntry(entry) {
  const lines = [
    '---',
    `id: ${scalar(entry.id)}`,
    `title: ${scalar(entry.title)}`,
    `summary: ${scalar(entry.summary)}`,
    `type: ${scalar(entry.type)}`,
    `scope: ${scalar(entry.scope)}`,
    `triggers: [${(entry.triggers ?? []).map((trigger) => scalar(trigger)).join(', ')}]`,
    `created: ${scalar(entry.created)}`,
    `updated: ${scalar(entry.updated)}`,
    `valid_from: ${scalar(entry.valid_from ?? null)}`,
    `valid_until: ${scalar(entry.valid_until ?? null)}`,
    `superseded_by: ${scalar(entry.superseded_by ?? null)}`,
    `status: ${scalar(entry.status)}`,
    `pinned: ${scalar(Boolean(entry.pinned))}`,
    `reviewed: ${scalar(Boolean(entry.reviewed))}`,
    'source:',
    `  session: ${scalar(entry.source?.session ?? null)}`,
    `  cwd: ${scalar(entry.source?.cwd ?? null)}`,
    `  actor: ${scalar(entry.source?.actor ?? 'user')}`,
    '---',
    '',
  ];
  const body = String(entry.body ?? '');
  return `${lines.join('\n')}${body}${body.endsWith('\n') ? '' : '\n'}`;
}

export function validUntilMs(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  const time = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? Date.parse(`${text}T23:59:59.999Z`)
    : Date.parse(text);
  return Number.isNaN(time) ? null : time;
}

export function computedStatus(entry, now = Date.now()) {
  if (entry.status === 'archived') return 'archived';
  if (entry.status === 'superseded' || entry.superseded_by) return 'superseded';
  if (entry.status === 'expired') return 'expired';
  const until = validUntilMs(entry.valid_until);
  if (until !== null && now >= until) return 'expired';
  return 'active';
}

export function isEligible(entry, now = Date.now()) {
  if (entry.status !== 'active') return false;
  if (entry.superseded_by !== null && entry.superseded_by !== undefined) return false;
  const until = validUntilMs(entry.valid_until);
  return until === null || now < until;
}

export function compareEntries(left, right) {
  if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1;
  const leftRule = RULE_TYPES.has(left.type) ? 0 : 1;
  const rightRule = RULE_TYPES.has(right.type) ? 0 : 1;
  if (leftRule !== rightRule) return leftRule - rightRule;
  if (left.updated !== right.updated) return left.updated < right.updated ? 1 : -1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * Allocate the per-type index budget: small type sections are satisfied first and the
 * largest section receives the remaining room. Order inside a section is already sorted.
 */
export function truncateByType(entries, limit = INDEX_LINE_LIMIT) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.type)) groups.set(entry.type, []);
    groups.get(entry.type).push(entry);
  }
  const keys = [...groups.keys()].sort((left, right) => {
    const delta = groups.get(left).length - groups.get(right).length;
    return delta !== 0 ? delta : left.localeCompare(right);
  });
  const included = new Map();
  let budget = Math.max(0, limit);
  keys.forEach((key) => {
    const list = groups.get(key);
    const take = Math.min(list.length, budget);
    included.set(key, list.slice(0, take));
    budget -= take;
  });
  return { included, groups };
}

/** The one-line form the model reads: summary first, title as the fallback. */
export function entrySummary(entry) {
  const summary = String(entry.summary ?? '').trim();
  if (summary !== '') return summary;
  const title = String(entry.title ?? '').trim();
  return title !== '' ? title : entry.id;
}

export function formatIndexLine(entry) {
  const triggers = (entry.triggers ?? []).slice(0, INDEX_TRIGGER_LIMIT).join('、');
  return `- [${entry.id}] ${entrySummary(entry)}｜触发:${triggers}｜类型:${entry.type}`;
}

export function renderIndex(scopeTitle, entries) {
  const { included, groups } = truncateByType(entries);
  const lines = [`# Kira Note Index — ${scopeTitle}`, ''];
  const order = [...TYPES.filter((type) => groups.has(type)), ...[...groups.keys()].filter((type) => !TYPES.includes(type)).sort()];
  for (const type of order) {
    const kept = included.get(type) ?? [];
    lines.push(`## ${type}`);
    if (kept.length === 0) lines.push('（本类条目未进入索引）');
    for (const entry of kept) lines.push(formatIndexLine(entry));
    lines.push('');
  }
  lines.push(`<!-- total=${entries.length} lines=${[...included.values()].reduce((sum, list) => sum + list.length, 0)} generated=${nowIso()} -->`);
  lines.push('');
  return lines.join('\n');
}

export function truncationReport(entries) {
  const { included, groups } = truncateByType(entries);
  const byType = {};
  for (const [type, list] of groups) {
    byType[type] = { total: list.length, included: (included.get(type) ?? []).length };
  }
  return {
    total: entries.length,
    included: [...included.values()].reduce((sum, list) => sum + list.length, 0),
    byType,
  };
}

export function tokenize(text) {
  return String(text ?? '').toLowerCase().match(TOKEN_RE) ?? [];
}

/**
 * BM25 ranking over an explicit corpus. k1 = 1.2, b = 0.75 as specified.
 */
export function bm25(query, documents, { k1 = 1.2, b = 0.75 } = {}) {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0 || documents.length === 0) return [];
  const lengths = documents.map((document) => tokenize(document.text).length);
  const average = lengths.reduce((sum, value) => sum + value, 0) / lengths.length || 1;
  const frequencies = documents.map((document) => {
    const counts = new Map();
    for (const token of tokenize(document.text)) counts.set(token, (counts.get(token) ?? 0) + 1);
    return counts;
  });
  const documentFrequency = new Map();
  for (const term of terms) {
    let count = 0;
    for (const counts of frequencies) if (counts.has(term)) count += 1;
    documentFrequency.set(term, count);
  }
  const scored = [];
  documents.forEach((document, index) => {
    let score = 0;
    for (const term of terms) {
      const tf = frequencies[index].get(term) ?? 0;
      if (tf === 0) continue;
      const df = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * lengths[index]) / average)));
    }
    if (score > 0) scored.push({ ...document, score });
  });
  scored.sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : 1));
  return scored;
}

export function errorResult(code, message) {
  return JSON.stringify({ ok: false, errorCode: code, errorMessage: message });
}

export function okResult(payload = {}) {
  return JSON.stringify({ ok: true, ...payload });
}
