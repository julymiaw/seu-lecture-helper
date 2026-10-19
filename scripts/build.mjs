import { build } from 'esbuild';
import { readFile, rm } from 'node:fs/promises';
const {version} = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const notices = await readFile(new URL('../THIRD_PARTY_NOTICES.txt', import.meta.url), 'utf8');
const header = `// ==UserScript==
// @name         SEU 研究生讲座预约助手
// @namespace    seu-lecture-helper
// @version      ${version}
// @description  提前准备验证码、人工修正、线上线下串行候选、会话恢复与结果核验
// @match        https://ehall.seu.edu.cn/gsapp/sys/yddjzxxtjappseu/*
// @noframes
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==`;
await build({entryPoints: ['src/main.ts'], outfile: 'dist/seu-lecture-helper.user.js', bundle: true, format: 'iife', target: 'chrome100', define: {'import.meta.url': 'undefined'}, banner: {js: header + '\n/*\n' + notices + '*/'}, legalComments: 'inline'});
await rm('dist/seu-lecture-helper.user.js.LEGAL.txt', {force:true});
console.log('Built dist/seu-lecture-helper.user.js');
