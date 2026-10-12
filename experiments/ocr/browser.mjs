import * as ort from 'onnxruntime-web/wasm';

// An offline experiment only. This module has no school URLs or booking code.
ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

async function timed(fn) {
  const start = performance.now();
  const text = await fn();
  return {text, ms: performance.now() - start};
}

async function prepareImage(data) {
  const image = new Image();
  image.src = data;
  await image.decode();
  const height = 64;
  const width = Math.floor(image.width * height / image.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const floats = new Float32Array(width * height);
  for (let p = 0; p < floats.length; p++) {
    const i = p * 4;
    const gray = .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2];
    floats[p] = (gray / 255 - .5) / .5;
  }
  return new ort.Tensor('float32', floats, [1, 1, height, width]);
}

function decode(output, charset) {
  if (output.dims.length !== 3 || output.dims[1] !== 1) throw new Error(`Unexpected output shape: ${output.dims}`);
  const classes = output.dims[2];
  let previous = 0;
  let text = '';
  for (let t = 0; t < output.dims[0]; t++) {
    let best = 0;
    for (let c = 1; c < classes; c++) if (output.data[t * classes + c] > output.data[t * classes + best]) best = c;
    if (best !== 0 && best !== previous) text += charset[best];
    previous = best;
  }
  return text;
}

window.benchmarkDddd = async (samples) => {
  const results = [];
  for (const [name, stem] of [['ddddocr-old', 'common_old'], ['ddddocr-beta', 'common']]) {
    let session;
    try {
      const start = performance.now();
      const [loaded, charset] = await Promise.all([
        ort.InferenceSession.create(`/models/${stem}.onnx`, {executionProviders: ['wasm']}),
        fetch(`/models/${stem}.json`).then(r => r.json()),
      ]);
      session = loaded;
      const initializationMs = performance.now() - start;
      const classify = async data => {
        const input = await prepareImage(data);
        try {
          const outputs = await session.run({[session.inputNames[0]]: input});
          try {return decode(outputs[session.outputNames[0]], charset);}
          finally {Object.values(outputs).forEach(output => output.dispose());}
        } finally {input.dispose();}
      };
      const cold = await timed(() => classify(samples[0].data));
      const rows = [];
      for (const sample of samples) {
        const runs = [];
        for (let i = 0; i < 5; i++) runs.push(await timed(() => classify(sample.data)));
        rows.push({id: sample.id, expected: sample.expected, runs});
      }
      results.push({name, initializationMs, cold, rows});
    } catch (error) {
      results.push({name, error: String(error), stack: error.stack});
    } finally {if (session) await session.release();}
  }
  return results;
};

window.benchmarkTesseract = async (samples) => {
  const start = performance.now();
  const worker = await Tesseract.createWorker('eng', 1, {
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract-core',
    langPath: '/language',
    workerBlobURL: false,
    gzip: true,
  });
  const initializationMs = performance.now() - start;
  const results = [];
  try {
    for (const [name, psm, upscale] of [
      ['tesseract-line-original', '7', false],
      ['tesseract-word-original', '8', false],
      ['tesseract-line-upscaled', '7', true],
      ['tesseract-raw-upscaled', '13', true],
    ]) {
      await worker.setParameters({tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: psm});
      const rows = [];
      for (const sample of samples) {
        let data = sample.data;
        if (upscale) {
          const img = new Image();
          img.src = data;
          await img.decode();
          const canvas = document.createElement('canvas');
          canvas.width = img.width * 4;
          canvas.height = img.height * 4;
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          data = canvas.toDataURL('image/png');
        }
        const runs = [];
        for (let i = 0; i < 3; i++) runs.push(await timed(async () => (await worker.recognize(data)).data.text.trim()));
        rows.push({id: sample.id, expected: sample.expected, runs});
      }
      results.push({name, rows});
    }
  } finally {
    await worker.terminate();
  }
  return {initializationMs, results};
};
