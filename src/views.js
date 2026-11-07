    /* ----------------------------------------------------------------- views */

    const WEEKDAYS = {
      zh: ['日', '一', '二', '三', '四', '五', '六'],
      en: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
    };

    function Cover({ controller, state, lang, t, onExit }) {
      const count = state.data?.unreviewedCount ?? 0;
      const tabs = [
        ['mem', t.memory, null],
        ['review', t.review, count],
        ['journal', t.journal, null],
      ];
      return h(
        'div',
        { className: 'cover' },
        h('div', { className: 'brand' }, h('span', { className: 'mark' }, h(DiaryIcon, { size: 20 })), t.title),
        h(
          'nav',
          { className: 'tabs', 'aria-label': t.title },
          tabs.map(([id, label, badge]) => h(
            'button',
            {
              key: id,
              type: 'button',
              className: `tab ${state.tab === id ? 'active' : ''}`,
              onClick: () => controller.setTab(id),
              'aria-current': state.tab === id ? 'page' : undefined,
            },
            label,
            badge === null || badge === 0 ? null : h('span', { className: 'n' }, badge),
          )),
        ),
        h(
          'div',
          { className: 'cover-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'ghost icon-only',
              title: state.theme === 'night' ? (lang === 'en' ? 'Switch to light paper' : '切换到浅色纸面') : (lang === 'en' ? 'Switch to dark paper' : '切换到深色纸面'),
              'aria-label': state.theme === 'night' ? 'light' : 'dark',
              onClick: () => controller.setTheme(state.theme === 'night' ? 'day' : 'night'),
            },
            h(Icon, { name: state.theme === 'night' ? 'sun' : 'moon', size: 16 }),
          ),
          h(
            'button',
            { type: 'button', className: 'close', onClick: () => onExit?.(), title: t.cancel, 'aria-label': t.cancel },
            h(Icon, { name: 'close', size: 16 }),
          ),
        ),
      );
    }

    function Crumbs({ controller, state, t }) {
      if (state.scope === null) return h('div', { className: 'crumbs' }, h('span', { className: 'cur' }, t.all));
      const scopeName = state.scope === 'user' ? 'user' : scopeNameOf(state, state.scope);
      return h(
        'div',
        { className: 'crumbs' },
        h('button', { type: 'button', onClick: () => controller.setScope(null) }, t.all),
        h('span', { className: 'sep' }, '/'),
        state.scope === 'user' ? null : h('span', null, t.projects),
        state.scope === 'user' ? null : h('span', { className: 'sep' }, '/'),
        h('span', { className: 'cur' }, scopeName),
      );
    }

    function SearchRow({ controller, state, t, searchRef }) {
      const [open, setOpen] = useState(false);
      const count = Object.values(state.filters).filter(Boolean).length;
      useEffect(() => {
        if (!open) return undefined;
        const close = () => setOpen(false);
        window.addEventListener('pointerdown', close);
        return () => window.removeEventListener('pointerdown', close);
      }, [open]);
      return h(
        'div',
        { className: 'searchrow' },
        h(
          'div',
          { className: 'search' },
          h(Icon, { name: 'search', size: 15 }),
          h('input', {
            ref: searchRef,
            value: state.query,
            placeholder: t.search,
            'aria-label': t.search,
            onChange: (event) => controller.setQuery(event.target.value),
          }),
        ),
        h(
          'div',
          { style: { position: 'relative' } },
          h(
            'button',
            {
              type: 'button',
              className: 'icon-btn',
              title: t.filter,
              'aria-label': t.filter,
              'aria-expanded': open,
              onPointerDown: (event) => event.stopPropagation(),
              onClick: () => setOpen((value) => !value),
            },
            h(Icon, { name: 'filter', size: 16 }),
            count === 0 ? null : h('span', { className: 'filter-count' }, count),
          ),
          open
            ? h(
              'div',
              { className: 'pop', onPointerDown: (event) => event.stopPropagation() },
              h(
                'label',
                null,
                h('input', {
                  type: 'checkbox',
                  checked: state.filters.unreviewed,
                  onChange: (event) => controller.setFilter('unreviewed', event.target.checked),
                }),
                t.onlyUnreviewed,
              ),
              h(
                'label',
                null,
                h('input', {
                  type: 'checkbox',
                  checked: state.filters.pinned,
                  onChange: (event) => controller.setFilter('pinned', event.target.checked),
                }),
                t.onlyPinned,
              ),
              h(
                'label',
                null,
                h('input', {
                  type: 'checkbox',
                  checked: state.filters.archived,
                  onChange: (event) => controller.setFilter('archived', event.target.checked),
                }),
                t.showArchived,
              ),
              h('button', { type: 'button', className: 'clear', onClick: () => controller.clearFilters() }, t.clearFilters),
            )
            : null,
        ),
      );
    }

    function FolderRow({ controller, state, row, t, onMenu }) {
      const color = state.colors[row.key] ?? (row.key === 'user' ? '#92400E' : '#292524');
      const active = state.scope === row.key;
      return h(
        'button',
        {
          type: 'button',
          className: `folder ${active ? 'active' : ''}`,
          style: { '--fc': color, marginLeft: `${row.depth * 16}px`, width: `calc(100% - ${row.depth * 16}px)` },
          'aria-pressed': active,
          'aria-expanded': row.group ? state.openProjects : undefined,
          onClick: () => (row.group ? controller.toggleProjects() : controller.setScope(row.key)),
          onContextMenu: (event) => {
            event.preventDefault();
            onMenu({ kind: 'folder', scope: row.key, x: event.clientX, y: event.clientY });
          },
        },
        h('span', { style: { display: 'flex', opacity: 0.9 } }, h(Icon, { name: row.group ? 'box' : 'folder', size: 15 })),
        h('span', { className: 'fname' }, row.name),
        h('span', { className: 'fcount' }, row.count),
        row.unreviewed ? h('span', { className: 'fdot', title: t.unreviewed }) : null,
        row.group ? h('span', { className: `chev ${state.openProjects ? 'open' : ''}` }, h(Icon, { name: 'chev', size: 12 })) : null,
      );
    }

    function FileRow({ controller, state, entry, t, lang, onMenu }) {
      const selected = entry.id === state.selectedId;
      const color = state.colors[entry.scope] ?? (entry.scope === 'user' ? '#92400E' : '#292524');
      return h(
        'div',
        {
          className: `file ${selected ? 'selected' : ''}`,
          role: 'option',
          'aria-selected': selected,
          tabIndex: selected ? 0 : -1,
          'data-file': entry.id,
          style: { '--fc': color },
          onClick: () => controller.select(entry.id),
          onContextMenu: (event) => {
            event.preventDefault();
            controller.select(entry.id);
            onMenu({ kind: 'file', id: entry.id, x: event.clientX, y: event.clientY });
          },
        },
        h(
          'div',
          { className: 'file-title' },
          entry.reviewed ? null : h('span', { className: 'udot', title: t.unreviewed }),
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, entry.title),
          entry.pinned ? h('span', { className: 'pinmark', title: t.pinned }, h(Icon, { name: 'pin', size: 12 })) : null,
        ),
        h(
          'div',
          { className: 'file-meta' },
          typeLabelOf(lang, entry.type),
          ' · ',
          formatShort(entry.updated),
          state.scope === null ? ` · ${scopeNameOf(state, entry.scope)}` : '',
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'kebab',
            'aria-label': `${t.more}：${entry.title}`,
            onClick: (event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              controller.select(entry.id);
              onMenu({ kind: 'file', id: entry.id, x: rect.right - 218, y: rect.bottom + 4 });
            },
          },
          h(Icon, { name: 'more', size: 15 }),
        ),
      );
    }

    function LeftColumn({ controller, state, t, lang, searchRef, onMenu, width }) {
      const folders = folderRows(state, lang);
      const list = visibleEntries(state);
      const all = entriesOfScope(state, state.scope);
      const style = width === null
        ? undefined
        : { flex: `0 0 ${width}px`, width: `${width}px`, maxWidth: 'none' };
      return h(
        'aside',
        { className: 'left', 'aria-label': t.dirs, style },
        h(
          'div',
          { className: 'left-scroll' },
          h(Crumbs, { controller, state, t }),
          h(SearchRow, { controller, state, t, searchRef }),
          h('div', { className: 'section-head' }, h('span', null, t.dirs)),
          h(
            'div',
            null,
            folders.rows.map((row) => h(FolderRow, { key: row.key, controller, state, row, t, onMenu })),
          ),
          h(
            'div',
            { className: 'section-head' },
            h('span', null, `${t.memories} ${list.length}${list.length === all.length ? '' : ` / ${all.length}`}`),
            h(
              'button',
              { type: 'button', className: 'sort', onClick: () => controller.setSort() },
              `${t.sort}：${state.sort === 'updated' ? t.sortUpdated : state.sort === 'created' ? t.sortCreated : t.sortTitle}`,
              h(Icon, { name: 'chev', size: 11 }),
            ),
          ),
          h(
            'div',
            { role: 'listbox', 'aria-label': t.memories, tabIndex: 0 },
            list.length === 0
              ? h(
                'div',
                { className: 'empty-list' },
                h('div', { className: 'ic' }, h(Icon, { name: 'file', size: 26 })),
                state.query !== '' || state.filters.unreviewed || state.filters.pinned ? t.emptySearch : t.emptyScope,
              )
              : list.map((entry) => h(FileRow, { key: entry.id, controller, state, entry, t, lang, onMenu })),
          ),
        ),
      );
    }

    function Badge({ entry, lang, t }) {
      const status = statusOf(entry);
      return h(
        React.Fragment,
        null,
        h('span', { className: `badge ${status}` }, h(Icon, { name: STATUS_ICONS[status] ?? 'check', size: 11 }), statusLabelOf(lang, entry)),
        entry.pinned ? h('span', { className: 'badge pinned' }, h(Icon, { name: 'pin', size: 11 }), t.pinned) : null,
        entry.reviewed ? null : h('span', { className: 'badge unrev' }, t.unreviewed),
      );
    }

    function renderBody(body) {
      const blocks = String(body ?? '').split(/\n{2,}/).filter((block) => block.trim() !== '');
      return blocks.map((block, index) => {
        const lines = block.split('\n');
        if (lines.every((line) => line.startsWith('- '))) {
          return h('ul', { key: index }, lines.map((line, at) => h('li', { key: at }, line.slice(2))));
        }
        if (block.startsWith('### ')) return h('h3', { key: index }, block.slice(4));
        if (block.startsWith('## ')) return h('h3', { key: index }, block.slice(3));
        if (block.startsWith('# ')) return h('h3', { key: index }, block.slice(2));
        return h('p', { key: index }, lines.map((line, at) => (at === 0 ? line : [h('br', { key: `br${at}` }), line])));
      });
    }

    function Block({ title, hint, copy, children }) {
      return h(
        'section',
        { className: 'block' },
        h('div', { className: 'block-head' }, h('span', { className: 'label' }, title), hint ?? null, copy ?? null),
        children,
      );
    }

    function ReadPage({ controller, state, t, lang, detailRef }) {
      const detail = state.detail;
      if (detail === null) {
        return h(
          'div',
          { className: 'empty-page' },
          h('div', { className: 'big' }, h(Icon, { name: 'file', size: 42 })),
          h('p', null, t.emptyPage),
          h(
            'div',
            { className: 'keys' },
            h('kbd', null, '↑'),
            h('kbd', null, '↓'),
            h('span', null, t.keysHint),
            h('kbd', null, 'Ctrl'),
            h('span', null, '+'),
            h('kbd', null, 'E'),
          ),
        );
      }
      const entry = detail.entry;
      const status = statusOf(entry);
      const indexLine = indexLineOf(entry);
      const indexBytes = byteLength(indexLine);
      const budget = detail.index ?? { total: 0, included: 0, bytes: 0 };
      // Meter = how much of the entry's scope actually fits in the 200-line index.
      const meter = Math.max(0, Math.min(100, Math.round((Math.min(budget.included, budget.total) / Math.max(1, budget.total)) * 100)));
      const hasSummary = String(entry.summary ?? '').trim() !== '';
      const copy = (kind) => () => {
        const text = kind === 'id' ? entry.id : kind === 'index' ? indexLine : entry.body;
        copyText(text, () => controller.notice(kind === 'id' ? t.copiedId : kind === 'index' ? t.copiedIndex : t.copiedBody));
      };
      const triggerCount = (entry.triggers ?? []).length;

      return h(
        'div',
        { className: 'page', ref: detailRef, tabIndex: -1 },
        h('div', { className: 'dateline' }, formatDateline(entry.updated, lang)),
        h(
          'div',
          { className: 'page-head' },
          h('h1', null, entry.title),
          h(
            'div',
            { className: 'head-actions' },
            h(
              'button',
              { type: 'button', className: 'btn primary', disabled: !canEdit(entry), onClick: () => controller.startEdit() },
              h(Icon, { name: 'edit', size: 14 }),
              t.edit,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'icon-btn',
                'aria-label': t.more,
                onClick: (event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  controller.openMenu({ kind: 'file', id: entry.id, x: rect.right - 218, y: rect.bottom + 4 });
                },
              },
              h(Icon, { name: 'more', size: 16 }),
            ),
          ),
        ),
        h(
          'div',
          { className: hasSummary ? 'summary' : 'summary missing' },
          h('span', { className: 'slabel' }, lang === 'en' ? 'Summary' : '简介'),
          h('span', { className: 'stext' }, hasSummary ? entry.summary : t.summaryMissing),
          hasSummary
            ? null
            : h('button', { type: 'button', className: 'btn', onClick: () => controller.startEdit() }, t.summaryFillIn),
        ),
        h('div', { className: 'badges' }, h(Badge, { entry, lang, t })),
        status === 'archived'
          ? h(
            'div',
            { className: 'banner archived' },
            t.bannerArchived,
            h('button', { type: 'button', className: 'btn', onClick: () => controller.runAction('restore', entry) }, t.restore),
          )
          : null,
        status === 'superseded'
          ? h(
            'div',
            { className: 'banner archived' },
            t.bannerSuperseded,
            entry.superseded_by
              ? h('button', { type: 'button', className: 'btn', onClick: () => controller.select(entry.superseded_by) }, t.openSuccessor)
              : null,
          )
          : null,
        entry.reviewed
          ? null
          : h(
            'div',
            { className: 'banner' },
            t.bannerUnreviewed,
            h('button', { type: 'button', className: 'btn', onClick: () => controller.runAction('review', entry) }, t.markReviewed),
          ),
        h(
          'div',
          { className: 'meta' },
          h('span', null, typeLabelOf(lang, entry.type)),
          h('span', null, '·'),
          h('span', null, entry.scope === 'user' ? 'user' : entry.scope),
          h('span', null, '·'),
          h('span', null, `${t.updated} ${formatShort(entry.updated)}`),
          h('span', null, '·'),
          h('span', { className: 'id' }, entry.id, h('button', { type: 'button', 'aria-label': t.copyId, onClick: copy('id') }, h(Icon, { name: 'copy', size: 11 }))),
        ),
        h('div', { className: 'validrow' }, h('span', null, t.validity), h('span', { className: 'dates' }, validityText(entry, lang))),
        h(
          Block,
          {
            title: t.indexLine,
            copy: h('button', { type: 'button', className: 'copy', onClick: copy('index') }, h(Icon, { name: 'copy', size: 11 }), t.copy),
          },
          h('div', { className: 'indexline' }, indexLine),
          h('div', { className: 'hint' }, fill(t.indexHint, { n: indexBytes })),
        ),
        h(
          Block,
          {
            title: fill(t.triggers, { n: triggerCount }),
            hint: h('span', { className: 'hint', style: { margin: 0 } }, t.indexOnly),
          },
          h(
            'div',
            { className: 'tags' },
            triggerCount === 0
              ? h('span', { className: 'hint' }, t.noTriggers)
              : entry.triggers.map((trigger, at) => h(
                'span',
                { key: `${trigger}-${at}`, className: 'tag' },
                trigger,
                at < 3 ? h('span', { className: 'tn' }, lang === 'en' ? 'index' : '索引行') : null,
              )),
          ),
        ),
        h(
          Block,
          {
            title: t.body,
            copy: h('button', { type: 'button', className: 'copy', onClick: copy('body') }, h(Icon, { name: 'copy', size: 11 }), t.copyBody),
          },
          h('div', { className: 'body' }, renderBody(entry.body)),
        ),
        h(
          'details',
          { className: 'timeline' },
          h('summary', null, fill(t.history, { n: (detail.events ?? []).length })),
          (detail.events ?? []).map((event, at) => h(
            'div',
            { key: at, className: 'ev' },
            h('span', { className: 'dot' }),
            h('span', { className: 't' }, formatShort(event.ts)),
            h('span', null, `${actorLabel(lang, event.actor)} · ${eventLabel(lang, event.action)}${event.note ? ` · ${event.note}` : ''}`),
          )),
        ),
        h(
          Block,
          {
            title: t.budget,
            hint: h('span', { className: 'hint', style: { margin: 0 } }, fill(t.budgetRows, { used: budget.included, limit: 200 })),
          },
          h('div', { className: 'meter' }, h('span', { style: { width: `${meter}%` } })),
          h(
            'div',
            { className: 'budget-row' },
            h('span', null, fill(t.budgetFoot, { kb: ((budget.bytes ?? 0) / 1024).toFixed(1) })),
            h('span', null, fill(t.budgetUpdated, { time: formatShort(entry.updated) })),
          ),
        ),
      );
    }

    function TagEditor({ controller, draft, t }) {
      const [typing, setTyping] = useState('');
      const commit = () => {
        controller.addTrigger(typing);
        setTyping('');
      };
      return h(
        'div',
        { className: 'tagedit' },
        draft.triggers.map((trigger, at) => h(
          'span',
          { key: `${trigger}-${at}`, className: 'tag' },
          trigger,
          at < 3 ? h('span', { className: 'tn' }, CURRENT_LANG === 'en' ? 'index' : '索引行') : null,
          h(
            'button',
            { type: 'button', 'aria-label': `- ${trigger}`, onClick: () => controller.removeTrigger(at) },
            h(Icon, { name: 'close', size: 11 }),
          ),
        )),
        h('input', {
          value: typing,
          placeholder: t.triggerPlaceholder,
          'aria-label': t.fieldTriggers,
          onChange: (event) => setTyping(event.target.value),
          onKeyDown: (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            commit();
          },
        }),
      );
    }

    function DateButton({ controller, state, which, t }) {
      const draft = state.draft;
      const pop = state.datePop;
      const value = which === 'from' ? (pop?.from ?? draft.validFrom) : (pop?.until ?? draft.validUntil);
      const label = which === 'from' ? t.pickStart : t.pickEnd;
      return h(
        'button',
        {
          type: 'button',
          className: `datebtn ${value ? '' : 'empty'}`,
          'aria-haspopup': 'dialog',
          onClick: (event) => (pop === null ? controller.openDate(which, event.currentTarget.getBoundingClientRect()) : controller.closeDate()),
        },
        h(Icon, { name: 'calendar', size: 13 }),
        h('span', null, value ? formatIsoDate(value, CURRENT_LANG) : label),
      );
    }

    function EditPage({ controller, state, t, lang, detailRef }) {
      const draft = state.draft;
      const creating = state.creating === true;
      const entry = state.detail?.entry ?? null;
      if (draft === null) return null;
      const errors = state.errors ?? {};
      const errorsOf = (key) => (errors[key] ? `field invalid` : 'field');
      const preview = indexLineOf({
        id: entry?.id ?? 'kn-new',
        title: draft.title,
        summary: draft.summary,
        triggers: draft.triggers,
        type: draft.type,
      });
      return h(
        'div',
        { className: 'page', ref: detailRef, tabIndex: -1 },
        h(
          'div',
          { className: 'editbar' },
          h('span', { className: 'editing-label' }, creating ? t.creating : t.editing),
          h(
            'div',
            { style: { display: 'flex', gap: '6px' } },
            h('button', { type: 'button', className: 'btn', onClick: () => controller.cancelEdit() }, t.cancel),
            h(
              'button',
              { type: 'button', className: 'btn primary', disabled: state.busy, onClick: () => controller.saveEdit() },
              t.save,
            ),
          ),
        ),
        h(
          'div',
          { className: 'form' },
          h(
            'label',
            { className: errorsOf('title') },
            h('span', { className: 'fl' }, t.fieldTitle),
            h('input', {
              value: draft.title,
              maxLength: TITLE_LIMIT,
              autoFocus: true,
              autoComplete: 'off',
              onChange: (event) => controller.patchDraft({ title: event.target.value }),
            }),
            h('span', { className: 'fh' }, fill(t.fieldTitleHint, { n: [...draft.title].length })),
            errors.title ? h('span', { className: 'err' }, t.errTitle) : null,
          ),
          h(
            'label',
            { className: errorsOf('summary') },
            h('span', { className: 'fl' }, t.fieldSummary),
            h('input', {
              value: draft.summary,
              maxLength: SUMMARY_LIMIT,
              autoComplete: 'off',
              onChange: (event) => controller.patchDraft({ summary: event.target.value }),
            }),
            h('span', { className: 'fh' }, fill(t.fieldSummaryHint, { n: [...draft.summary].length })),
            errors.summary ? h('span', { className: 'err' }, t.errSummary) : null,
          ),
          h(
            'label',
            { className: 'field' },
            h('span', { className: 'fl' }, t.fieldType),
            h(
              'select',
              { value: draft.type, onChange: (event) => controller.patchDraft({ type: event.target.value }) },
              TYPES.map((type) => h('option', { key: type, value: type }, typeLabelOf(lang, type))),
            ),
          ),
          h(
            'div',
            { className: 'field' },
            h('span', { className: 'fl' }, t.fieldTriggers),
            h(TagEditor, { controller, draft, t }),
            h('span', { className: 'fh' }, t.triggerHint),
          ),
          h(
            'label',
            { className: errorsOf('body') },
            h('span', { className: 'fl' }, t.fieldBody),
            h('textarea', {
              value: draft.body,
              spellCheck: false,
              autoComplete: 'off',
              onChange: (event) => controller.patchDraft({ body: event.target.value }),
            }),
            errors.body ? h('span', { className: 'err' }, t.errBody) : null,
          ),
          h(
            'div',
            { className: 'field' },
            h('span', { className: 'fl' }, t.indexPreview),
            h('div', { className: 'indexline' }, preview),
            h('span', { className: 'fh' }, fill(t.indexHint, { n: byteLength(preview) })),
          ),
          h(
            'div',
            { className: errorsOf('validity') },
            h('span', { className: 'fl' }, t.fieldValidity),
            h(
              'label',
              { className: 'check' },
              h('input', {
                type: 'checkbox',
                checked: draft.currentlyValid,
                onChange: (event) => controller.toggleCurrentlyValid(event.target.checked),
              }),
              h('span', null, t.currentValid),
            ),
            draft.currentlyValid
              ? null
              : h(
                'div',
                { className: 'daterange' },
                h(DateButton, { controller, state, which: 'from', t }),
                h('span', { className: 'dash' }, t.to),
                h(DateButton, { controller, state, which: 'until', t }),
              ),
            h('span', { className: 'fh' }, t.validityHint),
            errors.validity ? h('span', { className: 'err' }, t.errValidity) : null,
          ),
          creating
            ? null
            : h(
              'div',
              { className: 'roline' },
              h('span', null, `${t.status} `, h(Badge, { entry, lang, t })),
              h('span', { className: 'id' }, `id ${entry.id}`),
              h('span', null, `${t.created} ${formatShort(entry.created)}`),
            ),
        ),
      );
    }

    function JournalPage({ state, t, lang }) {
      const rows = state.journal?.rows ?? [];
      return h(
        'div',
        { className: 'page' },
        h('div', { className: 'dateline' }, t.journal),
        h('div', { className: 'page-head' }, h('h1', null, t.journal)),
        h('p', { className: 'hint', style: { marginBottom: '14px' } }, t.journalHint),
        rows.length === 0
          ? h('div', { className: 'empty-page' }, h('div', { className: 'big' }, h(Icon, { name: 'box', size: 42 })), h('p', null, t.journalEmpty))
          : h(
            'div',
            { className: 'journal' },
            rows.map((row, at) => h(
              'div',
              { key: at, className: 'journal-row' },
              h('span', { className: 'journal-time' }, formatShort(row.ts, lang)),
              h('span', { className: 'journal-cell' }, row.project ?? '—'),
              h('span', { className: 'journal-cell mono' }, `${row.bytes ?? 0} B`),
              h('span', { className: 'journal-cell mono' }, String(row.hash ?? '').slice(0, 12)),
              h('span', { className: 'journal-cell soft' }, row.session ?? '—'),
            )),
          ),
      );
    }

    function CtxMenu({ controller, state, t, lang }) {
      const menu = state.menu;
      if (menu === null) return null;
      if (menu.kind === 'folder') {
        const scopeKey = menu.scope;
        const current = state.colors[scopeKey] ?? (scopeKey === 'user' ? '#92400E' : '#292524');
        const [name, , ratio] = COLORS.find(([, color]) => color === current) ?? COLORS[0];
        return h(
          'div',
          { className: 'ctx', style: { left: `${menu.x}px`, top: `${menu.y}px` }, role: 'menu' },
          h('div', { className: 'ct' }, scopeKey === PROJECTS_GROUP ? t.projects : scopeKey === 'user' ? 'user' : scopeNameOf(state, scopeKey)),
          h(
            'button',
            {
              type: 'button',
              className: 'item',
              onClick: () => {
                controller.setScope(scopeKey === PROJECTS_GROUP ? null : scopeKey);
                controller.closeMenu();
              },
            },
            lang === 'en' ? 'Open' : '打开',
            h('span', { className: 'r' }, 'Enter'),
          ),
          h('div', { className: 'subhead' }, lang === 'en' ? 'Folder colour' : '目录颜色'),
          h(
            'div',
            { className: 'swgrid' },
            COLORS.map(([colorName, color]) => h(
              'button',
              {
                key: color,
                type: 'button',
                className: `sw ${color === current ? 'sel' : ''}`,
                style: { '--sw': color },
                'aria-label': colorName,
                onClick: () => {
                  controller.setColor(scopeKey, color);
                  controller.closeMenu();
                },
              },
              color === current ? h('span', { className: 'ck' }, h(Icon, { name: 'check', size: 11 })) : null,
            )),
          ),
          h('div', { className: 'swread' }, `${name} · ${lang === 'en' ? 'white text' : '白字'} ${ratio}:1`),
          h('div', { className: 'sep' }),
          h(
            'button',
            {
              type: 'button',
              className: 'item',
              onClick: () => {
                controller.closeMenu();
                controller.startCreate(scopeKey === PROJECTS_GROUP ? null : scopeKey);
              },
            },
            t.newMemory,
            h('span', { className: 'r' }, 'Ctrl+N'),
          ),
          scopeKey === PROJECTS_GROUP
            ? null
            : h(
              'button',
              {
                type: 'button',
                className: `item ${state.filters.unreviewed ? 'on' : ''}`,
                onClick: () => {
                  controller.setScope(scopeKey);
                  controller.setFilter('unreviewed', !state.filters.unreviewed);
                  controller.closeMenu();
                },
              },
              t.onlyUnreviewed,
              state.filters.unreviewed ? h('span', { className: 'r' }, h(Icon, { name: 'check', size: 11 })) : null,
            ),
          h(
            'button',
            {
              type: 'button',
              className: 'item',
              onClick: () => {
                controller.setColor(scopeKey, null);
                controller.closeMenu();
              },
            },
            t.resetColor,
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'item',
              onClick: () => {
                controller.closeMenu();
                void controller.refresh();
              },
            },
            t.refresh,
          ),
        );
      }

      const entry = (state.data?.entries ?? []).find((row) => row.id === menu.id) ?? state.detail?.entry ?? null;
      if (entry === null) return null;
      const status = statusOf(entry);
      const items = [['open', t.open, 'Enter']];
      if (canEdit(entry)) items.push(['edit', t.edit, 'Ctrl+E']);
      if (canEdit(entry)) items.push([entry.pinned ? 'unpin' : 'pin', entry.pinned ? t.unpin : t.pin, '']);
      if (canEdit(entry) && !entry.reviewed) items.push(['review', t.markReviewed, '']);
      if (canEdit(entry)) items.push(['move', t.moveTo, '']);
      if (canEdit(entry) && status === 'active') items.push(['expire', t.expire, '']);
      if (canEdit(entry)) items.push(['supersede', t.supersede, '']);
      if (status !== 'archived') items.push(['archive', t.archive, '']);
      if (status === 'archived') items.push(['restore', t.restore, '']);
      items.push(['copy-id', t.copyId, '']);
      items.push(['copy-index', t.copyIndex, '']);

      const run = (id) => {
        if (id === 'open') controller.closeMenu();
        if (id === 'edit') {
          controller.closeMenu();
          controller.startEdit();
        }
        if (id === 'pin' || id === 'unpin' || id === 'review' || id === 'restore') {
          controller.closeMenu();
          void controller.runAction(id, entry);
        }
        if (id === 'expire') {
          controller.closeMenu();
          void controller.runAction('expire', entry);
        }
        if (id === 'archive') {
          controller.closeMenu();
          controller.openDialog({ kind: 'archive', id: entry.id });
        }
        if (id === 'move') {
          controller.openDialog({ kind: 'move', id: entry.id });
        }
        if (id === 'supersede') {
          controller.openDialog({ kind: 'supersede', id: entry.id });
        }
        if (id === 'copy-id') {
          controller.closeMenu();
          copyText(entry.id, () => controller.notice(t.copiedId));
        }
        if (id === 'copy-index') {
          controller.closeMenu();
          copyText(indexLineOf(entry), () => controller.notice(t.copiedIndex));
        }
      };

      return h(
        'div',
        { className: 'ctx', style: { left: `${menu.x}px`, top: `${menu.y}px` }, role: 'menu' },
        h('div', { className: 'ct' }, entry.title),
        items.flatMap(([id, label, hint]) => {
          const row = h(
            'button',
            { key: id, type: 'button', className: 'item', onClick: () => run(id) },
            label,
            hint ? h('span', { className: 'r' }, hint) : null,
          );
          return id === 'archive' ? [h('div', { key: 'sep-before-archive', className: 'sep' }), row] : [row];
        }),
      );
    }

    function DatePop({ controller, state, t, lang }) {
      const pop = state.datePop;
      useEffect(() => {
        if (pop === null) return undefined;
        const onPointerDown = (event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          if (target.closest('.datepop') || target.closest('.datebtn')) return;
          controller.closeDate();
        };
        window.addEventListener('pointerdown', onPointerDown);
        return () => window.removeEventListener('pointerdown', onPointerDown);
      }, [controller, pop]);
      if (pop === null) return null;
      const [year, month] = pop.month.split('-').map(Number);
      const first = new Date(year, month - 1, 1);
      const startDow = first.getDay();
      const daysIn = new Date(year, month, 0).getDate();
      const prevDays = new Date(year, month - 1, 0).getDate();
      const today = todayIso();
      const cells = [];
      for (let i = 0; i < 42; i += 1) {
        const dayNumber = i - startDow + 1;
        let date;
        let out = false;
        if (dayNumber < 1) {
          date = new Date(year, month - 2, prevDays + dayNumber);
          out = true;
        } else if (dayNumber > daysIn) {
          date = new Date(year, month, dayNumber - daysIn);
          out = true;
        } else {
          date = new Date(year, month - 1, dayNumber);
        }
        const iso = isoDate(date);
        const edge = iso === pop.from || iso === pop.until;
        const inRange = pop.from !== null && pop.until !== null && iso > pop.from && iso < pop.until;
        cells.push({ iso, label: date.getDate(), out, edge, inRange, today: iso === today });
      }
      return h(
        'div',
        {
          className: 'datepop',
          role: 'dialog',
          'aria-label': t.pickDate,
          style: pop.left === null || pop.left === undefined
            ? undefined
            : { left: `${pop.left}px`, top: `${pop.top}px` },
        },
        h(
          'div',
          { className: 'dp-head' },
          h('button', { type: 'button', 'aria-label': t.prevMonth, onClick: () => controller.shiftMonth(-1) }, '‹'),
          h('span', { className: 'dp-title' }, lang === 'en' ? `${year}-${pad2(month)}` : `${year}年${month}月`),
          h('button', { type: 'button', 'aria-label': t.nextMonth, onClick: () => controller.shiftMonth(1) }, '›'),
        ),
        h(
          'div',
          { className: 'dp-grid' },
          WEEKDAYS[lang].map((weekday, at) => h('span', { key: at, className: 'dp-wd' }, weekday)),
          cells.map((cell) => h(
            'button',
            {
              key: cell.iso,
              type: 'button',
              className: `dp-day ${cell.out ? 'out' : ''} ${cell.today ? 'today' : ''} ${cell.edge ? 'edge' : ''} ${cell.inRange ? 'inrange' : ''}`,
              onClick: () => controller.pickDay(cell.iso),
              'aria-label': formatIsoDate(cell.iso, lang),
            },
            cell.label,
          )),
        ),
        h(
          'div',
          { className: 'dp-foot' },
          h('span', null, pop.which === 'until' ? t.selectUntil : t.selectFrom),
          h(
            'span',
            { style: { display: 'flex', gap: '6px' } },
            h('button', { type: 'button', onClick: () => controller.pickDay(today) }, t.today),
            h('button', { type: 'button', onClick: () => controller.clearDates() }, t.clear),
            h('button', { type: 'button', onClick: () => controller.closeDate() }, t.done),
          ),
        ),
      );
    }

    function Dialog({ controller, state, t, lang }) {
      const dialog = state.dialog;
      if (dialog === null) return null;
      const entry = (state.data?.entries ?? []).find((row) => row.id === dialog.id) ?? state.detail?.entry ?? null;
      const close = () => controller.closeDialog();
      if (dialog.kind === 'archive') {
        return h(
          'div',
          { className: 'modal', role: 'presentation' },
          h(
            'div',
            { className: 'dialog', role: 'dialog', 'aria-modal': 'true' },
            h('h3', null, t.archiveTitle),
            h('p', null, t.archiveText),
            h(
              'div',
              { className: 'acts' },
              h('button', { type: 'button', className: 'btn', onClick: close }, t.cancel),
              h(
                'button',
                {
                  type: 'button',
                  className: 'btn primary danger',
                  onClick: () => {
                    close();
                    void controller.runAction('archive', entry);
                  },
                },
                t.archive,
              ),
            ),
          ),
        );
      }
      if (dialog.kind === 'conflict') {
        return h(
          'div',
          { className: 'modal', role: 'presentation' },
          h(
            'div',
            { className: 'dialog', role: 'dialog', 'aria-modal': 'true' },
            h('h3', null, t.conflictTitle),
            h('p', null, t.conflictText),
            dialog.message ? h('p', { className: 'hint' }, dialog.message) : null,
            h(
              'div',
              { className: 'acts' },
              h('button', { type: 'button', className: 'btn', onClick: close }, t.cancel),
              h('button', { type: 'button', className: 'btn', onClick: () => void controller.resolveConflict('reload') }, t.conflictReload),
              h('button', { type: 'button', className: 'btn primary', onClick: () => void controller.resolveConflict('overwrite') }, t.conflictOverwrite),
            ),
          ),
        );
      }
      if (entry === null) return null;
      const candidates = (state.data?.entries ?? []).filter((row) => row.id !== entry.id
        && row.scope === entry.scope
        && statusOf(row) !== 'archived'
        && (dialog.kind !== 'supersede' || statusOf(row) !== 'superseded'));
      const scopes = (state.data?.scopes ?? []).filter((scope) => scope.key !== entry.scope);
      if (dialog.kind === 'move') {
        return h(
          'div',
          { className: 'modal' },
          h(
            'div',
            { className: 'dialog', role: 'dialog', 'aria-modal': 'true' },
            h('h3', null, t.moveTitle),
            h('p', null, t.moveText),
            h(
              'div',
              { className: 'picklist' },
              scopes.length === 0
                ? h('div', { className: 'hint' }, lang === 'en' ? 'No other scope is registered yet.' : '还没有其它作用域。')
                : scopes.map((scope) => h(
                  'button',
                  {
                    key: scope.key,
                    type: 'button',
                    className: 'pickrow',
                    onClick: () => controller.moveTo(scope.key),
                  },
                  h('span', null, scope.key === 'user' ? 'user' : scope.name),
                  h('span', { className: 'r' }, `${scope.total ?? 0} ${lang === 'en' ? 'entries' : '条'}`),
                )),
            ),
            h(
              'div',
              { className: 'acts' },
              h('button', { type: 'button', className: 'btn', onClick: close }, t.cancel),
            ),
          ),
        );
      }
      return h(
        'div',
        { className: 'modal' },
        h(
          'div',
          { className: 'dialog', role: 'dialog', 'aria-modal': 'true' },
          h('h3', null, t.supersedeTitle),
          h('p', null, t.supersedeText),
          h(
            'div',
            { className: 'picklist' },
            candidates.length === 0
              ? h('div', { className: 'hint' }, lang === 'en' ? 'No other memory in this scope yet.' : '这个作用域里还没有其它记忆。')
              : candidates.map((row) => h(
                'button',
                { key: row.id, type: 'button', className: 'pickrow', onClick: () => controller.supersedeWith(row.id) },
                h('span', null, row.title),
                h('span', { className: 'r' }, formatShort(row.updated)),
              )),
          ),
          h(
            'div',
            { className: 'acts' },
            h('button', { type: 'button', className: 'btn', onClick: close }, t.cancel),
          ),
        ),
      );
    }

    function StatusBar({ controller, state, t, lang }) {
      const stats = indexStats(state);
      const total = state.data?.entries?.length ?? 0;
      const list = visibleEntries(state);
      const filtered = state.query !== '' || Object.values(state.filters).some(Boolean) || state.scope !== null;
      const left = filtered
        ? fill(t.statusBarFiltered, {
          shown: list.length,
          total,
          used: stats.used,
          limit: stats.limit,
          unreviewed: state.data?.unreviewedCount ?? 0,
        })
        : fill(t.statusBar, {
          n: total,
          used: stats.used,
          limit: stats.limit,
          kb: (stats.bytes / 1024).toFixed(1),
          unreviewed: state.data?.unreviewedCount ?? 0,
        });
      const corrupt = corruptRows(state).length;
      const full = stats.limit > 0 && stats.used >= stats.limit;
      return h(
        'div',
        { className: 'statusbar' },
        h(
          'div',
          null,
          full ? h('span', { className: 'sb-warn' }, `${t.indexFull} · `) : null,
          left,
          corrupt > 0 ? h('span', { className: 'sb-warn' }, ` · ${fill(t.corruptRows, { n: corrupt })}`) : null,
        ),
        h(
          'div',
          { className: 'rightish' },
          h('span', null, fill(t.refreshedAt, { time: state.loadedAt === null ? '—' : new Date(state.loadedAt).toTimeString().slice(0, 8) })),
          h('button', { type: 'button', className: 'ghost', style: { height: '22px', padding: '0 7px', fontSize: '10px' }, onClick: () => controller.refresh() }, t.refresh),
        ),
      );
    }

    function Toast({ state, controller, t }) {
      if (state.notice === null) return null;
      return h(
        'div',
        { className: 'toast show' },
        h('span', null, state.notice),
        state.undo === null
          ? null
          : h(
            'button',
            {
              type: 'button',
              className: 'tundo',
              onClick: () => void controller.undo(),
            },
            t.undo,
          ),
      );
    }

    function ErrorBar({ controller, state, t }) {
      if (state.error === null) return null;
      return h(
        'div',
        { className: 'banner', role: 'alert', style: { position: 'absolute', left: '12px', right: '12px', bottom: '38px', zIndex: 60, background: 'var(--danger)', color: '#fff' } },
        h('span', null, `${t.failure}：${state.error}`),
        h(
          'button',
          {
            type: 'button',
            className: 'btn',
            style: { height: '26px', borderColor: 'currentColor', color: 'inherit' },
            onClick: () => {
              controller.patch({ error: null });
              void controller.load();
            },
          },
          t.retry,
        ),
      );
    }

    /* ------------------------------------------------------------------ panel */

    function KiraPanel({ controller, locale, onExit }) {
      const state = useKiraState(controller);
      const lang = useLanguage(locale);
      const t = strings(lang);
      const searchRef = useRef(null);
      const pageRef = useRef(null);
      const rootRef = useRef(null);
      const dragRef = useRef(null);
      const [leftWidth, setLeftWidth] = useState(() => {
        const raw = readStored(LEFT_WIDTH_KEY);
        const value = Number(raw);
        return Number.isFinite(value) && value >= 300 && value <= 560 ? value : null;
      });
      useNarrow(controller);

      const startDrag = (event) => {
        event.preventDefault();
        const current = rootRef.current?.querySelector('.left');
        dragRef.current = { startX: event.clientX, startW: current?.getBoundingClientRect().width ?? 380 };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      };
      const moveDrag = (event) => {
        if (dragRef.current === null) return;
        const next = Math.max(300, Math.min(560, dragRef.current.startW + (event.clientX - dragRef.current.startX)));
        setLeftWidth(next);
      };
      const endDrag = () => {
        if (dragRef.current === null) return;
        dragRef.current = null;
        setLeftWidth((value) => {
          if (value !== null) writeStored(LEFT_WIDTH_KEY, String(Math.round(value)));
          return value;
        });
      };

      useEffect(() => {
        void controller.open();
      }, [controller]);

      const menuAt = (menu) => controller.openMenu(menu);

      useEffect(() => {
        const onKeyDown = (event) => {
          const target = event.target;
          const typing = target instanceof HTMLElement
            && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
          const inside = rootRef.current?.contains(target) ?? false;
          if (event.key === 'Escape') {
            if (state.dialog !== null) {
              event.preventDefault();
              controller.closeDialog();
            } else if (state.datePop !== null) {
              event.preventDefault();
              controller.closeDate();
            } else if (state.menu !== null) {
              event.preventDefault();
              controller.closeMenu();
            } else if (state.editing) {
              event.preventDefault();
              controller.cancelEdit();
            } else if (inside) {
              event.preventDefault();
              onExit?.();
            }
            return;
          }
          if (!inside) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
            if (state.detail !== null && !state.editing) {
              event.preventDefault();
              controller.startEdit();
            }
            return;
          }
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && state.editing) {
            event.preventDefault();
            void controller.saveEdit();
            return;
          }
          if (!typing && event.key === '/') {
            event.preventDefault();
            searchRef.current?.focus();
            return;
          }
          if (!typing && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            const list = visibleEntries(state);
            if (list.length === 0) return;
            event.preventDefault();
            const at = list.findIndex((entry) => entry.id === state.selectedId);
            const next = event.key === 'ArrowDown'
              ? Math.min(list.length - 1, at < 0 ? 0 : at + 1)
              : Math.max(0, at <= 0 ? 0 : at - 1);
            void controller.select(list[next].id);
            return;
          }
          if (!typing && (event.key === 'Home' || event.key === 'End')) {
            const list = visibleEntries(state);
            if (list.length === 0) return;
            event.preventDefault();
            void controller.select(event.key === 'Home' ? list[0].id : list[list.length - 1].id);
            return;
          }
          if (!typing && event.key === 'Enter' && state.detail === null) {
            const list = visibleEntries(state);
            const picked = list.find((entry) => entry.id === state.selectedId) ?? list[0];
            if (picked === undefined) return;
            event.preventDefault();
            void controller.select(picked.id);
            return;
          }
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n' && !state.editing) {
            event.preventDefault();
            controller.startCreate(state.scope ?? 'user');
            return;
          }
          if (event.key === 'F10' && event.shiftKey) {
            const entry = state.detail?.entry;
            if (entry === null || entry === undefined) return;
            event.preventDefault();
            menuAt({ kind: 'file', id: entry.id, x: 60, y: 180 });
            return;
          }
          if (event.altKey && event.key === 'ArrowLeft' && state.narrow) {
            event.preventDefault();
            onExit?.();
          }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
      }, [controller, onExit, state.dialog, state.datePop, state.menu, state.editing, state.detail, state.selectedId]);

      useEffect(() => {
        const onPointerDown = (event) => {
          if (state.menu === null) return;
          // A press inside the menu must not unmount it before its click fires.
          const target = event.target;
          if (target !== null && typeof target.closest === 'function' && target.closest('.ctx') !== null) return;
          controller.closeMenu();
        };
        window.addEventListener('pointerdown', onPointerDown);
        return () => window.removeEventListener('pointerdown', onPointerDown);
      }, [controller, state.menu]);

      const dialog = state.dialog;
      return h(
        'div',
        { className: 'kira-page', ref: rootRef },
        h(
          'div',
          { className: 'kira-panel', 'data-theme': state.theme, 'data-narrow': state.narrow ? 'true' : 'false' },
          h(Cover, { controller, state, lang, t, onExit }),
          h(
            'div',
            { className: 'notebook' },
            h(LeftColumn, { controller, state, t, lang, searchRef, onMenu: menuAt, width: state.narrow ? null : leftWidth }),
            h('button', {
              type: 'button',
              className: 'splitter',
              'aria-label': t.dirs,
              tabIndex: -1,
              onPointerDown: startDrag,
              onPointerMove: moveDrag,
              onPointerUp: endDrag,
              onPointerCancel: endDrag,
            }),
            h(
              'section',
              { className: 'right', 'aria-label': t.title },
              state.tab === 'journal'
                ? h(JournalPage, { state, t, lang })
                : state.editing
                  ? h(EditPage, { controller, state, t, lang, detailRef: pageRef })
                  : h(ReadPage, { controller, state, t, lang, detailRef: pageRef }),
            ),
          ),
          h(StatusBar, { controller, state, t, lang }),
          h(CtxMenu, { controller, state, t, lang }),
          h(DatePop, { controller, state, t, lang }),
          h(Dialog, { controller, state, t, lang }),
          h(Toast, { state, controller, t }),
          h(ErrorBar, { controller, state, t }),
          state.loading && state.data === null ? h('div', { className: 'loading-veil' }, t.loading) : null,
        ),
      );
    }

    /** The sidebar row: the owner draws the button, tooltip and active state. */
    function PanelIcon({ size = 20, active = false, controller, locale }) {
      const state = useKiraState(controller);
      useLanguage(locale);
      const count = state.data?.unreviewedCount ?? 0;
      useEffect(() => {
        void controller.open();
      }, [controller]);
      // The owner re-renders with `active` on panel switches; that is the natural refresh point.
      useEffect(() => {
        if (active) void controller.load();
      }, [active, controller]);
      return h(
        'span',
        {
          className: 'kira-nav',
          'data-active': active ? 'true' : 'false',
          'data-badge': count > 0 ? 'true' : 'false',
          style: { width: `${size}px`, height: `${size}px` },
        },
        h(DiaryIcon, { size: Math.max(16, size) }),
        count > 0 ? h('span', { className: 'kira-nav-dot' }) : null,
      );
    }

    const NavButton = PanelIcon;
    const Panel = KiraPanel;
