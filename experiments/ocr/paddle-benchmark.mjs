import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
const root=resolve('.cache/ocr-candidates'),dataset=resolve(process.argv[2]||'.cache/ocr-evaluation/2026-10-13-50');
const models=JSON.parse(await readFile(root+'/manifest.json','utf8'));
const capture=JSON.parse(await readFile(dataset+'/capture.json','utf8')),labels=JSON.parse(await readFile(dataset+'/labels.json','utf8'));
const samples=capture.samples.map(s=>({...s,expected:labels.find(l=>l.id===s.id)?.expected}));
if(samples.some(s=>!s.expected))throw Error('Unlabelled sample');
const built=await build({entryPoints:['experiments/ocr/paddle-browser.mjs'],bundle:true,write:false,platform:'browser',format:'iife',target:'chrome100'});
const server=createServer(async(req,res)=>{
 try{const name=new URL(req.url,'http://localhost').pathname.slice(1);
  if(!name){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><title>Offline pretrained OCR comparison</title>');}
  if(name==='code.js'){res.setHeader('Content-Type','text/javascript');return res.end(built.outputFiles[0].text);}
  const allowed=new Set(['wasm',...models.flatMap(m=>[m.name+'.json',m.name+'.onnx'])]);if(!allowed.has(name)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',name.endsWith('.json')?'application/json':'application/octet-stream');res.end(await readFile(name==='wasm'?'.cache/ocr/wasm':root+'/'+name));
 }catch{res.writeHead(500).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
try{const context=await browser.newContext();await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const page=await context.newPage();await page.goto(origin);await page.addScriptTag({url:origin+'/code.js'});
 const results=await page.evaluate(({models,samples})=>window.runPaddleModels(models,samples),{models,samples});
 await writeFile(dataset+'/paddle-comparison.json',JSON.stringify({browser:browser.version(),results},null,2)+'\n');
 for(const r of results)console.log(JSON.stringify({name:r.name,error:r.error,correct:r.rows?.filter(x=>x.prediction===x.expected).length,digitsCorrect:r.rows?.filter(x=>x.digitsPrediction===x.expected).length}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
