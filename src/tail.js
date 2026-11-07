    /* -------------------------------------------------------------------- rpc */

    function codec(typeSymbol) {
      const schema = { parse: (value) => value };
      return {
        mode: 'strict',
        typeSymbol,
        create: () => schema,
        get schema() {
          return schema;
        },
      };
    }

    function descriptor(method, implementation) {
      const request = {
        name: 'request',
        wire: 'request',
        source: 'json',
        acceptsUndefined: true,
        codec: codec(`${PACKAGE}#${implementation}/request`),
      };
      return {
        id: `${PACKAGE}#kiraNote/${method}`,
        service: 'kiraNote',
        namespace: 'kiraNote',
        method,
        implementation,
        invocation: { kind: 'direct' },
        parameters: [request],
        result: codec(`${PACKAGE}#${implementation}/result`),
      };
    }

    const METHODS = [
      ['snapshot', 'remoteSnapshot'],
      ['detail', 'remoteDetail'],
      ['write', 'remoteWrite'],
      ['update', 'remoteUpdate'],
      ['status', 'remoteStatus'],
      ['move', 'remoteMove'],
      ['injectionLog', 'remoteInjectionLog'],
    ];

    const TYPERT_REMOTE = {
      package: PACKAGE,
      descriptors: METHODS.map(([method, implementation]) => descriptor(method, implementation)),
    };

    /* ------------------------------------------------------------------ mount */

    async function apply(ctx) {
      const remoteService = ctx.get('remote');
      const locale = ctx.get('locale');
      const layout = ctx.get('layout');
      if (remoteService === undefined || typeof remoteService.$mount !== 'function') {
        throw new Error('kira-note needs the @deepseek-ai/dsh-api-remotes client service');
      }
      const unmountRemote = await remoteService.$mount(TYPERT_REMOTE);

      ctx.effect(() => {
        let element = document.getElementById(STYLE_ID);
        if (element === null) {
          element = document.createElement('style');
          element.id = STYLE_ID;
          document.head.appendChild(element);
        }
        element.textContent = STYLES;
        return () => {
          const current = document.getElementById(STYLE_ID);
          if (current !== null) current.remove();
        };
      });

      ctx.inject(['remote.kiraNote', 'slots'], (remoteCtx) => {
        const mounted = remoteCtx.get('remote');
        const api = new Api(mounted.kiraNote);
        const controller = new Controller(api);
        const slots = remoteCtx.get('slots');
        const exitToConversation = () => {
          try {
            layout?.selectPanel?.('conversation');
          } catch {
            /* the layout service may be gone while the shell shuts down */
          }
        };

        slots.inject('main', () => slots.register(
          { name: 'main', key: PACKAGE },
          (props) => h(KiraPanel, { ...props, controller, locale, onExit: exitToConversation }),
        ));

        slots.inject('sidebar.panellist', () => slots.register(
          {
            name: 'sidebar.panellist',
            id: PACKAGE,
            order: 12,
            label: () => strings(readLanguage(locale)).title,
          },
          (props) => h(PanelIcon, { ...props, controller, locale }),
        ));
      });

      return async () => {
        await unmountRemote();
      };
    }

    return {
      inject: ['slots', 'locale', 'remote'],
      apply,
      KiraPanel,
      PanelIcon,
      Panel: KiraPanel,
      NavButton: PanelIcon,
      strings,
    };
  },
});
