import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';

const root = fileURLToPath(new URL('.', import.meta.url));
const generated = path.join(root, 'generated');
await mkdir(generated, {recursive: true});
let wrapperBuild;
try {
  await build({entryPoints: [path.join(root, 'wrapper.mjs')], outfile: path.join(generated, 'wrapper.js'), bundle: true, platform: 'browser', format: 'iife', logLevel: 'silent'});
  wrapperBuild = {ok: true};
} catch (error) {
  wrapperBuild = {ok: false, errors: error.errors?.map(({text, location}) => ({text, file: location?.file})) || [String(error)]};
  console.log('ddddocr-node browser wrapper build failed; testing its models directly with ONNX Runtime Web.');
}
await build({
  entryPoints: [path.join(root, 'browser.mjs')],
  outfile: path.join(generated, 'browser.js'),
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome100',
  conditions: ['browser'], logLevel: 'silent',
});

// Real images remain outside the publishable project; only hashes/results are saved.
const evidence = process.env.OCR_SAMPLE_DIR || path.resolve(root, '../../../evidence-2026-10-12');
const inputs = [
  {id: 'saved-1', file: 'current-captcha.png', expected: '2787'},
  {id: 'saved-2', file: 'fresh-captcha.jpg', expected: '3253'},
];
const evaluationDirectory = process.env.OCR_EVAL_DIR ? path.resolve(process.env.OCR_EVAL_DIR) : undefined;
const samples = evaluationDirectory ? await (async()=>{
  const capture=JSON.parse(await readFile(path.join(evaluationDirectory,'capture.json'),'utf8'));
  const labels=JSON.parse(await readFile(path.join(evaluationDirectory,'labels.json'),'utf8'));
  return capture.samples.map(sample=>{
    const label=labels.find(row=>row.id===sample.id);
    if(!label?.certain)throw Error('Comparison requires a confirmed label for '+sample.id);
    return {id:sample.id,data:sample.data,expected:label.expected,labelSource:label.source,
      sha256:createHash('sha256').update(Buffer.from(sample.data.split(',')[1],'base64')).digest('hex')};
  });
})() : await Promise.all(inputs.map(async ({id, file, expected}) => {
  const bytes = await readFile(path.join(evidence, file));
  return {id, expected, labelSource: 'visual transcription checked against enlarged image; not an independently verified server label', sha256: createHash('sha256').update(bytes).digest('hex'), data: `data:image/jpeg;base64,${bytes.toString('base64')}`};
}));

const mappings = [
  ['/ort/', path.join(root, 'node_modules/onnxruntime-web/dist')],
  ['/models/', path.join(root, 'node_modules/ddddocr-node/onnx')],
  ['/tesseract/', path.join(root, 'node_modules/tesseract.js/dist')],
  ['/tesseract-core/', path.join(root, 'node_modules/tesseract.js-core')],
  ['/language/', path.join(root, 'node_modules/@tesseract.js-data/eng/4.0.0')],
  ['/generated/', generated],
];
const assetRequests = [];
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Local OCR benchmark</title><script src="/tesseract/tesseract.min.js"></script><script src="/generated/browser.js"></script>');
    return;
  }
  const mapping = mappings.find(([prefix]) => pathname.startsWith(prefix));
  if (!mapping || pathname.includes('..')) {res.writeHead(404).end(); return;}
  const file = path.join(mapping[1], pathname.slice(mapping[0].length));
  try {
    const body = await readFile(file);
    assetRequests.push({path: pathname, bytes: body.length});
    res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream');
    res.end(body);
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const context = await browser.newContext({serviceWorkers: 'block'});
const outbound = [];
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) {outbound.push(url.origin); return route.abort();}
  return route.continue();
});
const page = await context.newPage();
page.on('pageerror', error => console.error('Browser error:', error.message));
const results = {
  date: new Date().toISOString(), node: process.version,
  machine: {platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model},
  browser: browser.version(), samples: samples.map(({data, ...safe}) => safe),
  wrapperBuild,
  versions: Object.fromEntries(await Promise.all(['ddddocr-node', 'onnxruntime-web', 'tesseract.js', 'jimp'].map(async name => [name, JSON.parse(await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version]))),
  notes: [`${samples.length} distinct saved images; repeated runs measure timing, not independent accuracy.`, 'Local assets over loopback; startup timings exclude public network download.', 'Models run sequentially in one page; the second model reuses an initialized WASM runtime, so their initialization timings are not a fair cold-start comparison.', 'No school page, session, CAPTCHA refresh, or booking API used.'],
};
try {
  await page.goto(origin);
  console.log('Browser loaded. Testing ddddocr models via ONNX Runtime Web...');
  results.ddddocr = await page.evaluate(samples => window.benchmarkDddd(samples), samples);
  console.log(JSON.stringify({ddddocr: results.ddddocr}, null, 2));
  console.log('Testing Tesseract...');
  try {results.tesseract = await page.evaluate(samples => window.benchmarkTesseract(samples), samples);}
  catch (error) {results.tesseract = {error: String(error)};}
  results.outboundBlocked = outbound;
  results.assets = assetRequests;
  const resultFile=evaluationDirectory?path.join(evaluationDirectory,'comparison.json'):path.join(root,'results.local.json');
  await writeFile(resultFile, JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({tesseract: results.tesseract, outboundBlocked: outbound, resultFile}, null, 2));
} finally {
  await context.close();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
