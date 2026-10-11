import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {classify,trainingGroup} from './training-taxonomy.mjs';
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
vm.runInNewContext(appSource.slice(appSource.indexOf('function refTypeLabel('),appSource.indexOf('/** 平均每题用时：'))+'\nglobalThis.moduleForTest=moduleOfType;',statistics);
const stats=statistics.summarize({refs:[
  {qid:'s1',type:'综合',leaf:'比重::现期比重',specialty:'现期比重'},
  {qid:'s2',type:'综合',leaf:'增长::增长率计算',specialty:'增长率计算'}],
  answers:{s1:{pick:'A',ms:30000},s2:{ms:90000}}},[{qid:'s1',answer:'A'},{qid:'s2',answer:'B'}]);
assert.equal(stats.byType[0].type,'比重 · 现期比重','training results use the trained concept, preserving original type');
assert.equal(stats.byType[1].ms,0,'unanswered dwell time does not inflate answered-question speed');
assert.equal(stats.totalMs,120000);assert.equal(stats.answeredMs,30000);
assert.equal(statistics.moduleForTest('比重 · 现期比重'),'资料分析','detailed concepts retain the module in reports and exports');
const papers=new Map(cat.papers.map(p=>[p.id,read(`client/data/papers/${p.id}.js`,'QB_PAPERS')[p.id]]));
const leaves=new Set(index.groups.flatMap(g=>g.leaves.map(t=>t.id))),sourceKeys=new Set();
let sourceCount=0;
for(const record of index.records){
  assert.ok(leaves.has(record.leaf));assert.ok(record.src.length);
  for(const [pid,no,material,qid] of record.src){
    const q=papers.get(pid)?.questions.find(q=>q.qid===qid&&q.no===no);assert.ok(q,`exact source ${pid}/${qid}`);
    assert.equal(q.type,record.t);assert.equal(q.materialNo||0,material);
    const c=classify(q);assert.equal(trainingGroup(q,c)+'::'+c.tag,record.leaf);
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
      const c=classify(q);assert.equal(trainingGroup(q,c)+'::'+c.tag,ref.leaf);
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
// Equal parent frequencies with very different numbers of children: a flat
// largest-remainder pass over leaves would distort the four question families.
const examGroups=[23,5,12,8].map((n,i)=>({id:'family'+i,label:'family'+i,module:'判断',leaves:Array.from({length:n},(_,j)=>({id:'family'+i+'::'+j,label:String(j)}))}));
const examIndex={groups:examGroups,records:examGroups.flatMap(g=>Array.from({length:120},(_,i)=>({qid:g.id+'-'+i,t:g.id,leaf:g.leaves[i%g.leaves.length].id,filters:[],src:[['exam',i+1,0,g.id+'-'+i]]})))};
const examCatalog={papers:[{id:'exam',year:2025,region:'国考'}],modules:['判断']};
const examOptions={workflow:'exam',selectedModules:['判断'],selected:[],total:25,years:['2025'],region:'国考'};
const examPlan=tools.plan(examIndex,examCatalog,examOptions);
assert.deepEqual(JSON.parse(JSON.stringify(examPlan.groupAllocations)),{family0:7,family1:6,family2:6,family3:6},'parent allocation precedes child rounding');
assert.equal(examPlan.total,25,'automatic training needs no manual leaf selections');
const flat=tools.plan(examIndex,examCatalog,{...examOptions,workflow:'targeted',selected:examGroups.flatMap(g=>g.leaves.map(t=>t.id))});
assert.notDeepEqual(JSON.parse(JSON.stringify(flat.groupAllocations)),JSON.parse(JSON.stringify(examPlan.groupAllocations)),'fixture detects the previous flat allocation defect');
for(let seed=1;seed<=12;seed++){
  const sampled=tools.sample(examIndex,examCatalog,examOptions,seed);
  assert.equal(sampled.total,25);assert.equal(new Set(sampled.refs.map(r=>r.qid)).size,25);
  for(const g of examGroups)assert.equal(sampled.refs.filter(r=>r.type===g.id).length,examPlan.groupAllocations[g.id]);
  assert.deepEqual(Array.from(new Set(sampled.refs.map(r=>r.type))),examGroups.map(g=>g.id),'question families stay together in exam order');
}
const constrained={...examIndex,records:examIndex.records.filter(r=>r.t!=='family0'||Number(r.qid.split('-')[1])<2)};
const limited=tools.sample(constrained,examCatalog,examOptions,10);
assert.equal(limited.total,25);assert.equal(limited.groupAllocations.family0,0,'a very rare type can round to zero in a small exercise; frequencies are not hardcoded');
const limitedWeights={...examIndex,records:examIndex.records.filter(r=>r.t!=='family0'||Number(r.qid.split('-')[1])<2).map(r=>r.t==='family0'?{...r,src:Array.from({length:60},()=>r.src[0])}:r)};
const rebalanced=tools.sample(limitedWeights,examCatalog,examOptions,10);
assert.equal(rebalanced.groupAllocations.family0,2,'parent capacity limits redistribute within the selected module');assert.equal(rebalanced.total,25);
const extraGroup={id:'read',module:'言语',leaves:[{id:'read::main',label:'main'}]};
const mixedIndex={...examIndex,groups:[...examGroups,extraGroup],records:[...examIndex.records,...Array.from({length:120},(_,i)=>({qid:'read-'+i,t:'read',leaf:'read::main',src:[['exam',i+1,0,'read-'+i]]}))]};
const mixed=tools.sample(mixedIndex,{...examCatalog,modules:['判断','言语']},{...examOptions,selectedModules:['判断','言语']},42);
assert.deepEqual(JSON.parse(JSON.stringify(mixed.moduleAllocations)),{判断:20,言语:5},'multiple modules follow occurrence frequencies');
assert.equal(mixed.total,25);
const frequencies={},variants=new Set();
for(let seed=1;seed<=400;seed++){
  const options={...examOptions,allocationSeed:seed},p=tools.plan(examIndex,examCatalog,options),s=tools.sample(examIndex,examCatalog,options,seed+1);
  assert.equal(p.total,25);assert.equal(s.total,p.total);
  variants.add(JSON.stringify(p.groupAllocations));
  for(const group of examGroups){
    assert.ok([6,7].includes(p.groupAllocations[group.id]),'integer variation stays within floor/ceil of the real proportion');
    assert.equal(s.refs.filter(r=>r.type===group.id).length,p.groupAllocations[group.id],'randomized preview is identical to the sampled quotas');
  }
  for(const [id,n] of Object.entries(p.allocations))frequencies[id]=(frequencies[id]||0)+n;
  const capped=tools.sample(limitedWeights,examCatalog,options,seed);
  assert.equal(capped.total,25);assert.equal(capped.groupAllocations.family0,2);
}
assert.ok(variants.size>1,'successive exercises have small proportional variation');
assert.ok(examGroups[0].leaves.every(t=>frequencies[t.id]>0),'small-share child concepts are not permanently excluded by deterministic rounding');
assert.equal(migrate({selected:[reading.leaves[0].id],qualifier:blank}).workflow,'exam','existing preferences default to the simple entry');
assert.equal(migrate({workflow:'targeted',mode:'single',selected:[]}).workflow,'targeted');
assert.deepEqual(migrate({workflow:'exam',selectedModules:[]}).selectedModules,[],'explicit module clear survives reload');
assert.deepEqual(migrate({selectedModules:['不存在','判断推理','判断推理']}).selectedModules,['判断推理']);
for(const region of ['海南','国考','安徽',''])for(const years of [['2026'],['2025','2026'],[]]){
  const options={workflow:'exam',allocationSeed:15398271,selectedModules:['判断推理','言语理解与表达'],total:25,region,years,selected:[],preferUnseen:true,groupFilters:{逻辑填空:{form:blank}},qualifier:blank};
  const clean=tools.plan(index,cat,{...options,groupFilters:{},qualifier:''}),plan=tools.plan(index,cat,options);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.allocations)),JSON.parse(JSON.stringify(clean.allocations)),'automatic practice ignores saved focused filters');
  for(let seed=1;seed<=6;seed++){
    const sample=tools.sample(index,cat,options,seed);
    assert.equal(sample.total,plan.total);assert.equal(new Set(sample.refs.map(r=>r.qid)).size,sample.total);
    for(const ref of sample.refs){const p=papers.get(ref.key);assert.ok(!region||region===p.region);assert.ok(!years.length||years.includes(String(p.year)));}
    for(const leaf of plan.ids)assert.equal(sample.refs.filter(r=>r.leaf===leaf).length,plan.allocations[leaf]);
  }
}
// Automatic session metadata must describe the sampled modules and quotas,
// even when the user changes the form while questions are loading.
let resolveAuto;const autoLoading=new Promise(resolve=>{resolveAuto=resolve;});
custom.workflow='exam';custom.selectedModules=['判断推理'];custom.selected=new Set();custom.groupFilters={逻辑填空:{form:blank}};
actionContext.trainingOptions=()=>({workflow:custom.workflow,selectedModules:custom.selectedModules,selected:[],total:25,years:['2025'],region:'国考'});
actionContext.TrainingTools=tools;actionContext.ensureQuestions=()=>autoLoading;
const autoStart=actionContext.actions['start-custom']();
custom.selectedModules=['言语理解与表达'];custom.workflow='targeted';
const autoRefs=tools.sample(index,cat,{workflow:'exam',selectedModules:['判断推理'],total:25,years:['2025'],region:'国考'},1).refs;
resolveAuto(autoRefs);await autoStart;
assert.equal(started.length,2);assert.equal(started[1].training.workflow,'exam');
assert.deepEqual(Array.from(started[1].training.selectedModules),['判断推理']);
assert.equal(Object.keys(started[1].training.groupFilters).length,0);
assert.equal(Object.values(started[1].training.groupAllocations).reduce((a,b)=>a+b,0),25);
assert.ok(started[1].title.includes('判断推理随机训练'));
// Exam categories constrain both paper selection and every source occurrence.
const examPapers=[
  {id:'national',name:'2025年国家公务员录用考试',year:2025,region:'国考'},
  {id:'provincial',name:'2025年海南公务员考试A类卷',year:2025,region:'海南'},
  ...['A','B','C'].map(examClass=>({id:'institution'+examClass,name:'2025年事业单位职测'+examClass+'类',year:2025,region:'海南',examType:'institution',examClass})),
  {id:'unknown',name:'2025年事业单位职测',year:2025,region:'海南'},
];
assert.equal(tools.paperExam(examPapers[0]).examType,'national');
assert.equal(tools.paperExam(examPapers[1]).examType,'provincial');
assert.equal(tools.paperExam(examPapers[1]).examClass,'','provincial A/B papers cannot become institution categories');
assert.equal(tools.paperExam({name:'2026年事业编C类',region:'安徽'}).examClass,'C');
assert.equal(tools.paperExam({name:'2026年职测（Ｂ类）',examType:'事业编',examClass:'Ｂ类'}).examClass,'B');
assert.equal(tools.paperExam({name:'普通卷',examType:'institution',examClass:'A'}).examType,'institution','explicit imported metadata is authoritative');
const categoryCatalog={modules:['判断'],papers:examPapers},categoryIndex={groups:[examGroups[0]],records:examPapers.map((p,i)=>({qid:p.id,leaf:examGroups[0].leaves[0].id,t:'family0',src:[[p.id,i+1,0,p.id]]}))};
for(const examType of ['national','provincial','institution'])for(const examClass of ['','A','B','C']){
  const options={...examOptions,examType,examClass,region:'',total:10};
  const sample=tools.sample(categoryIndex,categoryCatalog,options,1);
  const expected=examPapers.filter(p=>tools.paperMatches(p,options));
  assert.equal(sample.total,expected.length);
  for(const r of sample.refs){const e=tools.paperExam(examPapers.find(p=>p.id===r.key));assert.equal(e.examType,examType);if(examType==='institution'&&examClass)assert.equal(e.examClass,examClass);}
}
assert.equal(tools.plan(categoryIndex,categoryCatalog,{...examOptions,examType:'institution',examClass:'A',region:'国考',total:10}).total,0,'category and region intersect on the same original paper');
assert.equal(tools.plan(index,cat,{...examOptions,selectedModules:['判断推理'],examType:'institution',region:'',examClass:'A'}).total,25,'institution questions are available');
for(const examClass of ['A','B','C']){
  const options={workflow:'exam',selectedModules:cat.modules,total:100,examType:'institution',examClass,years:['2026'],region:'',allocationSeed:25};
  const sample=tools.sample(index,cat,options,21),original=cat.papers.filter(p=>p.examType==='institution'&&p.examClass===examClass&&p.year===2026);
  assert.equal(original.length,1);assert.equal(sample.total,100);
  assert.deepEqual(Object.fromEntries(Object.entries(sample.moduleAllocations).filter(([,n])=>n)),JSON.parse(JSON.stringify(original[0].moduleCounts)),'one-paper distribution follows original module counts');
  for(const r of sample.refs)assert.equal(r.key,original[0].id,'classes never mix or borrow civil-service questions');
}
const b2022=tools.plan(index,cat,{workflow:'exam',selectedModules:cat.modules,total:25,examType:'institution',examClass:'B',years:['2022'],region:'全国联考'}).papers;
assert.equal(b2022.length,2);assert.ok(b2022.every(p=>p.examDate!=='2022-09-17'),'no invented missing B-class September paper');
const pending=statistics.summarize({refs:[{qid:'known',type:'常识判断'},{qid:'unknown',type:'常识判断'},{qid:'unanswered',type:'常识判断'}],answers:{known:{pick:'A'},unknown:{pick:'B'}}},[{qid:'known',answer:'A'},{qid:'unknown',answer:''},{qid:'unanswered',answer:'C'}]);
assert.equal(pending.answered,2);assert.equal(pending.graded,1);assert.equal(pending.pending,1);assert.equal(pending.wrong,0);assert.equal(pending.accuracy,1);assert.equal(pending.rows[1].correct,null);
const identity={stripTags:html=>String(html||'').replace(/<[^>]*>/g,'')};
vm.runInNewContext(appSource.slice(appSource.indexOf('function questionKey('),appSource.indexOf('const isFavorite')),identity);
const crop={original:true,stem:'<img src="crop.jpg">',options:['A','B','C','D'].map(k=>({k,t:k}))};
assert.notEqual(identity.questionKey({...crop,qid:'sy-one'}),identity.questionKey({...crop,qid:'sy-two'}),'empty OCR/image-only questions must never share favorites');
assert.equal(identity.questionKey({...crop,qid:'sy-one'}),'original:sy-one','original question identity stays tied to the stable source ID');
// The paper selector has only whole-paper and module choices. Starting from
// whole-paper then clicking one module isolates it; later clicks add/remove.
const paper=cat.papers.find(p=>p.id==='pe73c52b327'),view={paperSel:{[paper.id]:new Set(Object.keys(paper.types))}};
const selection={V:view,CAT:cat,paperById:new Map([[paper.id,paper]]),moduleOfType:statistics.moduleForTest,render:()=>{}};
const selectStart=appSource.indexOf("  'psel-module-toggle'(e,el) {");
const selectEnd=appSource.indexOf('  /** 从列表页直接只做某个模块 */',selectStart);
vm.runInNewContext('globalThis.actions={'+appSource.slice(selectStart,selectEnd)+'}',selection);
const clickModule=m=>selection.actions['psel-module-toggle'](null,{dataset:{id:paper.id,m}});
clickModule('言语理解与表达');assert.ok([...view.paperSel[paper.id]].every(t=>statistics.moduleForTest(t)==='言语理解与表达'));
clickModule('判断推理');assert.ok([...view.paperSel[paper.id]].some(t=>statistics.moduleForTest(t)==='判断推理'));
clickModule('言语理解与表达');assert.ok([...view.paperSel[paper.id]].every(t=>statistics.moduleForTest(t)==='判断推理'));
clickModule('判断推理');assert.equal(view.paperSel[paper.id].size,0);
selection.actions['psel-all'](null,{dataset:{id:paper.id}});assert.equal(view.paperSel[paper.id].size,Object.keys(paper.types).length);
const paperView=appSource.slice(appSource.indexOf('async function viewPaper('),appSource.indexOf('function saveCustom('));
assert.ok(!paperView.includes('psel-type')&&!paperView.includes('psel-module-only')&&!paperView.includes('psel-none'));
assert.ok(!paperView.includes('download-questions'),'no duplicate printable HTML export entry');
assert.ok(paperView.includes('print-questions')&&paperView.includes('download-question-pdf'));
const printContext={ExamFormat:{stem:x=>x}};
vm.runInNewContext(appSource.slice(appSource.indexOf('function printableQuestion('),appSource.indexOf('function reportDocuments(')),printContext);
const originalProjection=printContext.printableQuestion({type:'图形推理',stem:'<img src="assets/img/institution/q.jpg">',material:'材料',options:[{k:'A',t:'OCR'}],original:true,answer:'A',explanation:'解析',sourceText:{stem:'OCR'}});
assert.equal(originalProjection.options.length,0,'original crop already includes every option; print must not duplicate OCR options');
assert.ok(!('answer' in originalProjection)&&!('explanation' in originalProjection),'blank sheets never leak answers or personal records');
const filterContext={CAT:{...categoryCatalog,typeOrder:['family0']},TrainingTools:tools,V:{paperFilter:{}}};
vm.runInNewContext(appSource.slice(appSource.indexOf('function filteredPapers('),appSource.indexOf('function viewPapers(')),filterContext);
const futureCatalog=filterContext.CAT;futureCatalog.papers=examPapers.map(p=>({...p,count:1,types:{family0:1}}));
assert.deepEqual(Array.from(filterContext.filteredPapers({examType:'institution',examClass:'B',year:'2025',region:'海南',type:'family0',q:'事业',sort:'year'}),p=>p.id),['institutionB'],'paper picker applies category/class/year/region/type/search together');
const randomAction=appSource.slice(appSource.indexOf("  async 'quiz-random-paper'() {"),appSource.indexOf('  /* 卷详情页：勾选'));
let selectedRoute='';const randomContext={filteredPapers:()=>futureCatalog.papers.filter(p=>p.id==='institutionC'),go:url=>{selectedRoute=url;},toast:()=>{}};
vm.runInNewContext('globalThis.actions={'+randomAction+'}',randomContext);await randomContext.actions['quiz-random-paper']();
assert.equal(selectedRoute,'#/paper/institutionC','random whole-paper choice respects the active filtered list');
console.log(`PASS specialist training: ${sourceCount} exact sources, ${leaves.size} tags, weighted allocation/capacity, year-region intersection, no repeated qids, preview accuracy, source labels and unseen preference.`);
