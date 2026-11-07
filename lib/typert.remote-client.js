/**
 * Kira Note — Client Typert contribution.
 *
 * `remote.$mount(TYPERT_REMOTE)` installs the `kiraNote` namespace on the client
 * `remote` service. The descriptors mirror `./typert.host.js`; the browser bundle
 * cannot import that module, so the shapes are repeated here by hand.
 */

const PACKAGE = 'kira-note';

function codec(typeSymbol, parse = (value) => value) {
  const schema = { parse };
  const create = () => schema;
  return { mode: 'strict', typeSymbol, create, get schema() { return schema; } };
}

function descriptor(method, implementation) {
  const typeSymbol = `${PACKAGE}#${method}`;
  return {
    id: `${PACKAGE}#kiraNote/${method}`,
    service: 'kiraNote',
    namespace: 'kiraNote',
    method,
    implementation,
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'request',
        wire: 'request',
        source: 'json',
        acceptsUndefined: true,
        codec: codec(`${typeSymbol}/request`, (value) => (value === undefined ? {} : value)),
      },
    ],
    result: codec(`${typeSymbol}/result`),
  };
}

export const TYPERT_REMOTE = {
  package: PACKAGE,
  descriptors: [
    descriptor('snapshot', 'remoteSnapshot'),
    descriptor('detail', 'remoteDetail'),
    descriptor('write', 'remoteWrite'),
    descriptor('update', 'remoteUpdate'),
    descriptor('status', 'remoteStatus'),
    descriptor('move', 'remoteMove'),
    descriptor('injectionLog', 'remoteInjectionLog'),
  ],
};

export default TYPERT_REMOTE;
