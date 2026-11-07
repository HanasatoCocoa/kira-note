    /* ---------------------------------------------------------------- helpers */

    const ENCODER = typeof TextEncoder === 'function' ? new TextEncoder() : null;

    function byteLength(text) {
      const value = String(text ?? '');
      return ENCODER === null ? value.length * 2 : ENCODER.encode(value).length;
    }

    const pad2 = (n) => String(n).padStart(2, '0');

    function parseIso(value) {
      const text = String(value ?? '');
      const date = new Date(text);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    /** `15:48` for today, `11-06 09:30` this year, `—` for a row without a stamp. */
    function formatShort(value, lang) {
      const date = parseIso(value);
      if (date === null) {
        const text = String(value ?? '').trim();
        return text === '' ? '—' : text;
      }
      const now = new Date();
      const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
      if (date.toDateString() === now.toDateString()) return clock;
      if (date.getFullYear() === now.getFullYear()) return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${clock}`;
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    }

    /** `11月7日 · 周六 · 15:48` above the title. */
    function formatDateline(value, lang) {
      const date = parseIso(value);
      if (date === null) return String(value ?? '');
      const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
      if (lang === 'en') {
        const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getMonth()];
        const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
        return `${month} ${date.getDate()} · ${weekday} · ${clock}`;
      }
      const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
      return `${date.getMonth() + 1}月${date.getDate()}日 · ${weekday} · ${clock}`;
    }

    function isoDate(date) {
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    }

    function todayIso() {
      return isoDate(new Date());
    }

    function formatIsoDate(value, lang) {
      if (!value) return '';
      const text = String(value).slice(0, 10);
      const [y, m, d] = text.split('-').map(Number);
      if (!y || !m || !d) return text;
      return lang === 'en' ? `${y}-${pad2(m)}-${pad2(d)}` : `${y}年${m}月${d}日`;
    }

    function validityText(entry, lang) {
      if (!entry.valid_until && !entry.valid_from) return lang === 'en' ? 'Always valid' : '长期有效';
      const from = entry.valid_from ? formatIsoDate(entry.valid_from, lang) : (lang === 'en' ? 'no start' : '未设开始');
      const until = entry.valid_until ? formatIsoDate(entry.valid_until, lang) : (lang === 'en' ? 'no end' : '不设结束');
      return `${from} ${lang === 'en' ? 'to' : '至'} ${until}`;
    }

    function statusOf(entry) {
      return entry.computedStatus ?? entry.status ?? 'active';
    }

    function canEdit(entry) {
      const status = statusOf(entry);
      return entry !== null && (status === 'active' || status === 'expired');
    }

    /** Mirrors lib/format.js formatIndexLine: summary first, title as the fallback. */
    function indexLineOf(entry) {
      const triggers = (entry.triggers ?? []).slice(0, INDEX_TRIGGER_LIMIT).join('、');
      const tail = triggers === '' ? '' : `｜触发:${triggers}`;
      const summary = String(entry.summary ?? '').trim() || String(entry.title ?? '').trim() || entry.id;
      return `- [${entry.id}] ${summary}${tail}｜类型:${entry.type}`;
    }

    function countOr(value, fallback = 0) {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    }

    function scopeNameOf(state, scopeKey) {
      if (scopeKey === 'user') return 'user';
      const row = (state.data?.scopes ?? []).find((scope) => scope.key === scopeKey);
      return row?.name ?? scopeKey;
    }

    function statusLabelOf(lang, entry) {
      return STATUS_LABELS[lang]?.[statusOf(entry)] ?? statusOf(entry);
    }

    function typeLabelOf(lang, type) {
      return TYPE_LABELS[lang]?.[type] ?? type;
    }

    /** One folder = the personal scope plus every registered project. */
    function folderRows(state, lang) {
      const byScope = new Map();
      for (const entry of state.data?.entries ?? []) {
        const list = byScope.get(entry.scope) ?? [];
        list.push(entry);
        byScope.set(entry.scope, list);
      }
      const scopes = state.data?.scopes ?? [];
      const personal = scopes.find((scope) => scope.key === 'user') ?? { key: 'user', name: 'user', kind: 'user' };
      const projects = scopes.filter((scope) => scope.kind !== 'user');
      const rows = [
        {
          key: 'user',
          name: 'user',
          count: (byScope.get('user') ?? []).length,
          unreviewed: (byScope.get('user') ?? []).filter((entry) => !entry.reviewed && statusOf(entry) !== 'archived').length,
          depth: 0,
          group: false,
        },
        {
          key: PROJECTS_GROUP,
          name: lang === 'en' ? 'Projects' : '项目',
          count: projects.reduce((sum, scope) => sum + (byScope.get(scope.key) ?? []).length, 0),
          unreviewed: projects.reduce(
            (sum, scope) => sum + (byScope.get(scope.key) ?? []).filter((entry) => !entry.reviewed && statusOf(entry) !== 'archived').length,
            0,
          ),
          depth: 0,
          group: true,
        },
      ];
      if (state.openProjects) {
        for (const scope of projects) {
          rows.push({
            key: scope.key,
            name: scope.name ?? scope.key,
            count: (byScope.get(scope.key) ?? []).length,
            unreviewed: (byScope.get(scope.key) ?? []).filter((entry) => !entry.reviewed && statusOf(entry) !== 'archived').length,
            depth: 1,
            group: false,
          });
        }
      }
      return { rows, personal, projects };
    }

    function visibleEntries(state) {
      let list = [...(state.data?.entries ?? [])];
      if (state.scope !== null) list = list.filter((entry) => entry.scope === state.scope);
      if (state.query !== '') {
        const needle = state.query.toLowerCase();
        list = list.filter((entry) => {
          // Both labels are searchable regardless of the active language, so a query
          // typed in Chinese still finds English-UI entries and vice versa.
          const haystack = [
            entry.title,
            entry.summary,
            (entry.triggers ?? []).join(' '),
            typeLabelOf('zh', entry.type),
            typeLabelOf('en', entry.type),
            entry.type,
            entry.id,
          ]
            .join(' ')
            .toLowerCase();
          return haystack.includes(needle);
        });
      }
      if (state.filters.unreviewed) list = list.filter((entry) => !entry.reviewed);
      if (state.filters.pinned) list = list.filter((entry) => entry.pinned);
      if (!state.filters.archived) list = list.filter((entry) => statusOf(entry) !== 'archived');
      list.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (state.sort === 'created') return String(b.created ?? '').localeCompare(String(a.created ?? ''));
        if (state.sort === 'title') return String(a.title).localeCompare(String(b.title), 'zh');
        return String(b.updated ?? '').localeCompare(String(a.updated ?? ''));
      });
      return list;
    }

    function entriesOfScope(state, scopeKey) {
      return (state.data?.entries ?? []).filter((entry) => (scopeKey === null ? true : entry.scope === scopeKey));
    }

    /**
     * Index occupancy, measured on what actually entered the 200-line index per
     * scope (backend `index.included` / `index.bytes`), not on every eligible row.
     */
    function indexStats(state) {
      const scopes = state.data?.scopes ?? [];
      const limit = 200 * Math.max(1, scopes.length);
      const used = scopes.reduce((sum, scope) => sum + countOr(scope.index?.included), 0);
      const eligible = scopes.reduce((sum, scope) => sum + countOr(scope.index?.total), 0);
      const bytes = scopes.reduce((sum, scope) => sum + countOr(scope.index?.bytes), 0);
      return { used, limit, bytes, eligible, scopes: scopes.length };
    }

    function corruptRows(state) {
      return Array.isArray(state.data?.corrupt) ? state.data.corrupt : [];
    }

    function eventLabel(lang, action) {
      const zh = {
        create: '创建',
        'update.title': '改标题',
        'update.summary': '改简介',
        'update.type': '改类型',
        'update.triggers': '改触发词',
        'update.body': '改正文',
        'update.validity': '改有效期',
        supersede: '标记取代',
        expire: '置为过期',
        archive: '归档',
        restore: '恢复',
        pin: '置顶',
        unpin: '取消置顶',
        review: '标记审阅',
        move: '移动归属',
      };
      const en = {
        create: 'Created',
        'update.title': 'Title',
        'update.summary': 'Summary',
        'update.type': 'Type',
        'update.triggers': 'Triggers',
        'update.body': 'Body',
        'update.validity': 'Validity',
        supersede: 'Superseded',
        expire: 'Expired',
        archive: 'Archived',
        restore: 'Restored',
        pin: 'Pinned',
        unpin: 'Unpinned',
        review: 'Reviewed',
        move: 'Moved',
      };
      const table = lang === 'en' ? en : zh;
      return table[action] ?? action;
    }

    function actorLabel(lang, actor) {
      if (lang === 'en') return actor === 'model' ? 'Model' : 'You';
      return actor === 'model' ? '模型' : '用户';
    }

    function copyText(text, onDone) {
      const fallback = () => {
        try {
          const area = document.createElement('textarea');
          area.value = text;
          area.setAttribute('readonly', '');
          area.style.position = 'fixed';
          area.style.opacity = '0';
          document.body.append(area);
          area.select();
          document.execCommand('copy');
          area.remove();
        } catch {
          // Copying is a convenience; failing silently keeps the panel usable.
        }
        onDone();
      };
      try {
        const clipboard = navigator.clipboard;
        if (clipboard && typeof clipboard.writeText === 'function') {
          clipboard.writeText(text).then(onDone, fallback);
          return;
        }
      } catch {
        // Fall through to the textarea route.
      }
      fallback();
    }

    /* -------------------------------------------------------------------- api */

    class Api {
      constructor(remote) {
        this.remote = remote;
      }

      async call(method, request = {}) {
        const result = await this.remote[method](request);
        if (!result || result.ok !== true) {
          const message = result?.error?.message ?? `${method} failed`;
          throw new Error(message);
        }
        const payload = JSON.parse(result.value);
        if (!payload.ok) {
          const error = new Error(payload.errorMessage ?? payload.errorCode ?? `${method} failed`);
          error.code = payload.errorCode;
          throw error;
        }
        return payload.value;
      }

      snapshot() {
        return this.call('snapshot', {});
      }

      detail(id) {
        return this.call('detail', { id });
      }

      update(request) {
        return this.call('update', request);
      }

      status(id, action, newId) {
        return this.call('status', { id, action, new_id: newId });
      }

      write(request) {
        return this.call('write', request);
      }

      move(id, targetScope) {
        return this.call('move', { id, targetScope });
      }

      journal(limit = 60) {
        return this.call('injectionLog', { limit });
      }
    }

    /* ------------------------------------------------------------- controller */

    const EMPTY_FILTERS = { unreviewed: false, pinned: false, archived: false };

    /** Status changes a human can take back within a few seconds. */
    const UNDO_ACTIONS = { archive: 'restore', restore: 'archive', pin: 'unpin', unpin: 'pin', expire: 'restore' };
    const UNDO_WINDOW_MS = 5000;

    class Controller {
      constructor(api) {
        this.api = api;
        this.state = {
          loading: true,
          busy: false,
          error: null,
          notice: null,
          data: null,
          detail: null,
          tab: 'mem',
          scope: null,
          query: '',
          sort: 'updated',
          filters: { ...EMPTY_FILTERS },
          openProjects: true,
          colors: storedColors(),
          theme: readStored(THEME_KEY) === 'night' ? 'night' : 'day',
          selectedId: null,
          creating: false,
          editing: false,
          draft: null,
          errors: {},
          menu: null,
          datePop: null,
          dialog: null,
          undo: null,
          journal: null,
          narrow: false,
          loadedAt: null,
        };
        this.listeners = new Set();
        this.noticeTimer = null;
        this.undoTimer = null;
        this.unloaded = false;
      }

      get() {
        return this.state;
      }

      subscribe(listener) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
      }

      patch(changes) {
        if (this.unloaded) return;
        this.state = { ...this.state, ...changes };
        for (const listener of this.listeners) listener();
      }

      close() {
        this.unloaded = true;
        clearTimeout(this.noticeTimer);
        this.listeners.clear();
      }

      notice(text) {
        clearTimeout(this.noticeTimer);
        this.patch({ notice: text });
        this.noticeTimer = setTimeout(() => {
          if (!this.unloaded) this.patch({ notice: null });
        }, 2600);
      }

      async open() {
        if (this.state.data !== null || this.state.loading === false) return;
        await this.load();
      }

      async load() {
        this.patch({ loading: true, error: null });
        try {
          const data = await this.api.snapshot();
          const visible = visibleEntries({ ...this.state, data, filters: EMPTY_FILTERS, query: '', scope: null });
          let selectedId = this.state.selectedId;
          if (selectedId === null || !data.entries.some((entry) => entry.id === selectedId)) {
            selectedId = visible[0]?.id ?? data.entries[0]?.id ?? null;
          }
          this.patch({ data, loading: false, selectedId, loadedAt: Date.now() });
          if (selectedId !== null) await this.loadDetail(selectedId);
          if (this.state.tab === 'journal') await this.loadJournal();
        } catch (error) {
          this.patch({ loading: false, error: error.message });
        }
      }

      async refresh() {
        await this.load();
        this.notice(fill(STRINGS[readLanguageSafe()].refreshedToast, { time: this.clockText() }));
      }

      clockText() {
        const now = new Date();
        return `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
      }

      async select(id) {
        if (id === this.state.selectedId && this.state.detail !== null) return;
        this.patch({ selectedId: id, editing: false, draft: null, errors: {}, datePop: null, menu: null });
        await this.loadDetail(id);
      }

      async loadDetail(id) {
        try {
          const detail = await this.api.detail(id);
          if (this.state.selectedId === id) this.patch({ detail });
        } catch (error) {
          this.patch({ error: error.message });
        }
      }

      setScope(scope) {
        const nextScope = scope === this.state.scope ? this.state.scope : scope;
        const list = visibleEntries({ ...this.state, scope: nextScope });
        const selectedId = list.some((entry) => entry.id === this.state.selectedId) ? this.state.selectedId : (list[0]?.id ?? null);
        this.patch({ scope: nextScope, selectedId, editing: false, draft: null, detail: selectedId === this.state.selectedId ? this.state.detail : null });
        if (selectedId !== null && selectedId !== this.state.selectedId) void this.loadDetail(selectedId);
      }

      toggleProjects() {
        this.patch({ openProjects: !this.state.openProjects });
      }

      setQuery(query) {
        this.patch({ query });
      }

      setSort() {
        const order = ['updated', 'created', 'title'];
        const next = order[(order.indexOf(this.state.sort) + 1) % order.length];
        this.patch({ sort: next });
      }

      setFilter(key, value) {
        this.patch({ filters: { ...this.state.filters, [key]: value } });
      }

      clearFilters() {
        this.patch({ filters: { ...EMPTY_FILTERS } });
        this.notice(STRINGS[readLanguageSafe()].clearedToast);
      }

      setTab(tab) {
        if (tab === this.state.tab) return;
        if (tab === 'review') {
          this.patch({ tab, scope: null, filters: { ...EMPTY_FILTERS, unreviewed: true }, editing: false, draft: null });
          const count = (this.state.data?.entries ?? []).filter((entry) => !entry.reviewed && statusOf(entry) !== 'archived').length;
          this.notice(fill(STRINGS[readLanguageSafe()].reviewQueue, { n: count }));
          return;
        }
        this.patch({ tab, filters: tab === 'mem' ? { ...EMPTY_FILTERS } : this.state.filters, editing: false, draft: null });
        if (tab === 'journal') void this.loadJournal();
      }

      async loadJournal() {
        try {
          const journal = await this.api.journal(80);
          this.patch({ journal });
        } catch (error) {
          this.patch({ error: error.message });
        }
      }

      setTheme(theme) {
        writeStored(THEME_KEY, theme);
        this.patch({ theme });
      }

      setColor(scope, color) {
        const colors = { ...this.state.colors };
        if (color === null || color === undefined) delete colors[scope];
        else colors[scope] = color;
        writeStored(COLOR_KEY, JSON.stringify(colors));
        this.patch({ colors });
      }

      setNarrow(narrow) {
        if (narrow !== this.state.narrow) this.patch({ narrow });
      }

      openMenu(menu) {
        this.patch({ menu });
      }

      closeMenu() {
        if (this.state.menu !== null) this.patch({ menu: null });
      }

      openDialog(dialog) {
        this.patch({ dialog, menu: null });
      }

      closeDialog() {
        if (this.state.dialog !== null) this.patch({ dialog: null });
      }

      /* ------------------------------------------------------------- editing */

      startEdit() {
        const entry = this.state.detail?.entry;
        if (!entry || !canEdit(entry)) return;
        const draft = {
          title: entry.title,
          summary: entry.summary ?? '',
          type: entry.type,
          triggers: [...(entry.triggers ?? [])],
          body: entry.body,
          currentlyValid: !entry.valid_until,
          validFrom: entry.valid_from ? String(entry.valid_from).slice(0, 10) : null,
          validUntil: entry.valid_until ? String(entry.valid_until).slice(0, 10) : null,
        };
        this.patch({ editing: true, creating: false, draft, errors: {}, menu: null });
      }

      /** The panel is the only place a human can create an entry: the Host tools are model-only. */
      startCreate(scope = this.state.scope ?? 'user') {
        const draft = {
          title: '',
          summary: '',
          type: 'project-decision',
          triggers: [],
          body: '',
          currentlyValid: true,
          validFrom: null,
          validUntil: null,
        };
        this.patch({
          editing: true,
          creating: true,
          draft,
          errors: {},
          menu: null,
          dialog: null,
          detail: null,
          scope,
          tab: 'mem',
          filters: { ...EMPTY_FILTERS, archived: this.state.filters.archived },
        });
      }

      cancelEdit() {
        this.patch({ editing: false, draft: null, errors: {}, datePop: null, menu: null });
      }

      patchDraft(changes) {
        if (this.state.draft === null) return;
        this.patch({ draft: { ...this.state.draft, ...changes } });
      }

      addTrigger(value) {
        const text = String(value ?? '').trim();
        if (text === '' || this.state.draft === null) return;
        if (this.state.draft.triggers.includes(text) || this.state.draft.triggers.length >= TRIGGER_LIMIT) return;
        this.patchDraft({ triggers: [...this.state.draft.triggers, text] });
      }

      removeTrigger(index) {
        if (this.state.draft === null) return;
        this.patchDraft({ triggers: this.state.draft.triggers.filter((_, at) => at !== index) });
      }

      /** Opening the calendar seeds `from` with today when validity is switched off. */
      toggleCurrentlyValid(currentlyValid) {
        if (this.state.draft === null) return;
        this.patchDraft({ currentlyValid });
        if (!currentlyValid && this.state.draft.validFrom === null) {
          this.patchDraft({ validFrom: todayIso() });
        }
      }

      /** `anchor` is the trigger button's rect so the fixed-position calendar can sit under it. */
      openDate(which, anchor = null) {
        const draft = this.state.draft;
        if (draft === null) return;
        const base = which === 'from' ? draft.validFrom : draft.validUntil;
        const date = parseIso(base ? `${base}T00:00:00` : '') ?? new Date();
        const popWidth = 266;
        const popHeight = 330;
        const rect = anchor ?? null;
        const left = rect === null ? null : Math.max(8, Math.min(rect.left, window.innerWidth - popWidth - 8));
        const below = rect === null ? null : rect.bottom + 6;
        const top = below === null ? null : (below + popHeight > window.innerHeight ? Math.max(8, rect.top - popHeight - 6) : below);
        this.patch({
          datePop: {
            which,
            from: draft.validFrom,
            until: draft.validUntil,
            month: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`,
            left,
            top,
          },
        });
      }

      shiftMonth(delta) {
        const pop = this.state.datePop;
        if (pop === null) return;
        const [year, month] = pop.month.split('-').map(Number);
        const date = new Date(year, month - 1 + delta, 1);
        this.patch({ datePop: { ...pop, month: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}` } });
      }

      pickDay(iso) {
        const pop = this.state.datePop;
        if (pop === null || this.state.draft === null) return;
        let from = pop.from;
        let until = pop.until;
        let which = pop.which;
        if (which === 'until' && from !== null) {
          if (iso < from) {
            until = from;
            from = iso;
          } else {
            until = iso;
          }
        } else {
          from = iso;
          if (until !== null && until < iso) until = null;
          which = 'until';
        }
        this.patch({ datePop: { ...pop, from, until, which } });
      }

      clearDates() {
        const pop = this.state.datePop;
        if (pop === null) return;
        this.patch({ datePop: { ...pop, from: null, until: null, which: 'from' } });
      }

      closeDate() {
        if (this.state.datePop === null) return;
        const pop = this.state.datePop;
        this.patch({ datePop: null });
        if (this.state.draft !== null && (pop.from !== this.state.draft.validFrom || pop.until !== this.state.draft.validUntil)) {
          this.patchDraft({ validFrom: pop.from, validUntil: pop.until });
        }
      }

      async saveEdit(force = false) {
        if (this.state.busy) return;
        const draft = this.state.draft;
        const creating = this.state.creating === true;
        const detail = this.state.detail;
        if (draft === null) return;
        if (!creating && detail === null) return;

        const title = String(draft.title ?? '').trim();
        const summary = String(draft.summary ?? '').trim();
        const body = String(draft.body ?? '').trim();
        const errors = {};
        if (title === '' || [...title].length > TITLE_LIMIT) errors.title = true;
        if (summary === '' || [...summary].length > SUMMARY_LIMIT) errors.summary = true;
        if (body === '') errors.body = true;
        const from = draft.validFrom;
        const until = draft.validUntil;
        if (!draft.currentlyValid && (from === null || until === null || until < from)) errors.validity = true;
        if (Object.keys(errors).length > 0) {
          this.patch({ errors });
          return;
        }

        const payload = {
          title,
          summary,
          type: draft.type,
          triggers: draft.triggers,
          body,
          valid_from: draft.currentlyValid ? todayIso() : from,
          valid_until: draft.currentlyValid ? null : until,
        };
        const lang = readLanguageSafe();
        const t = STRINGS[lang];

        this.patch({ busy: true, errors: {}, dialog: null });
        try {
          if (creating) {
            const result = await this.api.write({ ...payload, scope: this.state.scope === null ? 'user' : this.state.scope });
            const id = result?.id ?? result?.entry?.id ?? null;
            this.patch({ busy: false, creating: false, editing: false, draft: null, datePop: null });
            this.notice(t.createdToast ?? t.saved);
            await this.load();
            if (id !== null) await this.select(id);
            return;
          }
          let expectedUpdated = detail.entry.updated;
          if (force) {
            const fresh = await this.api.detail(detail.entry.id);
            expectedUpdated = fresh.entry.updated;
          }
          const result = await this.api.update({ ...payload, id: detail.entry.id, expectedUpdated });
          this.patch({ busy: false, editing: false, draft: null, datePop: null });
          if (result.changed === false) {
            this.notice(t.noChange);
          } else {
            this.notice(fill(t.saved, { n: result.events?.length ?? 1 }));
          }
          await this.load();
        } catch (error) {
          if (error.code === 'CONFLICT') {
            this.patch({ busy: false, dialog: { kind: 'conflict', message: error.message } });
            return;
          }
          this.patch({ busy: false, error: error.message });
        }
      }

      /* ------------------------------------------------------------- actions */

      async runAction(action, entry = this.state.detail?.entry ?? null) {
        if (entry === null || this.state.busy) return;
        const lang = readLanguageSafe();
        const t = STRINGS[lang];
        this.patch({ busy: true, menu: null });
        try {
          if (action === 'archive') {
            await this.api.status(entry.id, 'archive');
            this.notice(t.archivedToast);
          } else if (action === 'restore') {
            await this.api.status(entry.id, 'restore');
            this.notice(t.restoredToast);
          } else if (action === 'pin') {
            await this.api.status(entry.id, 'pin');
            this.notice(t.pinnedToast);
          } else if (action === 'unpin') {
            await this.api.status(entry.id, 'unpin');
            this.notice(t.unpinnedToast);
          } else if (action === 'review') {
            await this.api.status(entry.id, 'review');
            this.notice(t.reviewedToast);
          } else if (action === 'expire') {
            await this.api.status(entry.id, 'expire');
            this.notice(t.expiredToast ?? t.expire);
          }
          this.patch({ busy: false });
          const inverse = UNDO_ACTIONS[action];
          if (inverse !== undefined) this.armUndo(entry.id, inverse, t);
          await this.load();
        } catch (error) {
          this.patch({ busy: false, error: error.message });
        }
      }

      /** Five seconds to take back an accidental status change; the journal keeps both events. */
      armUndo(id, action, t) {
        if (this.undoTimer !== null) clearTimeout(this.undoTimer);
        this.patch({ undo: { id, action, at: Date.now() } });
        this.undoTimer = setTimeout(() => {
          this.undoTimer = null;
          if (this.state.undo !== null) this.patch({ undo: null });
        }, UNDO_WINDOW_MS);
      }

      async undo() {
        const undo = this.state.undo;
        if (undo === null || this.state.busy) return;
        const t = STRINGS[readLanguageSafe()];
        if (Date.now() - undo.at > UNDO_WINDOW_MS) {
          this.patch({ undo: null });
          this.notice(t.undoExpired);
          return;
        }
        if (this.undoTimer !== null) clearTimeout(this.undoTimer);
        this.undoTimer = null;
        this.patch({ busy: true, undo: null });
        try {
          await this.api.status(undo.id, undo.action);
          this.patch({ busy: false });
          this.notice(t.undoDone);
          await this.load();
        } catch (error) {
          this.patch({ busy: false, error: error.message });
        }
      }

      /** `reload` drops the draft and takes the server copy; `overwrite` re-reads the stamp and saves the draft. */
      async resolveConflict(mode) {
        const dialog = this.state.dialog;
        if (dialog === null || dialog.kind !== 'conflict' || this.state.busy) return;
        const id = this.state.detail?.entry?.id ?? null;
        if (mode === 'reload') {
          this.patch({ dialog: null, editing: false, draft: null });
          await this.load();
          if (id !== null) await this.select(id);
          return;
        }
        this.patch({ dialog: null });
        await this.saveEdit(true);
      }

      async moveTo(targetScope) {
        const entry = this.state.detail?.entry;
        if (!entry || this.state.busy) return;
        this.patch({ busy: true, dialog: null });
        try {
          await this.api.move(entry.id, targetScope);
          this.patch({ busy: false, scope: targetScope });
          await this.load();
        } catch (error) {
          this.patch({ busy: false, error: error.message });
        }
      }

      async supersedeWith(newId) {
        const entry = this.state.detail?.entry;
        if (!entry || this.state.busy || !newId) return;
        this.patch({ busy: true, dialog: null });
        try {
          await this.api.status(entry.id, 'supersede', newId);
          this.patch({ busy: false });
          await this.load();
        } catch (error) {
          this.patch({ busy: false, error: error.message });
        }
      }
    }

    function readLanguageSafe() {
      return CURRENT_LANG === 'en' ? 'en' : 'zh';
    }

    let CURRENT_LANG = 'zh';

    /* ------------------------------------------------------------------ hooks */

    function useKiraState(controller) {
      const [state, setState] = useState(controller.get());
      useEffect(() => {
        setState(controller.get());
        return controller.subscribe(() => setState(controller.get()));
      }, [controller]);
      return state;
    }

    /** Reads the active locale without hooks; used by slot labels and toasts. */
    function readLanguage(locale) {
      try {
        const snapshot = locale?.getSnapshot?.();
        const active = snapshot?.active ?? snapshot?.locale ?? 'zh';
        return String(active).toLowerCase().startsWith('en') ? 'en' : 'zh';
      } catch {
        return 'zh';
      }
    }

    function useLanguage(locale) {
      const read = () => {
        CURRENT_LANG = readLanguage(locale);
        return CURRENT_LANG;
      };
      const [lang, setLang] = useState(read);
      useEffect(() => {
        let stop = null;
        try {
          stop = locale?.subscribe?.(() => setLang(read()));
        } catch {
          stop = null;
        }
        setLang(read());
        return () => { if (typeof stop === 'function') stop(); };
      }, [locale]);
      return lang;
    }

    function useNarrow(controller) {
      useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
        const query = window.matchMedia('(max-width: 720px)');
        const sync = () => controller.setNarrow(query.matches);
        sync();
        query.addEventListener('change', sync);
        return () => { query.removeEventListener('change', sync); };
      }, [controller]);
    }

    function strings(lang) {
      return STRINGS[lang] ?? STRINGS.zh;
    }
