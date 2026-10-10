/**
 * 行测刷题站 —— 数据构建脚本
 *
 * 从本地开源题库读取 2022–2026 年全部六个模块。
 * 先验证题量、图片和既有题目引用，再写出静态数据。
 *
 * 输出（全部为 .js，用 <script> 加载，因此 file:// 双击打开也能用）：
 *   data/catalog.js        —— 卷目目录（元信息 + 题型分布）
 *   data/papers/<pid>.js   —— 每套卷的完整题目（套卷刷题用）
 *   data/pools/<type>.js   —— 每个题型的题库（随机刷题用，按题干去重）
 *   assets/img/...         —— 被引用的图片
 *
 * 用法：node scripts/build-question-bank.mjs [--source=绝对路径] [--out=目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const SRC_ROOT = path.resolve(arg('source') || 'D:\\Obsidian\\开源题库');
const OUT_ROOT = path.resolve(ROOT, arg('out') || 'client');
if (!OUT_ROOT.startsWith(ROOT + path.sep) || OUT_ROOT === SRC_ROOT) throw new Error('Output must be inside this project');
const formatContext = {};
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'client/assets/exam-format.js'), 'utf8'), formatContext);
const ExamFormat = formatContext.ExamFormat;
const MIN_YEAR = 2022;
const MAX_YEAR = 2026;

/** 必须导入全部模块；不按题型筛掉整类题目。 */
const MODULES = [
  { dir: '01-政治理论', key: '政治理论' },
  { dir: '02-常识判断', key: '常识判断' },
  { dir: '03-言语理解与表达', key: '言语理解与表达' },
  { dir: '04-数量关系', key: '数量关系' },
  { dir: '05-判断推理', key: '判断推理' },
  { dir: '06-资料分析', key: '资料分析' },
];

/** 套卷内的模块顺序（贴近真实行测卷面顺序） */
const MODULE_ORDER = MODULES.map(m => m.key);

/** 图片目录 → 站内 ASCII 目录名 */
const IMG_DIRS = { '题目图': 'timu', '公式图': 'gongshi' };

// ---------------------------------------------------------------- 正则

const RE_Q = /^(#{2,4})\s*第\s*(\d+)\s*题[\s\u3000]*<sub>qid\s*(\d+)\s*·\s*([^<]+?)<\/sub>/;
const RE_MAT = /^##\s*材料\s*(\d+)\s*$/;
const RE_OPT = /^-\s*\*\*([A-Z])\*\*\s*\.\s?([\s\S]*)$/;
const RE_ANS = /^\*\*答案\*\*[：:]\s*(.+)$/;
const RE_EXPL = /^\*\*官方解析\*\*\s*$/;
/** 判断题在源文件里的选项占位符：`- （选项）[]` */
const RE_PLACEHOLDER = /^-\s*（选项）\s*\[\s*\]\s*$/;
const RE_FM = /^([^\s:][^:]*):\s*"?([^"]*?)"?\s*$/;

// ---------------------------------------------------------------- 工具

const htmlEsc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 稳定短 id：同一输入永远得到同一结果（保证 localStorage 里的记录不失效） */
const shortId = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

/** 去掉选项行尾的 ✅ 标记（正确答案以 **答案** 字段为准） */
const stripCheck = (s) => s.replace(/[\s\u3000]*✅[\s\u3000]*$/, '').trim();

