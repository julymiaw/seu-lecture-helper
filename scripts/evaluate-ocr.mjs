// Offline evaluation of the production BrowserOcr; samples and results stay local.
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
const directory = resolve(process.argv[2] || '.cache/ocr-evaluation/2026-10-13');
const capture = JSON.parse(await readFile(resolve(directory, 'capture.json'), 'utf8'));
const labels = JSON.parse(await readFile(resolve(directory, 'labels.json'), 'utf8'));
const assets = JSON.parse(await readFile('src/ocr-assets.json', 'utf8'));
const built = await build({stdin: {contents: `import {BrowserOcr} from './src/ocr';
window.evaluateOcr = async samples => {
 const ocr = new BrowserOcr();const begin=performance.now();await ocr.prepare();const initializationMs=performance.now()-begin;
 const rows=[];for(const sample of samples){const start=performance.now();let prediction,error;
 try{prediction=await ocr.recognize(sample.data);}catch(e){error=String(e);}
 rows.push({id:sample.id,prediction,error,ms:performance.now()-start});}
 return {initializationMs,rows};
};`,resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife',target:'chrome100'});
const browser = await chromium.launch({headless:true,...(process.platform==='darwin'?{executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
try {
 const page=await browser.newPage();
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin==='https://ocr.test')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Offline OCR evaluation</title>'});
  const entry=Object.entries(assets).find(([,asset])=>url.pathname.endsWith('/'+asset.path));
  if(!entry||!['https://cdn.jsdelivr.net','https://unpkg.com'].includes(url.origin))throw Error('Blocked external request: '+url.origin);
  return route.fulfill({contentType:'application/octet-stream',headers:{'Access-Control-Allow-Origin':'*'},body:await readFile('.cache/ocr/'+entry[0])});
 });
 await page.goto('https://ocr.test/');await page.addScriptTag({content:built.outputFiles[0].text});
 const result=await page.evaluate(samples=>window.evaluateOcr(samples),capture.samples);
 result.rows=result.rows.map(row=>{const label=labels.find(x=>x.id===row.id);return {...row,...label,match:row.prediction===label?.expected};});
 const certain=result.rows.filter(x=>x.certain);
 result.summary={samples:result.rows.length,certainLabels:certain.length,correct:certain.filter(x=>x.match).length,
  fourCharacterOutputs:result.rows.filter(x=>/^[a-z0-9]{4}$/i.test(x.prediction??'')).length,
  note:'Accuracy uses only visually certain labels; no server-verified labels. Single small local sample batch.'};
 await writeFile(resolve(directory,'results.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
