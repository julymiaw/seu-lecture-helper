# 浏览器本地 OCR 可行性实验

这是独立的离线实验，不接入正式用户脚本。没有学校地址、Cookie、预约提交、验证码刷新或在线 OCR 调用。浏览器使用临时独立上下文；运行时只允许访问本机提供的模型和图片，其他网络请求会被阻止。

## 复现

先在项目根目录安装现有开发依赖，再在本目录执行：

```sh
npm ci --ignore-scripts
npm test
```

使用本机安装的 Google Chrome，无须连接个人浏览器会话。可通过 `CHROME_PATH` 指定其他 Chromium 可执行文件。

本次使用的两张原始图片在项目外 `../../../evidence-2026-10-12/`，不随 GitHub 项目发布。复现者需提供同一组已离线保存的图片，并用 `OCR_SAMPLE_DIR` 指定目录，文件名为 `current-captcha.png` 和 `fresh-captcha.jpg`。没有这些原始图片时不能复现本次识别结果；不要用生成的测试验证码替代后仍声称是本次结果。

预期文字来自放大后的人工转录：`2787`、`3253`；不是服务端返回的验证码答案。第一张最初的小图人工初读为 `2187`，放大核对后已修正。

## 测量内容

- 先尝试原样构建 `ddddocr-node` 的浏览器入口，记录构建成功与否。
- 独立使用 `onnxruntime-web/wasm`，运行包中 `common_old.onnx`、`common.onnx` 两个模型。Canvas 缩放到高 64 像素、等比例宽度、灰度归一化到 `[-1, 1]`，使用 CTC 贪心解码；模型文字输出不限定为数字。
- Tesseract 使用英文模型、数字白名单，分别尝试单行／单词模式，以及原图／四倍放大图。
- ddddocr 每张图重复 5 次，Tesseract 每种配置每张图重复 3 次；这些重复只用于计时，不增加独立样本数。
- 识别计时含图片解码、预处理、推理和文字解码。初始化单独记录；所有资源来自本机，未测 CDN 下载时间。第二个模型复用已初始化的 WASM，不能据此比较两个模型的冷启动速度。

完整结果写到忽略发布的 `results.local.json`，包含软件版本、图片哈希、模型资源字节数和逐次计时，不含图片数据。`generated/` 是可删除的实验构建产物。固定结果见 [results.md](results.md)。

## 已标注样本批次对比

从项目根目录运行，可以使用本地评估目录中的 `capture.json` 和用户确认的 `labels.json`：

```sh
OCR_EVAL_DIR="$PWD/.cache/ocr-evaluation/2026-10-13" node experiments/ocr/benchmark.mjs
```

对比 old／beta 的原始解码和仅数字解码，以及 Tesseract 的原图／放大图、单行／单词配置。数字限定在 CTC 选最大概率类别时保留数字及空白，不是对错误答案人工替换，也不使用标签参与推理。每图重复测量耗时，重复运行不增加独立样本数。

使用隔离浏览器和本地资源，禁止外部网络；输出保存到该目录的 `comparison.json`，不覆盖历史双图实验结果。此批对比见 [2026-10-13 评估记录](../../docs/ocr-evaluation-2026-10-13.md)。原图和标签不随仓库发布，需自行准备。正式脚本的模型、解码方式和依赖保持不变。

## 依赖与范围

补充的 PP-OCRv5／v6 预训练模型对比使用独立工具，不引入正式脚本依赖：

```sh
# 从项目根目录运行；仅实验准备需要 Python，正式脚本仍只需要浏览器
python3 -m venv .cache/ocr-candidates/venv
.cache/ocr-candidates/venv/bin/pip install onnx==1.17.0
.cache/ocr-candidates/venv/bin/python experiments/ocr/prepare-paddle.py
node experiments/ocr/paddle-benchmark.mjs .cache/ocr-evaluation/2026-10-13-50
```

模型 URL、大小和 SHA-256 固定在 `paddle-models.json`，来自 RapidOCR 发布清单；准备时校验权重并提取内嵌字典。浏览器测试使用 ONNX Runtime Web，BGR／CHW／48×320、等比缩放和零填充输入，分别比较原始及数字限定 CTC 解码。不训练、微调或使用样本标签修改模型；结果写入本地数据目录的 `paddle-comparison.json`。

依赖只安装在本目录，不改正式脚本的依赖和分发文件。为复现现成包的浏览器构建失败，本实验保留 `ddddocr-node` 及其完整依赖；不建议原样把这套依赖加入正式脚本。

本次依赖审计报告 4 项 moderate（同一 `sprintf-js → argparse → tensorflow → ddddocr-node` 依赖链），未执行自动降级或强制修复。直接 ONNX 识别代码不导入 TensorFlow 或 Jimp；后续产品接入可只保留推理引擎及选定模型。

参考源码：[ddddocr-node 的 OCR 处理](https://github.com/renhaoyeh/ddddocr-node/blob/main/src/Ocr.ts)、[ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/)、[Tesseract.js](https://github.com/naptha/tesseract.js)。
