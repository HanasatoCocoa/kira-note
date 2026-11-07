/**
 * Kira Note — Host Typert manifest.
 *
 * The Loader reads this from `package.json`'s `./typert` export and hands it to
 * `ctx.typert.register`. Every surface the Web panel calls is declared here; the
 * panel's own copy lives in `./lib/client.js` (it cannot import this module, the
 * browser bundle only has React).
 *
 * Each invocation takes one JSON request object and answers one JSON string, so
 * a strict codec only has to accept any JSON value — the panel validates shapes
 * itself and the Host answers `{ok:false,...}` instead of throwing.
 */

const PACKAGE = 'kira-note';

/** A strict codec needs `create()`; the schema it returns only needs `parse`. */
function codec(typeSymbol, parse = (value) => value) {
  const schema = { parse };
  const create = () => schema;
  return { mode: 'strict', typeSymbol, create, get schema() { return schema; } };
}

function request(typeSymbol) {
  return {
    name: 'request',
    wire: 'request',
    source: 'json',
    acceptsUndefined: true,
    codec: codec(typeSymbol, (value) => (value === undefined ? {} : value)),
  };
}

function invocation(method, implementation) {
  const typeSymbol = `${PACKAGE}#${method}`;
  return {
    id: `${PACKAGE}#kiraNote/${method}`,
    service: 'kiraNote',
    namespace: 'kiraNote',
    method,
    implementation,
    invocation: { kind: 'direct' },
    parameters: [request(`${typeSymbol}/request`)],
    result: codec(`${typeSymbol}/result`),
  };
}

export const TYPERT = {
  package: PACKAGE,
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: [
    invocation('snapshot', 'remoteSnapshot'),
    invocation('detail', 'remoteDetail'),
    invocation('write', 'remoteWrite'),
    invocation('update', 'remoteUpdate'),
    invocation('status', 'remoteStatus'),
    invocation('move', 'remoteMove'),
    invocation('injectionLog', 'remoteInjectionLog'),
  ],
};

export default TYPERT;
