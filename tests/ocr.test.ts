import {describe, expect, it, vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {decodeCtc, savedMode, saveMode} from '../src/ocr';
import {loadAsset, validAsset, type Asset} from '../src/ocr-assets';

describe('OCR output and preference', () => {
  it('decodes repeated characters separated by blanks, without filtering letters', () => {
    const charset=['','0','1','A'];
    const tokens=[0,1,1,0,1,2,2,0,2,3,3,0];
    const data=tokens.flatMap(token=>charset.map((_,i)=>i===token?10:0));
    expect(decodeCtc(data,[tokens.length,1,4],charset)).toBe('0011A');
    expect(()=>decodeCtc(data,[2,2,4],charset)).toThrow('格式');
  });
  it('defaults to OCR and only persists the selected mode', () => {
    const values=new Map<string,string>();
    vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});
    expect(savedMode()).toBe('ocr'); saveMode('manual'); expect(savedMode()).toBe('manual'); expect(values.size).toBe(1);
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
    await expect(loadAsset(asset)).rejects.toThrow('手动'); expect(transport).toHaveBeenCalledTimes(2);
  });
});
