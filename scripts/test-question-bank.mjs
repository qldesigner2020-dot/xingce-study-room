import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(process.argv[2] || 'client');
function read(rel, global, key) {
  const context = {window: {}};
  vm.runInNewContext(fs.readFileSync(path.join(root, rel), 'utf8'), context);
  return key ? context.window[global][key] : context.window[global];
}
const cat = read('data/catalog.js', 'QB_CATALOG');
assert.deepEqual(Array.from(cat.modules), ['政治理论', '常识判断', '言语理解与表达', '数量关系', '判断推理', '资料分析']);
const papers = new Map(), images = new Set(), types = {}, modules = {};
let total = 0;
for (const entry of cat.papers) {
  const paper = read(`data/papers/${entry.id}.js`, 'QB_PAPERS', entry.id);
  papers.set(entry.id, paper);
  assert.equal(paper.count, paper.questions.length, paper.name);
  assert.equal(entry.count, paper.count);
  assert.equal(paper.coverage.sourceCount, paper.count);
  assert.equal(new Set(paper.questions.map(q => q.qid)).size, paper.count, 'unique question references within a paper');
  const actualModules = {}, actualTypes = {};
  for (const q of paper.questions) {
    assert.equal(q.pid, paper.id);
    assert.ok(q.stem && q.options.length >= 2 && q.answer, `complete question ${q.qid}`);
    assert.equal(cat.typeModule[q.type], q.module, `type mapping ${q.type}`);
    assert.ok(q.from.file.endsWith('.md') && q.from.module === q.module);
    if (q.module === '资料分析') assert.ok(q.material, `material retained for ${q.qid}`);
    if (!q.judge) for (const answer of q.answer) assert.ok(q.options.some(o => o.k === answer), `answer ${q.qid}`);
    actualModules[q.module] = (actualModules[q.module] || 0) + 1;
    actualTypes[q.type] = (actualTypes[q.type] || 0) + 1;
    types[q.type] = (types[q.type] || 0) + 1;
    modules[q.module] = (modules[q.module] || 0) + 1;
    const html = [q.stem, q.material || '', q.explanation, ...q.options.map(o => o.t)].join('');
    for (const match of html.matchAll(/<img\b[^>]*src="([^"]+)"/g)) {
      assert.ok(match[1].startsWith('assets/img/'), `local image ${q.qid}`);
      images.add(match[1]);
    }
  }
  assert.equal(JSON.stringify(actualModules), JSON.stringify(paper.moduleCounts), 'module counts must match actual questions');
  assert.equal(JSON.stringify(actualTypes), JSON.stringify(paper.types), 'type counts must match actual questions');
  if (paper.coverage.expectedCount != null) {
    assert.equal(paper.coverage.missingCount, Math.max(0, paper.coverage.expectedCount - paper.count));
  } else assert.equal(paper.coverage.missingCount, null, 'unknown complete-paper size must stay unknown');
  total += paper.count;
}
assert.equal(cat.totalPapers, papers.size);
assert.equal(cat.totalQuestions, total);
for (const type of cat.typeOrder) assert.equal(cat.typeCount[type], types[type]);
for (const image of images) assert.ok(fs.statSync(path.join(root, image)).size > 0, image);
// Examples that exposed the omitted modules, plus a source-incomplete paper.
for (const [id, n] of [['p06c861deb9', 130], ['p58c22f871b', 135], ['pe73c52b327', 125], ['p259967259c', 134]]) {
  assert.equal(papers.get(id)?.count, n, `regression in ${id}`);
}
assert.equal(papers.get('p259967259c').coverage.missingCount, 1);
const pools = read('data/pools/index.js', 'QB_POOL_INDEX');
let poolQuestions = 0;
for (const [type, entry] of Object.entries(pools)) {
  const pool = read(`data/pools/${entry.key}.js`, 'QB_POOLS', entry.key);
  assert.equal(pool.questions.length, entry.count);
  assert.equal(pool.type, type);
  for (const q of pool.questions) {
    assert.ok(papers.get(q.pid)?.questions.some(source => source.qid === q.qid), `pool source resolves ${q.qid}`);
    assert.equal(q.module, cat.typeModule[type]);
  }
  poolQuestions += pool.questions.length;
}
console.log(`Question bank verified: ${papers.size} papers / ${total} questions / ${images.size} images / ${poolQuestions} pooled questions; all six modules, material, answer keys and source references checked.`);
