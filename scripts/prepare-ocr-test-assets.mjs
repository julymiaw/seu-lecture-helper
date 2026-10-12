import {readFile, writeFile, mkdir, rename, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assets from '../src/ocr-assets.json' with {type: 'json'};
const directory = new URL('../.cache/ocr/', import.meta.url);
await mkdir(directory, {recursive: true});
const valid = (bytes, asset) => bytes.length === asset.bytes && createHash('sha256').update(bytes).digest('hex') === asset.sha256;
for (const [name, asset] of Object.entries(assets)) {
  const destination = new URL(name, directory);
  try {if (valid(await readFile(destination), asset)) continue;} catch { /* First run. */ }
  // Reuse the already pinned packages if the optional local experiment exists.
  const local = new URL('../experiments/ocr/node_modules/' + asset.path.replace(/@[^/]+\//, '/'), import.meta.url);
  try {
    const bytes = await readFile(local);
    if (valid(bytes, asset)) {await writeFile(destination, bytes); continue;}
  } catch { /* A clean checkout downloads public test resources below. */ }
  const temporary = new URL(name + '.tmp', directory);
  let complete = false;
  for (const prefix of ['https://cdn.jsdelivr.net/npm/', 'https://unpkg.com/']) {
    try {
      console.log('Preparing public OCR test asset:', name);
      await promisify(execFile)('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '120', '--output', temporary.pathname, prefix + asset.path]);
      if (!valid(await readFile(temporary), asset)) throw new Error('Asset integrity mismatch');
      await rename(temporary, destination); complete = true; break;
    } catch { /* One fallback mirror. */ }
  }
  await rm(temporary, {force: true});
  if (!complete) throw new Error(`Cannot prepare ${name}; offline OCR browser tests need the pinned assets.`);
}
console.log('Verified OCR test assets ready. Browser tests themselves use local fixtures only.');
