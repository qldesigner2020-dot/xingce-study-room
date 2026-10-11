import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {classify} from './training-taxonomy.mjs';
const read=(file,name)=>{const c={window:{}};vm.runInNewContext(fs.readFileSync(file,'utf8'),c);return c.window[name];};
const index=read('client/data/training-index.js','QB_TRAINING_INDEX'),cat=read('client/data/catalog.js','QB_CATALOG');
const ctx={};vm.runInNewContext(fs.readFileSync('client/assets/training-tools.js','utf8'),ctx);const tools=ctx.TrainingTools;
const appSource=fs.readFileSync('client/assets/app.js','utf8');
const changeSource=appSource.match(/const CHANGE_ACTS = new Set\((\[[^;]+\])\);/);
assert.ok(changeSource,'form event routing exists');
const changes=new Set(vm.runInNewContext(changeSource[1]));
for(const select of appSource.matchAll(/<select\b[^>]*data-act="([^"]+)"/g)){
  assert.ok(changes.has(select[1]),`select ${select[1]} must dispatch on change`);
}
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
assert.equal(index.version,2);assert.equal(index.taxonomyVersion,'fenbi-v2.20261011');
const oldSingle=tools.migrateSelection(index,['逻辑填空::双空填空']);
assert.ok(oldSingle.selected.every(id=>id.startsWith('逻辑填空::'))&&oldSingle.selected.length>3);
assert.ok(oldSingle.qualifier.endsWith('::双空填空'),'old blank-count selection becomes a form filter');
assert.deepEqual(Array.from(tools.migrateSelection(index,['片段阅读::下文推断']).selected),['语句表达::接语选择']);
const blank=index.qualifiers.find(q=>q.group==='逻辑填空'&&q.label==='双空填空').id;
const logic=index.groups.find(g=>g.id==='逻辑填空'),reading=index.groups.find(g=>g.id==='片段阅读');
const baseOptions={region:'',years:[],selected,total:60};
const baseScope=tools.scope(index,cat,baseOptions);
const scopedOptions={...baseOptions,groupFilters:{逻辑填空:{form:blank}}};
const doubleScope=tools.scope(index,cat,scopedOptions);
for(const group of index.groups.filter(g=>g!==logic))for(const leaf of group.leaves){
  assert.equal(doubleScope.counts[leaf.id]||0,baseScope.counts[leaf.id]||0,`double blanks do not filter ${leaf.id}`);
}
const combined={...scopedOptions,selected:[...logic.leaves,...reading.leaves].map(t=>t.id)};
const combinedPlan=tools.plan(index,cat,combined),combinedSample=tools.sample(index,cat,combined,42);
assert.equal(combinedSample.total,combinedPlan.total);
assert.equal(new Set(combinedSample.refs.map(r=>r.qid)).size,combinedSample.total);
assert.ok(combinedSample.refs.some(r=>r.leaf.startsWith('片段阅读::')),'reading stays in a mixed exercise');
assert.ok(combinedSample.refs.some(r=>r.leaf.startsWith('逻辑填空::')),'double blanks stay in a mixed exercise');
for(const ref of combinedSample.refs.filter(r=>r.leaf.startsWith('逻辑填空::'))){
  assert.ok(papers.get(ref.key).questions.find(q=>q.qid===ref.qid).classification.forms.includes('双空填空'));
}
const migrate=prefs=>JSON.parse(JSON.stringify(tools.migratePreferences(index,prefs)));
const migratedEmpty=migrate({activeModule:'言语理解与表达',selected:[],qualifier:blank});
assert.equal(migratedEmpty.mode,'single');assert.equal(migratedEmpty.activeGroup,'逻辑填空');
assert.equal(migratedEmpty.qualifier,'');assert.equal(migratedEmpty.groupFilters.逻辑填空.form,blank);
assert.deepEqual(migratedEmpty.selected,Array.from(logic.leaves,t=>t.id),'old empty selection offers a usable single exercise');
const migratedOld=migrate({selected:['逻辑填空::双空填空']});
assert.equal(migratedOld.activeGroup,'逻辑填空','old form preferences open their matching module');
const migratedCombined=migrate({activeModule:'言语理解与表达',selected:[logic.leaves[0].id,reading.leaves[0].id],qualifier:blank});
assert.equal(migratedCombined.mode,'combined');assert.equal(migratedCombined.selected.length,2);
assert.equal(migratedCombined.groupFilters.片段阅读,undefined);
const explicitClear=migrate({mode:'single',activeModule:'言语理解与表达',activeGroup:'片段阅读',selected:[]});
assert.deepEqual(explicitClear.selected,[],'reopening respects an explicit clear');
// Three independent fields compose with AND. Facets ignore only their own field.
const facetIndex={groups:[{id:'logic',module:'语言',leaves:[{id:'logic::a'}]},{id:'read',module:'语言',leaves:[{id:'read::a'}]}],
  records:[['a',['辅助考点::A','解题方法::M','题面形式::双空']],['b',['辅助考点::B','解题方法::M','题面形式::双空']],['c',['辅助考点::A','解题方法::M','题面形式::单空']],['d',['辅助考点::A','解题方法::N','题面形式::双空']]].map(([qid,filters])=>({qid,leaf:'logic::a',src:[['p',1,0,qid]],filters})).concat([{qid:'r',leaf:'read::a',src:[['p',5,0,'r']],filters:[]}])};
