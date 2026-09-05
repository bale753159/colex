import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // "server-only" throws outside Next's server build; it's a no-op in tests.
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
      "next/server": fileURLToPath(new URL("./test/next-server-stub.ts", import.meta.url)),
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    // Several test files each boot their own PGlite (WASM Postgres) instance and apply
    // supabase/migrations/0001_init.sql in beforeAll. That genuinely takes a few seconds,
    // and vitest's fork pool runs those files' beforeAll hooks concurrently — on a loaded
    // machine several PGlite instances booting at once can push past the default 10s
    // hookTimeout even though nothing is actually hung. Give real headroom rather than
    // reducing parallelism.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
