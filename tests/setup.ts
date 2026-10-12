import { beforeEach, afterEach, vi } from 'vitest';
beforeEach(() => {
  // Every test supplies its own transport. No test may contact the school.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Offline test: unexpected fetch'); }));
  document.body.innerHTML = '';
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
