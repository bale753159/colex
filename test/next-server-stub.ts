// `next/server`'s `after()` requires a live request scope, which doesn't
// exist under vitest. Tests only need "run the callback", not deferral.
export function after(fn: () => unknown) {
  void fn();
}
