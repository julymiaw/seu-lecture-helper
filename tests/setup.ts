import { beforeEach, afterEach, vi } from 'vitest';
beforeEach(() => {
  // Every test supplies its own transport. No test may contact the school.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Offline test: unexpected fetch'); }));
  document.body.innerHTML = '';
  for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
