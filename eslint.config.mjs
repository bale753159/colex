import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // ".claude/**" holds git worktrees, each a full copy of this repo including its own
  // .next build output. Without it, linting the project also lints every worktree's
  // generated bundles — thousands of findings in code nobody wrote.
  globalIgnores([".next/**", ".open-next/**", "out/**", "build/**", "next-env.d.ts", ".claude/**"]),
]);