/** 把多行文本按空行切成 <p> 段落；已经是 HTML 的原样返回 */
function toParagraphs(text) {
  const t = text.trim();
  if (!t) return '';
  if (/<(p|div|img|table|br|u|sub|sup)\b/i.test(t)) return t;
  return t
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// ---------------------------------------------------------------- 图片

const referencedImages = new Map(); // 站内相对路径 -> 源绝对路径
const missingImages = [];

function rewriteImages(html) {
  return html.replace(/<img\b([^>]*?)\/?>/gi, (whole, attrs) => {
    const srcM = attrs.match(/\bsrc\s*=\s*"([^"]+)"/i);
    if (!srcM) return whole;
    const src = srcM[1];

    // ../90-图片/<题目图|公式图>/<file>
    const m = src.match(/90-图片[\\/]([^\\/]+)[\\/]([^\\/]+)$/);
    let outSrc;
    if (m && IMG_DIRS[m[1]]) {
      const rel = `assets/img/${IMG_DIRS[m[1]]}/${m[2]}`;
      const abs = path.join(SRC_ROOT, '90-图片', m[1], m[2]);
      if (fs.existsSync(abs)) referencedImages.set(rel, abs);
      else missingImages.push(m[2]);
      outSrc = rel;
    } else {
      missingImages.push(src);
      outSrc = src;
    }

    // 保留 width/height（源文件写作 width="650px"，属非法属性值，转成 style），
    // 把 flag="tex" 换成 class，方便 CSS 处理行内公式
    let w = '';
    let h = '';
    const wm = attrs.match(/\bwidth\s*=\s*"([^"]+)"/i);
    const hm = attrs.match(/\bheight\s*=\s*"([^"]+)"/i);
    if (wm) w = /^\d+$/.test(wm[1]) ? wm[1] + 'px' : wm[1];
    if (hm) h = /^\d+$/.test(hm[1]) ? hm[1] + 'px' : hm[1];
    const style = w || h ? ` style="${w ? 'width:' + w + ';' : ''}${h ? 'height:' + h + ';' : ''}"` : '';

    const isTex = /\bflag\s*=\s*"tex"/i.test(attrs);
    const cls = isTex ? 'tex' : 'fig';
    return `<img src="${outSrc}" class="${cls}"${style}>`;
  });
}

// ---------------------------------------------------------------- 解析单文件

