/**
 * Kira Note — model-facing tools (kira_recall / kira_raw / kira_write / kira_status).
 */
import { defineTool } from '@deepseek-ai/dsh-tools';

import { KiraError, raw, recall, status, write } from './core.js';
import { RECALL_DEFAULT, RECALL_LIMIT, SUMMARY_LIMIT, TITLE_LIMIT, TYPES, TYPE_LABELS, TRIGGER_LIMIT } from './format.js';

const JSON_OUTPUT = {
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
};

const CURRENT_SCOPE = 'project';
const TYPE_LIST = TYPES.map((type) => `${type}（${TYPE_LABELS[type]}）`).join('、');

function failure(error) {
  if (error instanceof KiraError) return { ok: false, error: { code: error.code, message: error.message } };
  return { ok: false, error: { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) } };
}

/**
 * Tool values must be lossless JSON: an `undefined` member or a class instance
 * (a Session object, for example) makes the harness reject the whole call.
 */
function plain(value) {
  return JSON.parse(JSON.stringify(value) ?? 'null');
}

function presentCall(args, title, kind = 'other') {
  return { card: 'generic', title, kind, rawInput: args };
}

/**
 * @param {{
 *   store: object,
 *   cwdOf: (exec: object) => string,
 *   scopeFor: (cwd: string) => Promise<{ id: string, scope: string, name: string, path: string }>,
 * }} deps
 */
