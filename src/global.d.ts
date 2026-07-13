// Minimal ambient declarations so the standalone package typechecks without
// requiring @types/node or @prisma/client as hard dependencies.
declare const process: any;
declare const console: Console;
declare var fetch: typeof globalThis.fetch;
declare var AbortController: typeof globalThis.AbortController;
declare var AbortSignal: typeof globalThis.AbortSignal;
declare var setTimeout: typeof globalThis.setTimeout;
declare var clearTimeout: typeof globalThis.clearTimeout;
declare var TextDecoder: typeof globalThis.TextDecoder;
declare var URL: typeof globalThis.URL;
