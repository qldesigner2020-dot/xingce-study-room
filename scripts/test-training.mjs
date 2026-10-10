import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {classify} from './training-taxonomy.mjs';
const read=(file,name)=>{const c={window:{}};vm.runInNewContext(fs.readFileSync(file,'utf8'),c);return c.window[name];};
const index=read('client/data/training-index.js','QB_TRAINING_INDEX'),cat=read('client/data/catalog.js','QB_CATALOG');
const ctx={};vm.runInNewContext(fs.readFileSync('client/assets/training-tools.js','utf8'),ctx);const tools=ctx.TrainingTools;
const appSource=fs.readFileSync('client/assets/app.js','utf8');
const statistics={CAT:cat};
vm.runInNewContext(appSource.slice(appSource.indexOf('function refTypeLabel('),appSource.indexOf('/* ---------------------------------------------------------- 报告 / 导出 */')),statistics);
const stats=statistics.summarize({refs:[
  {qid:'s1',type:'综合',leaf:'比重::现期比重',specialty:'现期比重'},
  {qid:'s2',type:'综合',leaf:'增长::增长率计算',specialty:'增长率计算'}],
  answers:{s1:{pick:'A',ms:30000},s2:{ms:90000}}},[{qid:'s1',answer:'A'},{qid:'s2',answer:'B'}]);
assert.equal(stats.byType[0].type,'比重 · 现期比重','training results use the trained concept, preserving original type');
assert.equal(stats.byType[1].ms,0,'unanswered dwell time does not inflate answered-question speed');
assert.equal(stats.totalMs,120000);assert.equal(stats.answeredMs,30000);
const papers=new Map(cat.papers.map(p=>[p.id,read(`client/data/papers/${p.id}.js`,'QB_PAPERS')[p.id]]));
const leaves=new Set(index.groups.flatMap(g=>g.leaves.map(t=>t.id))),sourceKeys=new Set();
let sourceCount=0;
for(const record of index.records){
  assert.ok(leaves.has(record.leaf));assert.ok(record.src.length);
  for(const [pid,no,material,qid] of record.src){
    const q=papers.get(pid)?.questions.find(q=>q.qid===qid&&q.no===no);assert.ok(q,`exact source ${pid}/${qid}`);
    assert.equal(q.type,record.t);assert.equal(q.materialNo||0,material);
    const c=classify(q);assert.equal(c.group+'::'+c.tag,record.leaf);
    sourceCount++;sourceKeys.add(pid+'|'+qid);
  }
}
assert.equal(sourceKeys.size,cat.totalQuestions,'every original question appears in the training index');
assert.equal(sourceCount,cat.totalQuestions,'no source occurrence counted twice');
const fixture=(type,stem,explanation,module=cat.typeModule[type])=>classify({type,stem,explanation,module});
assert.equal(fixture('综合','2023年约占全国总量的多少？','可判定本题为现期比重问题。').tag,'现期比重');
assert.equal(fixture('综合','下列说法正确的是','A项可判定本题为增长率问题').tag,'综合判断');
assert.equal(fixture('数学运算','问随机抽取的概率是多少？','').tag,'概率问题');
assert.equal(fixture('片段阅读','这段文字意在说明什么？','').tag,'意图判断');
assert.equal(fixture('语句表达','将以上六句话重新排列，正确顺序是','').tag,'语句排序');
assert.equal(fixture('逻辑判断','以下哪项如果为真最能削弱上述结论？','').tag,'削弱论证');
assert.equal(fixture('数学运算','某单位作出安排，问结果是多少','').tag,'未细分');
assert.deepEqual(JSON.parse(JSON.stringify(tools.allocate(['a','b'],{a:100,b:100},{a:9,b:1},20))),{a:18,b:2},'uses exam occurrence weights, not equal pool capacities');
assert.deepEqual(JSON.parse(JSON.stringify(tools.allocate(['a','b'],{a:1,b:99},{a:9,b:1},20))),{a:1,b:19},'capacity shortage is redistributed within selected tags');
const selected=index.groups.flatMap(g=>g.leaves.map(t=>t.id));
for(const region of ['海南','国考','安徽',''])for(const years of [['2026'],['2025','2026'],[]]){
  const options={region,years,selected,total:100,preferUnseen:true},plan=tools.plan(index,cat,options);
  for(let seed=1;seed<=12;seed++){
    const sample=tools.sample(index,cat,options,seed);
    assert.equal(sample.total,plan.total,`preview matches sample: ${region}/${years}`);
    assert.equal(new Set(sample.refs.map(r=>r.qid)).size,sample.total);
    const actual={};
    for(const ref of sample.refs){
      const p=papers.get(ref.key);assert.ok(!region||p.region===region);assert.ok(!years.length||years.includes(String(p.year)));
      const q=p.questions.find(q=>q.qid===ref.qid);assert.ok(q&&q.no===ref.no);
      const c=classify(q);assert.equal(c.group+'::'+c.tag,ref.leaf);
      actual[ref.leaf]=(actual[ref.leaf]||0)+1;
    }
    for(const leaf of plan.ids)assert.equal(actual[leaf]||0,plan.allocations[leaf]);
  }
}
const single={region:'海南',years:['2025','2026'],selected:['增长::增长率计算'],total:20,preferUnseen:true};
const first=tools.sample(index,cat,single,7),seen=new Set(first.refs.map(r=>r.qid));
const next=tools.sample(index,cat,single,8,seen),cap=tools.plan(index,cat,single).max;
assert.equal(next.refs.filter(r=>seen.has(r.qid)).length,Math.max(0,next.total-(cap-seen.size)),'prefer unseen without changing exam proportions');
assert.equal(tools.plan(index,cat,{...single,region:'没有这个地区'}).total,0,'empty scope never silently falls back to nationwide questions');
console.log(`PASS specialist training: ${sourceCount} exact sources, ${leaves.size} tags, weighted allocation/capacity, year-region intersection, no repeated qids, preview accuracy, source labels and unseen preference.`);