export function createKiraTools({ store, cwdOf, scopeFor }) {
  const recallTool = defineTool({
    name: 'kira_recall',
    description:
      'Search the Kira Note memory library (personal memory plus the current workspace) with BM25. '
      + 'Use it when the injected memory block lacks a detail, when the user references a past decision, or before asking again. '
      + 'If the first query misses, try different keywords once more before concluding the entry does not exist. '
      + `Returns at most ${RECALL_LIMIT} entries, full body included. Expired and superseded entries are hidden unless include_history is true.`,
    parameters: {
      query: { type: 'string', required: true, description: 'Keywords; Chinese is matched per character, English per word.' },
      scope: {
        type: 'string',
        description: "Optional scope filter: 'user', 'project' (current workspace), or a literal 'project:<id>'.",
      },
      include_history: { type: 'boolean', description: 'Also return expired and superseded entries (archived ones stay hidden).' },
      limit: { type: 'integer', description: `How many entries to return, default ${RECALL_DEFAULT}, max ${RECALL_LIMIT}.` },
    },
    async execute(args, exec) {
      try {
        const result = await recall(store, {
          query: args.query,
          scope: args.scope,
          include_history: args.include_history === true,
          limit: args.limit,
          cwd: cwdOf(exec),
        });
        return plain({ ok: true, ...result });
      } catch (error) {
        return plain(failure(error));
      }
    },
    output: JSON_OUTPUT,
    presentCall: (args) => presentCall(args, `Kira recall: ${args.query ?? ''}`),
  });

  const rawTool = defineTool({
    name: 'kira_raw',
    description:
      'Read one Kira Note entry verbatim: frontmatter plus Markdown body, in any status (active, expired, superseded, archived). '
      + 'Use it after kira_recall returns an id, or when you need the exact original wording instead of the summary line.',
    parameters: {
      id: { type: 'string', required: true, description: "The entry id, e.g. 'kn-m3k2a1-7f3c'." },
    },
    async execute(args) {
      try {
        return plain({ ok: true, ...(await raw(store, args.id)) });
      } catch (error) {
        return plain(failure(error));
      }
    },
    output: JSON_OUTPUT,
    presentCall: (args) => presentCall(args, `Kira raw: ${args.id ?? ''}`),
  });

  const writeTool = defineTool({
    name: 'kira_write',
    description:
      'Save one durable memory entry to Kira Note. Write only what will still be true in a later session:\n'
      + '- good: an environment fact (a command that must be run on this machine), a process preference (how this user wants work done), '
      + 'a persona/language preference, a workspace convention, or a project decision with its reason.\n'
      + '- do NOT write: code patterns that the repository already shows, architecture descriptions, git history, '
      + 'debugging recipes that belong in a doc, or this turn\'s temporary state. Those stay in the conversation.\n'
      + 'The scope (personal memory vs this workspace) is computed by the plugin from the current working directory; '
      + 'you may only suggest it. A duplicate title in the same scope is rejected with the existing id — supersede that id instead.',
    parameters: {
      title: {
        type: 'string',
        required: true,
        description: `Short human title (at most ${TITLE_LIMIT} characters), unique within its scope. The index line shows the summary, not this.`,
      },
      summary: { type: 'string', required: true, description: `One line the model will read in the index, at most ${SUMMARY_LIMIT} characters.` },
      body: { type: 'string', required: true, description: 'The Markdown body: the fact itself, why it matters, and when it applies.' },
      type: { type: 'string', required: true, enum: TYPES, description: TYPE_LIST },
      triggers: {
        type: 'array',
        items: { type: 'string' },
        description: `Up to ${TRIGGER_LIMIT} short trigger words; the index line renders only the first 3.`,
      },
      scope_suggestion: {
        type: 'string',
        enum: ['user', 'project'],
        description: "'user' if it holds in any project, 'project' if only in this workspace.",
      },
      valid_until: { type: 'string', description: 'Optional ISO date after which the entry stops being injected.' },
    },
    async execute(args, exec) {
      try {
        const cwd = cwdOf(exec);
        const scope = await resolveWriteScope({ args, cwd, scopeFor });
        const result = await write(store, {
          title: args.title,
          summary: args.summary,
          body: args.body,
          type: args.type,
          triggers: args.triggers,
          valid_until: args.valid_until,
          scope,
          cwd,
          session: exec?.agent?.session?.id ?? null,
          actor: 'model',
        });
        return plain({ ok: true, ...result });
      } catch (error) {
        return plain(failure(error));
      }
    },
    output: JSON_OUTPUT,
    presentCall: (args) => presentCall(args, `Kira write: ${args.title ?? ''}`),
  });

  const statusTool = defineTool({
    name: 'kira_status',
    description:
      'Change the status of a Kira Note entry. There is no delete: supersede replaces an outdated entry with a newer one, '
      + 'expire ends its validity now, archive hides it but keeps it restorable, restore brings an archived entry back, '
      + 'pin/unpin control index priority, and review marks an entry as human-checked.',
    parameters: {
      id: { type: 'string', required: true, description: 'The entry id to change.' },
      action: {
        type: 'string',
        required: true,
        enum: ['supersede', 'expire', 'archive', 'restore', 'pin', 'unpin', 'review'],
        description: 'supersede requires new_id.',
      },
      new_id: { type: 'string', description: 'The replacement entry id; required for supersede.' },
    },
    async execute(args) {
      try {
        const result = await status(store, { id: args.id, action: args.action, new_id: args.new_id, actor: 'model' });
        return plain({ ok: true, ...result });
      } catch (error) {
        return plain(failure(error));
      }
    },
    output: JSON_OUTPUT,
    presentCall: (args) => presentCall(args, `Kira ${args.action ?? 'status'}: ${args.id ?? ''}`),
  });

  return [recallTool, rawTool, writeTool, statusTool];
}

const USER_LEVEL_TYPES = new Set(['persona-language', 'process-preference']);

/**
 * The model only suggests; the plugin decides. A suggestion wins when present,
 * otherwise the type decides (preferences are personal, facts are local).
 */
export async function resolveWriteScope({ args, cwd, scopeFor }) {
  const suggestion = args.scope_suggestion;
  if (suggestion === 'user') return 'user';
  if (suggestion === 'project') return (await scopeFor(cwd)).scope;
  if (suggestion === undefined || suggestion === null) {
    if (USER_LEVEL_TYPES.has(args.type)) return 'user';
    return (await scopeFor(cwd)).scope;
  }
  throw new KiraError('INVALID_SCOPE', "scope_suggestion must be 'user' or 'project'");
}

export { CURRENT_SCOPE };