const facetCatalog={papers:[{id:'p',year:2025,region:'海南'},{id:'other',year:2026,region:'国考'}]};
const three={auxiliary:'辅助考点::A',method:'解题方法::M',form:'题面形式::双空'};
const facet=tools.scope(facetIndex,facetCatalog,{region:'海南',years:['2025'],groupFilters:{logic:three}});
assert.equal(facet.counts['logic::a'],1);assert.equal(facet.counts['read::a'],1);
assert.equal(facet.facetCounts.logic.auxiliary['辅助考点::B'],1);
assert.equal(facet.facetCounts.logic.method['解题方法::N'],1);
assert.equal(facet.facetCounts.logic.form['题面形式::单空'],1);
assert.equal(tools.scope(facetIndex,facetCatalog,{region:'海南',years:['2025'],groupFilters:{logic:{form:three.form,method:three.method}}}).counts['logic::a'],2);
assert.equal(tools.scope(facetIndex,facetCatalog,{region:'海南',years:['2026'],groupFilters:{logic:three}}).uniqueCount,0,'facets respect the same source year-region intersection');
const crossMethod=index.qualifiers.find(q=>q.kind==='解题方法'&&new Set(index.records.filter(r=>r.filters.includes(q.id)).map(r=>r.leaf.split('::')[0])).size>1);
assert.ok(crossMethod,'real bank has methods shared by data-analysis groups');
const supported=index.groups.filter(g=>index.records.some(r=>g.leaves.some(t=>t.id===r.leaf)&&r.filters.includes(crossMethod.id)));
const shared=migrate({mode:'combined',activeModule:'资料分析',selected:supported.flatMap(g=>g.leaves.map(t=>t.id)),qualifier:crossMethod.id});
for(const g of supported)assert.equal(shared.groupFilters[g.id]?.method,crossMethod.id,`old method migrates to supported ${g.id}`);
assert.ok(tools.plan(index,cat,{...shared,total:30,years:[]}).total>0);
// Loading is asynchronous: repeated taps must not create competing sessions,
// and later UI edits must not relabel the already sampled question set.
let releaseQuestions,actionRenders=0;const loading=new Promise(resolve=>{releaseQuestions=resolve;}),started=[];
const custom={selected:new Set([logic.leaves[0].id]),groupFilters:{逻辑填空:{form:blank}},starting:false};
const actionContext={structuredClone,Set,V:{custom},route:{name:'custom'},TRAINING_INDEX:index,
  CAT:cat,TrainingTools:{sample:()=>({refs:[{qid:'load-test',specialty:'词义侧重'}],total:1,papers:[{}],allocations:{}})},
  trainingOptions:()=>({selected:[...custom.selected],groupFilters:custom.groupFilters,years:[],region:'',mode:'single'}),
  trainingConditions:()=>['逻辑填空：双空填空'],trainingFilterLabels:()=>['双空填空'],
  render:()=>{actionRenders++;},toast:()=>{},getSessions:()=>[],ensureQuestions:()=>loading,newId:()=>String(started.length),startSession:s=>{started.push(s);actionRenders++;}};
const startAction=appSource.slice(appSource.indexOf("  async 'start-custom'() {"),appSource.indexOf('  /* 答题：全程不提示对错'));
vm.runInNewContext('globalThis.actions={'+startAction+'}',actionContext);
const firstStart=actionContext.actions['start-custom']();
await actionContext.actions['start-custom']();
custom.selected=new Set([reading.leaves[0].id]);custom.groupFilters.逻辑填空.form='changed-during-load';
releaseQuestions([{qid:'load-test'}]);await firstStart;
assert.equal(started.length,1,'rapid taps start only one session');
assert.equal(started[0].training.groupFilters.逻辑填空.form,blank,'export conditions describe the sampled selection');
assert.ok(started[0].title.includes('词义侧重'),'title describes the sampled concept');
assert.equal(custom.starting,false,'loading guard always releases');
assert.equal(actionRenders,2,'loading cleanup must not rerender away the unfinished-exercise confirmation');
for(const qualifier of index.qualifiers){
  const options={region:'',years:[],selected,total:20,qualifier:qualifier.id},plan=tools.plan(index,cat,options),sample=tools.sample(index,cat,options,5);
  assert.equal(sample.total,plan.total);assert.equal(new Set(sample.refs.map(r=>r.qid)).size,sample.total);
  for(const ref of sample.refs){
    const c=papers.get(ref.key).questions.find(q=>q.qid===ref.qid).classification;
    const labels=qualifier.kind==='辅助考点'?c.auxiliary:qualifier.kind==='解题方法'?c.methods:c.forms;
    assert.ok(labels.includes(qualifier.label),'qualifier matches exact persisted question');
  }
}
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
