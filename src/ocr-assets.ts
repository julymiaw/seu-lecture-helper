import manifest from './ocr-assets.json';
export interface Asset {path: string; bytes: number; sha256: string}
export const OCR_ASSETS = manifest;
const CACHE = 'seu-lecture-ocr-v1';
export async function validAsset(buffer: ArrayBuffer, asset: Asset): Promise<boolean> {
  if (buffer.byteLength !== asset.bytes) return false;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return [...hash].map(x => x.toString(16).padStart(2, '0')).join('') === asset.sha256;
}
export async function loadAsset(asset: Asset): Promise<ArrayBuffer> {
  const urls = ['https://cdn.jsdelivr.net/npm/', 'https://unpkg.com/'].map(prefix => prefix + asset.path);
  let cache: Cache | undefined;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(urls[0]);
    if (hit) {
      const buffer = await hit.arrayBuffer();
      if (await validAsset(buffer, asset)) return buffer;
      await cache.delete(urls[0]);
    }
  } catch { /* Cache storage can be unavailable; memory-only loading still works. */ }
  for (const url of urls) {
    try {
      const response = await fetch(url, {credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(60000)});
      if (!response.ok) throw new Error('资源下载失败');
      const buffer = await response.arrayBuffer();
      if (!await validAsset(buffer, asset)) throw new Error('资源校验失败');
      try {await cache?.put(urls[0], new Response(buffer));} catch { /* Nonessential disk cache. */ }
      return buffer;
    } catch { /* Try the second pinned mirror once, then report initialization failure. */ }
  }
  throw new Error('OCR 资源加载失败，无法完成自动预约');
}
