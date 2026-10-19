import {describe, expect, it, vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {decodeCtc} from '../src/ocr';
import {loadAsset, validAsset, type Asset} from '../src/ocr-assets';

describe('numeric OCR output', () => {
  it('numeric CTC chooses the highest allowed probability, preserves zero and merges only adjacent repeats',()=>{
    const charset=['','0','7','O'];
    const data=[0,5,1,10, 9,1,0,2, 0,2,8,10, 0,2,8,10];
    expect(decodeCtc(data,[4,1,4],charset)).toBe('07');
  });
  it('decodes repeated digits separated by blanks', () => {
    const charset=['','0','1'];
    const tokens=[0,1,1,0,1,2,2,0,2,0];
    const data=tokens.flatMap(token=>charset.map((_,i)=>i===token?10:0));
    expect(decodeCtc(data,[tokens.length,1,3],charset)).toBe('0011');
    expect(()=>decodeCtc(data,[2,2,4],charset)).toThrow('格式');
  });

});

describe('pinned OCR asset loading', () => {
  const asset: Asset={path:'fixture@1/model', bytes:3, sha256:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'};
  const bytes=()=>new Uint8Array([97,98,99]).buffer;
  const storage=(match=vi.fn(async()=>undefined as Response|undefined),put=vi.fn(async()=>{}))=>{
    const cache={match,put,delete:vi.fn(async()=>true)};
    vi.stubGlobal('caches',{open:vi.fn(async()=>cache)}); return cache;
  };
  it('uses verified cache without a network request', async () => {
    vi.stubGlobal('crypto',webcrypto); storage(vi.fn(async()=>new Response(bytes())));
    expect(await validAsset(bytes(),asset)).toBe(true); expect(await loadAsset(asset)).toEqual(bytes()); expect(fetch).not.toHaveBeenCalled();
  });
  it('removes corrupt cache, checks download integrity, and omits school credentials', async () => {
    vi.stubGlobal('crypto',webcrypto); const cache=storage(vi.fn(async()=>new Response('bad')));
    const transport=vi.fn(async()=>new Response(bytes())); vi.stubGlobal('fetch',transport);
    await loadAsset(asset); expect(cache.delete).toHaveBeenCalledOnce(); expect(cache.put).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledWith('https://cdn.jsdelivr.net/npm/fixture@1/model',expect.objectContaining({credentials:'omit',referrerPolicy:'no-referrer'}));
  });
  it('falls back once after a bad mirror response and supports unavailable storage', async () => {
    vi.stubGlobal('crypto',webcrypto); vi.stubGlobal('caches',{open:vi.fn(async()=>{throw new Error('disabled');})});
    const transport=vi.fn().mockResolvedValueOnce(new Response('bad')).mockResolvedValueOnce(new Response(bytes())); vi.stubGlobal('fetch',transport);
    expect(await loadAsset(asset)).toEqual(bytes()); expect(transport).toHaveBeenCalledTimes(2);
  });
  it('never accepts wrong bytes or retries indefinitely', async () => {
    vi.stubGlobal('crypto',webcrypto); storage(); const transport=vi.fn(async()=>new Response('bad')); vi.stubGlobal('fetch',transport);
    await expect(loadAsset(asset)).rejects.toThrow('加载失败'); expect(transport).toHaveBeenCalledTimes(2);
  });
});
