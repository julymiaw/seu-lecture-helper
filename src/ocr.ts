import * as ort from 'onnxruntime-web/wasm';
import {loadAsset, OCR_ASSETS} from './ocr-assets';
export interface OcrEngine {prepare(): Promise<void>; recognize(image: string): Promise<string>}
export function decodeCtc(data: ArrayLike<number>, dims: readonly number[], charset: string[]): string {
  if (dims.length !== 3 || dims[1] !== 1 || dims[2] !== charset.length) throw new Error('OCR 模型输出格式不匹配');
  const allowed = charset.map((char,index)=>index===0 || /^[0-9]$/.test(char));
  let previous = 0, text = '';
  for (let t = 0; t < dims[0]; t++) {
    let best = 0;
    for (let c = 1; c < dims[2]; c++) if (allowed[c] && data[t * dims[2] + c] > data[t * dims[2] + best]) best = c;
    if (best !== 0 && best !== previous) text += charset[best];
    previous = best;
  }
  return text;
}
export class BrowserOcr implements OcrEngine {
  private preparing?: Promise<void>;
  private session?: ort.InferenceSession;
  private charset: string[] = [];
  prepare(): Promise<void> {
    if (!this.preparing) this.preparing = this.initialize().catch(error => {this.preparing = undefined; throw error;});
    return this.preparing;
  }
  private async initialize() {
    const [model, charset, wasm] = await Promise.all([loadAsset(OCR_ASSETS.model), loadAsset(OCR_ASSETS.charset), loadAsset(OCR_ASSETS.wasm)]);
    this.charset = JSON.parse(new TextDecoder().decode(charset));
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = undefined;
    // The npm WASM bundle embeds its JS loader. Only the verified binary is external.
    ort.env.wasm.wasmBinary = wasm;
    // The upstream model declares a 2-D output but emits 3-D CTC scores.
    // Decode actual dimensions below; retain runtime errors without warning spam.
    this.session = await ort.InferenceSession.create(new Uint8Array(model), {executionProviders: ['wasm'], logSeverityLevel: 3});
    const input = new ort.Tensor('float32', new Float32Array(64 * 128).fill(1), [1, 1, 64, 128]);
    try {
      const outputs = await this.session.run({[this.session.inputNames[0]]: input});
      Object.values(outputs).forEach(output => output.dispose());
    } finally {input.dispose();}
  }
  async recognize(data: string): Promise<string> {
    await this.prepare();
    const image = new Image(); image.src = data; await image.decode();
    const height = 64, width = Math.floor(image.width * height / image.height);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data, floats = new Float32Array(width * height);
    for (let p = 0; p < floats.length; p++) {
      const i = p * 4;
      floats[p] = ((.2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]) / 255 - .5) / .5;
    }
    const input = new ort.Tensor('float32', floats, [1, 1, height, width]);
    try {
      const session = this.session!;
      const outputs = await session.run({[session.inputNames[0]]: input});
      try {return decodeCtc(outputs[session.outputNames[0]].data as Float32Array, outputs[session.outputNames[0]].dims, this.charset);}
      finally {Object.values(outputs).forEach(output => output.dispose());}
    } finally {input.dispose();}
  }
}
