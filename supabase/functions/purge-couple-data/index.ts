import { createPurgeHandler } from './purge.js';

Deno.serve(createPurgeHandler({
  fetchImpl: fetch,
  getEnv: (name) => Deno.env.get(name),
}));
