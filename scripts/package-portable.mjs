// Build a shareable, self-contained file:// app. No server or installed runtime required.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {deflateRawSync} from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = path.join(root, 'client');
const releases = path.join(root, 'releases');
const stamp = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
}).format(new Date()).replace(/[^0-9]/g, '');
const releaseName = `两眼一睁就是练-离线版-${stamp}`;
const folder = path.join(releases, releaseName);
await fs.mkdir(releases, {recursive: true});
await fs.mkdir(folder); // Never overwrite a previously delivered package.

// Copy public static source only. Never copy dist, account config, logs or practice history.
const excluded = new Set(['index.html', 'assets/cloud-sync.js', 'assets/auth.css',
  'assets/vendor/pdf-fonts.js', 'assets/vendor/pdf-fonts-lite.js',
  'assets/vendor/pdf-font-coverage.js']);
async function filesIn(dir) {
  const files = [];
  for (const item of await fs.readdir(dir, {withFileTypes: true})) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) files.push(...await filesIn(file));
    else if (item.isFile()) files.push(file);
    else throw new Error(`Unsupported package entry: ${file}`);
  }
  return files.sort();
}
const sourceFiles = await filesIn(client);
for (const file of sourceFiles) {
  const rel = path.relative(client, file).split(path.sep).join('/');
  if (excluded.has(rel)) continue;
  const dest = path.join(folder, rel);
  await fs.mkdir(path.dirname(dest), {recursive: true});
  await fs.copyFile(file, dest);
}
const index = (await fs.readFile(path.join(client, 'index.html'), 'utf8'))
  .replace('<link rel="stylesheet" href="assets/auth.css">\n', '')
  .replace('<link rel="stylesheet" href="assets/auth.css">\r\n', '')
  .replace('<script src="assets/cloud-sync.js"></script>', '<script src="assets/app.js"></script>');
await fs.writeFile(path.join(folder, '开始刷题.html'), index);
await fs.writeFile(path.join(folder, '启动.cmd'), '@echo off\r\nchcp 65001 >nul\r\nstart "" "%~dp0开始刷题.html"\r\n', 'utf8');
const appPath = path.join(folder, 'assets/app.js');
await fs.writeFile(appPath, (await fs.readFile(appPath, 'utf8')).replace(
  '本地存储不可用，刷新会丢失记录。请用「启动.cmd」打开。',
  '浏览器未允许保存本地记录。请用 Edge 或 Chrome 打开；退出前请导出完整备份。'));

const context = {window: {}};
vm.runInNewContext(await fs.readFile(path.join(client, 'data/catalog.js'), 'utf8'), context);
const catalog = context.window.QB_CATALOG;
// Preserve source references in the questions, but remove the builder's absolute disk path.
context.window.QB_CATALOG.source = '开源题库';
await fs.writeFile(path.join(folder, 'data/catalog.js'),
  'window.QB_CATALOG=' + JSON.stringify(catalog) + ';\n');

// Browsers cannot fetch local image files as bytes. Lazy ordinary scripts provide
// those same bytes to PDF/HTML/Markdown exporters without network or file permissions.
const imageFiles = sourceFiles.filter(f => path.relative(client, f).startsWith('assets' + path.sep + 'img' + path.sep));
const imageDir = path.join(folder, 'data/export-images');
await fs.mkdir(imageDir, {recursive: true});
const imageIndex = {}, packLimit = 2 * 1024 * 1024;
let pack = {}, packBytes = 0, packNumber = 0;
async function writePack() {
  if (!packBytes) return;
  const name = 'images-' + String(++packNumber).padStart(3, '0');
  for (const key of Object.keys(pack)) imageIndex[key] = name;
  await fs.writeFile(path.join(imageDir, name + '.js'),
    'window.QB_EXPORT_IMAGES=Object.assign(window.QB_EXPORT_IMAGES||{},' + JSON.stringify(pack) + ');\n');
  pack = {}; packBytes = 0;
}
for (const file of imageFiles) {
  const bytes = await fs.readFile(file);
  if (packBytes && packBytes + bytes.length > packLimit) await writePack();
  pack[path.relative(client, file).split(path.sep).join('/')] = bytes.toString('base64');
  packBytes += bytes.length;
}
await writePack();
await fs.writeFile(path.join(imageDir, 'index.js'), 'window.QB_EXPORT_IMAGE_INDEX=' + JSON.stringify(imageIndex) + ';\n');

