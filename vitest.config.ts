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
});
