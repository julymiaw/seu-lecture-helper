// Chrome's origin-scoped Web Lock is atomic and is released on tab crash/close.
export async function acquireTask(locks: LockManager | undefined = navigator.locks): Promise<(() => void) | null> {
  if (!locks) throw new Error('当前浏览器不支持任务互斥，请使用新版 Chrome 或 Edge');
  return new Promise((resolve, reject) => {
    void locks.request('seu-lecture-helper:reservation', {ifAvailable: true}, async lock => {
      if (!lock) {resolve(null); return;}
      await new Promise<void>(release => resolve(release));
    }).catch(reject);
  });
}