// Check every question's image references before creating the ZIP.
let paperCount = 0, questionCount = 0;
function checkImages(value) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/src=["'](assets\/img\/[^"']+)["']/g)) {
      if (!imageIndex[match[1]]) throw new Error('Missing offline picture: ' + match[1]);
    }
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) checkImages(child);
  }
}
for (const file of sourceFiles.filter(f => /[\\/]data[\\/](papers|pools)[\\/].+\.js$/.test(f))) {
  const data = {window: {}};
  vm.runInNewContext(await fs.readFile(file, 'utf8'), data);
  checkImages(data.window);
  if (data.window.QB_PAPERS) for (const paper of Object.values(data.window.QB_PAPERS)) {
    paperCount++; questionCount += paper.questions.length;
  }
}
if (paperCount !== catalog.totalPapers || questionCount !== catalog.totalQuestions)
  throw new Error('Question count does not match the catalog');

await fs.writeFile(path.join(folder, '使用说明.txt'), `两眼一睁就是练 · 行测离线练习室

开始使用
1. 先将整个 ZIP 解压到一个固定文件夹。
2. 双击「开始刷题.html」，或双击「启动.cmd」。推荐使用 Edge 或 Chrome。
3. 无需安装、无需登录、无需网络，题目、图片与 PDF 导出均已包含。
   不要在压缩包内直接打开网页；不要只单独复制 HTML 文件。

题库范围
${catalog.yearRange[0]}—${catalog.yearRange[1]} 年，${paperCount} 套试卷、${questionCount.toLocaleString('zh-CN')} 道题。
${catalog.modules.join('、')}，已导入原库中各卷的全部现有题目。
网友回忆版可能有遗漏，页面“收录”题量不代表真实试卷一定完整。

已有功能
真题套卷、专项训练、实时计时、暂停、手写标注、选项排除、错题本、收藏、
待复查、熟悉程度与掌握自评、个人复盘、试题打印、PDF 与带图 Markdown 导出。
PDF 使用电脑自带字体，不下载中文字体包。

记录与备份
练习记录只保存在使用者自己的浏览器，本分享包不含任何人的练习记录或账号。
请使用普通浏览器窗口，并保持文件夹位置及浏览器不变。
在「练习记录」中点击「导出完整备份」，保存 JSON 文件。
换电脑、换浏览器、移动文件夹或更新版本时，在新版本中「导入完整备份」。
清理浏览器数据或使用无痕窗口，可能使本机记录丢失。
离线版不会自动同步到在线网站；可以通过完整备份在两个版本之间迁移。

发给 AI 分析
在练习报告中导出「复盘 PDF」或「Markdown 与图片 ZIP」。
带图 Markdown 请同时保留解压后的图片文件夹；需要上传单个文件时用 PDF。

题库与软件
题目保留原卷名、题号、题库编号及解析来源信息。
题库整理来源：开源题库。本包为现有网站的离线版本。
第三方 PDF 程序许可保留在 assets/vendor/ 目录。
在线版本：https://qldesigner2020-dot.github.io/xingce-study-room/

打包日期：${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}
`);

// UTF-8 ZIP with standard DEFLATE, readable by Windows' built-in extractor.
const crcTable = Uint32Array.from({length: 256}, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
const zipPath = folder + '.zip';
const zip = await fs.open(zipPath, 'wx');
const dosDate = ((Number(stamp.slice(0, 4)) - 1980) << 9) | (Number(stamp.slice(4, 6)) << 5) | Number(stamp.slice(6, 8));
const dosTime = (Number(stamp.slice(8, 10)) << 11) | (Number(stamp.slice(10, 12)) << 5) | (Number(stamp.slice(12, 14)) >> 1);
const directory = [];
let offset = 0, rawBytes = 0;
try {
  for (const file of await filesIn(folder)) {
    const name = Buffer.from(releaseName + '/' + path.relative(folder, file).split(path.sep).join('/'));
    const raw = await fs.readFile(file), compressed = deflateRawSync(raw, {level: 6}), crc = crc32(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(8, 8); head.writeUInt16LE(dosTime, 10); head.writeUInt16LE(dosDate, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(compressed.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(8, 10); dir.writeUInt16LE(dosTime, 12); dir.writeUInt16LE(dosDate, 14);
    dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(compressed.length, 20); dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
    await zip.writeFile(head); await zip.writeFile(name); await zip.writeFile(compressed);
    offset += head.length + name.length + compressed.length; rawBytes += raw.length;
    directory.push(dir, name);
  }
  const count = directory.length / 2, central = Buffer.concat(directory), end = Buffer.alloc(22);
  if (count > 65535 || offset + central.length > 0xffffffff) throw new Error('Package requires ZIP64');
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  await zip.writeFile(central); await zip.writeFile(end);
} finally { await zip.close(); }
const bytes = (await fs.stat(zipPath)).size;
console.log(JSON.stringify({folder, zip: zipPath, papers: paperCount, questions: questionCount,
  images: imageFiles.length, imagePacks: packNumber, files: directory.length / 2,
  unpackedMB: +(rawBytes / 1048576).toFixed(1), zipMB: +(bytes / 1048576).toFixed(1)}, null, 2));