function parseFile(absPath, moduleKey) {
  const raw = fs.readFileSync(absPath, 'utf8');
  const lines = raw.split(/\r?\n/);

  // frontmatter
  const meta = {};
  if (lines[0]?.trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') break;
      const m = lines[i].match(RE_FM);
      if (m) meta[m[1].trim()] = m[2].trim();
    }
  }

  const questions = [];
  let cur = null;
  let curMat = null; // 当前材料 {no, lines[]}

  const flush = () => {
    if (cur) {
      questions.push(cur);
      cur = null;
    }
  };

  for (const line of lines) {
    const mm = line.match(RE_MAT);
    if (mm) {
      flush();
      curMat = { no: mm[1], lines: [] };
      continue;
    }

    const qm = line.match(RE_Q);
    if (qm) {
      flush();
      if (qm[1].length <= 2) curMat = null;
      const type = qm[4].trim();
      cur = { no: +qm[2], qid: qm[3], type, sourceFile: absPath, material: curMat, buf: [] };
      continue;
    }

    if (cur) cur.buf.push(line);
    else if (curMat) curMat.lines.push(line);
  }
  flush();
  const declared = Number(meta['题数']);
  const headings = (raw.match(/^#{2,4}\s*第\s*\d+\s*题/gm) || []).length;
  if (!Number.isInteger(declared) || declared !== questions.length || headings !== questions.length) {
    throw new Error(`题数不一致：${absPath}；声明 ${declared}，标题 ${headings}，解析 ${questions.length}`);
  }
  if (new Set(questions.map(q => q.qid)).size !== questions.length) throw new Error(`重复 qid：${absPath}`);

  // 每个材料只保留非空内容
  for (const q of questions) {
    if (q.material) {
      q.materialText = q.material.lines.join('\n').replace(/^\s*---\s*$/gm, '').trim();
      q.materialNo = +q.material.no;
    }
  }

  return { absPath, moduleKey, meta, questions };
}

/** 把一段原始题目块拆成 题干 / 选项 / 答案 / 解析 */
function buildQuestion(q, src) {
  const stemLines = [];
  const options = [];
  let answer = null;
  let explLines = [];
  let phase = 'stem';
  let sawOption = false;
  let sawPlaceholder = false;

  for (const line of q.buf) {
    // 判断题在源题库里没有选项，只有 `- （选项）[]` 占位符；
    // 因此「答案 / 解析」的识别不能只依赖"是否已见到选项"。
    if (RE_PLACEHOLDER.test(line)) {
      sawPlaceholder = true;
      continue;
    }
    if (RE_EXPL.test(line) && phase !== 'expl') {
      phase = 'expl';
      continue;
    }
    if (phase !== 'expl') {
      const am = line.match(RE_ANS);
      if (am) {
        answer = am[1].trim();
        phase = 'answer';
        continue;
      }
    }

    if (phase === 'stem') {
      const om = line.match(RE_OPT);
      if (om) {
        sawOption = true;
        phase = 'after-opt';
        options.push({ k: om[1], t: stripCheck(om[2]) });
        continue;
      }
      stemLines.push(line);
      continue;
    }
    if (phase === 'after-opt') {
      const om = line.match(RE_OPT);
      if (om) {
        options.push({ k: om[1], t: stripCheck(om[2]) });
      }
      continue;
    }
    // phase === 'answer'：答案与解析之间通常只有空行，忽略
    if (phase === 'answer') continue;
    // phase === 'expl'
    if (/^\s*---\s*$/.test(line)) continue;
    explLines.push(line);
  }

  // 判断题（源自题库缺选项）：补出「正确 / 错误」
  let isJudge = false;
  if (!options.length && !sawOption) {
    isJudge = true;
    options.push({ k: 'A', t: '正确' }, { k: 'B', t: '错误' });
  }

  const stem = ExamFormat.stem(rewriteImages(toParagraphs(stemLines.join('\n'))), q.type);
  // Some source exports put every subsequent question under the preceding material.
  // A complete graphic pattern in the stem does not depend on that prose material.
  const standaloneGraphic = q.type === '图形推理' && /<img\b/.test(stem) && !/根据(?:上述|以上|材料)|依据材料/.test(stem);
  return {
    qid: q.qid,
    no: q.no,
    type: q.type,
    module: src.moduleKey,
    stem,
    material: q.materialText && !standaloneGraphic ? rewriteImages(toParagraphs(q.materialText)) : undefined,
    materialNo: standaloneGraphic ? undefined : q.materialNo,
    options: options.map(o => ({...o, t: rewriteImages(o.t)})),
    answer: answer || '',
    multi: (answer || '').length > 1,
    judge: isJudge || undefined,
    explanation: rewriteImages(toParagraphs(explLines.join('\n'))),
    from: { file: path.basename(src.absPath), module: src.moduleKey },
  };
}

// ---------------------------------------------------------------- 主流程

console.log('扫描题库…');
const parsed = [];
for (const mod of MODULES) {
  const dir = path.join(SRC_ROOT, mod.dir);
  const names = fs.readdirSync(dir).filter((n) => n.endsWith('.md'));
  for (const name of names) {
    const ym = name.match(/^(\d{4})年/);
    if (!ym) continue;
    const year = +ym[1];
    if (year < MIN_YEAR || year > MAX_YEAR) continue;
    parsed.push(parseFile(path.join(dir, name), mod.key));
  }
}
console.log(`  命中 ${parsed.length} 个模块卷文件`);

// 按「试卷名」归并成套卷
const papers = new Map(); // name -> { name, year, region, byModule: Map }
for (const p of parsed) {
  const name = p.meta['试卷'] || path.basename(p.absPath, '.md');
  if (!papers.has(name)) {
    papers.set(name, {
      name,
      year: +(p.meta['年份'] || 0) || null,
      region: p.meta['地区'] || '',
      byModule: new Map(),
    });
  }
  const rec = papers.get(name);
  if (!rec.year) rec.year = +(p.meta['年份'] || 0) || null;
  if (!rec.region) rec.region = p.meta['地区'] || '';
  const list = (rec.byModule.get(p.moduleKey) || []).concat(p.questions);
  rec.byModule.set(p.moduleKey, list);
}

const catalog = [];
const paperFiles = new Map(); // pid -> {paper, questions}

let totalQ = 0;
const typeCount = new Map();
const TYPE_MODULE = {};

for (const rec of [...papers.values()].sort((a, b) => (b.year - a.year) || a.name.localeCompare(b.name, 'zh'))) {
  const pid = 'p' + shortId(rec.name);

  const questions = [];
  for (const mk of MODULE_ORDER) {
    const list = rec.byModule.get(mk);
    if (!list) continue;
    for (const q of list) {
      questions.push(buildQuestion(q, { moduleKey: mk, absPath: q.sourceFile }));
    }
  }
  if (!questions.length) continue;
  if (new Set(questions.map(q => q.qid)).size !== questions.length) throw new Error(`卷内重复 qid：${rec.name}`);

  questions.forEach((q, i) => {
    q.idx = i;
    q.pid = pid;
    totalQ++;
    typeCount.set(q.type, (typeCount.get(q.type) || 0) + 1);
    if (TYPE_MODULE[q.type] && TYPE_MODULE[q.type] !== q.module) throw new Error(`题型跨模块：${q.type}`);
    TYPE_MODULE[q.type] = q.module;
  });

  const types = {};
  for (const q of questions) types[q.type] = (types[q.type] || 0) + 1;
  const moduleCounts = Object.fromEntries(MODULE_ORDER.filter(m => rec.byModule.has(m)).map(m => [m, rec.byModule.get(m).length]));
  // 国考 2022–2026 可核对题量。其他回忆版不凭题数或模块数量推断“完整”。
  const expectedCount = rec.region === '国考' && /国家公务员录用考试/.test(rec.name)
    ? (/副省级/.test(rec.name) ? 135 : 130) : null;
  const coverage = {basis: '网友回忆版', sourceCount: questions.length, expectedCount,
    missingCount: expectedCount == null ? null : Math.max(0, expectedCount - questions.length)};

  paperFiles.set(pid, {
    id: pid,
    name: rec.name,
    year: rec.year,
    region: rec.region,
    count: questions.length,
    types,
    modules: [...new Set(questions.map((q) => q.module))],
    moduleCounts,
    coverage,
    questions,
  });

  catalog.push({
    id: pid,
    name: rec.name,
    year: rec.year,
    region: rec.region,
    count: questions.length,
    types,
    modules: [...new Set(questions.map((q) => q.module))],
    moduleCounts,
    coverage,
  });
}

// 题型的展示顺序 & 所属模块
const TYPE_ORDER = [
  '新思想', '时事政治', '马克思主义', '毛中特',
  '人文常识', '法律常识', '科技常识', '地理国情', '经济常识',
  '逻辑填空', '片段阅读', '语句表达',
  '数学运算',
  '图形推理', '定义判断', '类比推理', '逻辑判断',
  '增长', '比重', '平均数', '倍数', '综合',
];
const typesInData = [...typeCount.keys()].sort(
  (a, b) => (TYPE_ORDER.indexOf(a) + 1 || 99) - (TYPE_ORDER.indexOf(b) + 1 || 99)
);

// 随机题库：按「题型」分池，并按题干去重（跨省重复题很多）
const pools = new Map();
const seenHash = new Map(); // type -> Map(hash, pooled question)
for (const [pid, pf] of paperFiles) {
  for (const q of pf.questions) {
    if (!pools.has(q.type)) pools.set(q.type, []);
    if (!seenHash.has(q.type)) seenHash.set(q.type, new Map());
    const h = shortId((q.material || '') + '|' + q.stem + '|' + q.options.map((o) => o.t).join('|'));
    const seen = seenHash.get(q.type);
    if (seen.has(h)) {
      const same = seen.get(h);
      if (!same.sourceYears.includes(pf.year)) same.sourceYears.push(pf.year);
      continue;
    }
    const pooled = { ...q, sourceYears: [pf.year] };
    seen.set(h, pooled);
    pools.get(q.type).push(pooled);
  }
}

// ---------------------------------------------------------------- 输出

// Old paper/pool references must still resolve, and text offsets used by ink must
// remain unchanged. Abort before writing if rebuilding would alter an old item.
let preserved = 0;
for (const [dir, next] of [['papers', paperFiles], ['pools', new Map([...pools].map(([type, questions]) => ['q' + shortId('pool:' + type), {questions}]))]]) {
  const baseline = path.join(ROOT, 'client/data', dir);
  if (!fs.existsSync(baseline)) continue;
  for (const filename of fs.readdirSync(baseline).filter(f => f !== 'index.js' && f.endsWith('.js'))) {
    const key = path.basename(filename, '.js'), context = {window: {}};
    vm.runInNewContext(fs.readFileSync(path.join(baseline, filename), 'utf8'), context);
    const before = context.window[dir === 'papers' ? 'QB_PAPERS' : 'QB_POOLS'][key];
    // Source qids may recur in different recalled papers with different attached
    // material. A qid-only map would overwrite one variant during validation.
    const after = new Map();
    for (const q of next.get(key)?.questions || []) {
      if (!after.has(q.qid)) after.set(q.qid, []);
      after.get(q.qid).push(q);
    }
    const signature = q => JSON.stringify([q.type, q.module, ExamFormat.stem(q.stem, q.type), q.material, q.options, q.answer, q.explanation]);
    for (const old of before.questions) {
      const candidates = (after.get(old.qid) || []).filter(q => signature(q) === signature(old));
      const fresh = candidates.find(q => q.pid === old.pid) || candidates[0];
      if (!fresh) throw new Error(`旧引用丢失：${dir}/${key}/${old.qid}`);
      // The UI now formats ellipses at render time; retain the old stored markup
      // when it renders identically, so existing text/ink anchors do not shift.
      if (ExamFormat.stem(old.stem, old.type) === fresh.stem) fresh.stem = old.stem;
      // A repeated source qid can appear in several papers with a different
      // module ordinal. Keep the established pool's source location.
      if (dir === 'pools') {
        for (const field of ['no', 'pid', 'idx', 'from', 'materialNo']) fresh[field] = old[field];
      }
      for (const field of ['no', 'type', 'module', 'stem', 'material', 'materialNo', 'options', 'answer', 'explanation', 'from']) {
        if (JSON.stringify(old[field]) !== JSON.stringify(fresh[field])) throw new Error(`旧题内容变化：${key}/${old.qid}/${field}`);
      }
      preserved++;
    }
  }
}
if (missingImages.length) throw new Error('缺失图片：' + [...new Set(missingImages)].join(', '));
console.log(`  已核对 ${preserved} 条既有套卷/随机池引用，题目文字与 ID 保持一致`);

const dataDir = path.join(OUT_ROOT, 'data');
if (!dataDir.startsWith(ROOT + path.sep)) throw new Error('Unsafe data output');
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(path.join(dataDir, 'papers'), { recursive: true });
fs.mkdirSync(path.join(dataDir, 'pools'), { recursive: true });

const writeJs = (rel, assignment) => {
  const abs = path.join(dataDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, assignment, 'utf8');
};

/** JSON.stringify 不会转义 U+2028/U+2029（题库里有），在 JS 字符串字面量中不安全 */
const jsLiteral = (v) =>
  JSON.stringify(v).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

writeJs('catalog.js', 'window.QB_CATALOG = ' + jsLiteral({
  generatedAt: new Date().toISOString(),
  source: '开源题库（网友回忆版，已导入各卷全部现有模块）',
  yearRange: [MIN_YEAR, MAX_YEAR],
  modules: MODULES.map((m) => m.key),
  typeOrder: typesInData,
  typeModule: TYPE_MODULE,
  totalPapers: catalog.length,
  totalQuestions: totalQ,
  typeCount: Object.fromEntries(typesInData.map((t) => [t, typeCount.get(t)])),
  papers: catalog,
}) + ';\n');

for (const [pid, pf] of paperFiles) {
  writeJs(`papers/${pid}.js`, `window.QB_PAPERS=window.QB_PAPERS||{};window.QB_PAPERS[${JSON.stringify(pid)}]=${jsLiteral(pf)};\n`);
}

const poolMeta = {};
for (const t of typesInData) {
  const list = pools.get(t) || [];
  const key = 'q' + shortId('pool:' + t);
  const yearMasks = {};
  for (const q of list) {
    const mask = q.sourceYears.reduce((value, year) => value | (1 << (year - MIN_YEAR)), 0);
    yearMasks[mask] = (yearMasks[mask] || 0) + 1;
  }
  poolMeta[t] = { key, count: list.length, yearMasks };
  writeJs(`pools/${key}.js`, `window.QB_POOLS=window.QB_POOLS||{};window.QB_POOLS[${JSON.stringify(key)}]=${jsLiteral({ type: t, questions: list })};\n`);
}
writeJs('pools/index.js', 'window.QB_POOL_INDEX = ' + jsLiteral(poolMeta) + ';\n');

// 图片
const imgOut = path.join(OUT_ROOT, 'assets', 'img');
if (!imgOut.startsWith(ROOT + path.sep)) throw new Error('Unsafe image output');
fs.rmSync(imgOut, { recursive: true, force: true });
let imgBytes = 0;
for (const [rel, abs] of referencedImages) {
  const dest = path.join(OUT_ROOT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(abs, dest);
  imgBytes += fs.statSync(abs).size;
}

// ---------------------------------------------------------------- 报告

const dirSize = (d) => {
  if (!fs.existsSync(d)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return n;
};
const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';

console.log('\n=== 构建完成 ===');
console.log(`套卷数      : ${catalog.length}`);
console.log(`题目总数    : ${totalQ}`);
console.log(`题型        : ${typesInData.map((t) => `${t} ${typeCount.get(t)}`).join(' | ')}`);
console.log(`随机题库去重: ${typesInData.map((t) => `${t} ${pools.get(t).length}`).join(' | ')}`);
console.log(`引用图片    : ${referencedImages.size} 张，${mb(imgBytes)}`);
if (missingImages.length) console.log(`缺失图片    : ${missingImages.length} 张（示例 ${missingImages.slice(0, 3).join(', ')}）`);
console.log(`data/       : ${mb(dirSize(dataDir))}`);
console.log(`assets/img/ : ${mb(dirSize(imgOut))}`);
