import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {IDBFactory,IDBDatabase} from 'fake-indexeddb';
import {fixtureDatabase,owner,other} from './test-database.mjs';
const source=p=>fs.readFileSync('client/assets/'+p,'utf8');
const context={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Blob,DOMException,setTimeout,atob,console};context.window=context;vm.createContext(context);
for(const p of ['training-tools.js','study-report-data.js','export-tools.js','study-report-export.js'])vm.runInContext(source(p),context);
const D=context.StudyReportData,E=context.StudyReportExport;
const q={qid:'q',no:1,module:'判断推理',type:'图形推理',classification:{group:'图形推理',tag:'位置规律'},stem:'<p>选择正确图形<img src="assets/img/a.png"></p>',material:'',options:[{k:'A',t:'甲'},{k:'B',t:'乙'}],answer:'A',explanation:'解析',answerStatus:'reference'};
const catalog={papers:[{id:'p1',examType:'provincial',year:2025,region:'海南',name:'海南真题'},{id:'p2',examType:'national',year:2026,region:'国考',name:'国考真题'}]};
const session=(id,day,answer='A',review={},key='p1',qid='q')=>({id,title:id,kind:'paper',submitted:true,createdAt:day-1000,submittedAt:day,refs:[{src:'p',key,qid,no:1}],answers:{[qid]:{pick:answer,ms:30000,review,reflection:'证据 '+id,excluded:'BC'}}});
const load=async ref=>ref.qid==='missing'?Promise.reject(new Error('not found')):ref.qid==='unknown'?{...q,answer:''}:ref.qid==='different'?{...q,stem:q.stem.replace('a.png','different.png')}:{...q,stem:ref.key==='p2'?q.stem.replace('a.png','copy.png'):q.stem};
const hashImage=async p=>D.hash(new Uint8Array(p.includes('different')?[2]:[1]));
const data=await D.build([session('one',1000,'B'),session('two',2000,'A',{confidence:'guess'},'p2'),session('three',3000,'A',{confidence:'hesitant'}),session('unknown',4000,'A',{},'p1','unknown'),session('unanswered',5000,''),session('different',6000,'A',{},'p1','different'),session('missing',7000,'A',{},'p1','missing')],{loadQuestion:load,catalog,hashImage});
const stats=D.select(data).overall;
assert.equal(stats.answered,6);assert.equal(stats.graded,4);assert.equal(stats.right,3);assert.equal(stats.accuracy,.75);assert.equal(stats.unique,4);assert.equal(stats.firstN,2);assert.equal(stats.firstRight,1);assert.equal(stats.guessCorrect,1);assert.equal(stats.hesitant,1);
assert.equal(D.select(data,{from:2000}).overall.firstN,1,'date filters must not relabel an old question as new');
assert.equal(data.rows[0].contentId,data.rows[1].contentId,'cross-paper copies with equal image bytes merge');assert.notEqual(data.rows[0].contentId,data.rows[5].contentId,'different figures stay distinct');
assert.equal(data.rows[0].sourceId===data.rows[1].sourceId,false);
assert.equal(D.select(data).modules.reduce((n,g)=>n+g.graded,0),stats.graded);assert.equal(D.select(data).concepts.reduce((n,g)=>n+g.graded,0),stats.graded);
const remembered=await D.build([session('remember',1,'A',{familiarity:'remember'}),session('repeat',2,'A',{familiarity:'forgot'})],{loadQuestion:load,catalog,hashImage});
assert.equal(D.select(remembered).overall.firstN,0);assert.equal(D.select(remembered).overall.remembered,1);
const unavailable=await D.build([session('unreadable1',1),session('unreadable2',2,'A',{},'p2')],{loadQuestion:async()=>q,catalog,hashImage:()=>Promise.reject(new Error('offline'))});
assert.notEqual(unavailable.rows[0].contentId,unavailable.rows[1].contentId,'unresolved images must use each original location');
const count=10000,bulk=Array.from({length:count},(_,i)=>session('bulk'+i,i+10000,'A',{confidence:i%2?'clear':'guess'}));
const stress=await D.build(bulk,{loadQuestion:load,catalog,hashImage});assert.equal(stress.rows.length,count);assert.equal(D.select(stress).overall.unique,1);assert.equal(D.select(stress).overall.firstN,1);
const stop=new AbortController();stop.abort();await assert.rejects(()=>D.build(bulk,{loadQuestion:load,catalog,hashImage,signal:stop.signal}),e=>e.name==='AbortError');
// Real IndexedDB semantics, with legacy >150 migration and a reopened page.
const factory=new IDBFactory(),saved=new Map([['qb.sessions.v1',JSON.stringify(bulk.slice(0,180))]]),events=[];
function storageTab(){const listeners={};const sandbox={window:null,indexedDB:factory,CustomEvent:class{constructor(type,props){this.type=type;Object.assign(this,props);}},localStorage:{get length(){return saved.size;},key:i=>[...saved.keys()][i],getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,String(v)),removeItem:k=>saved.delete(k)},console};sandbox.window=sandbox;sandbox.addEventListener=(n,fn)=>listeners[n]=fn;sandbox.dispatchEvent=e=>events.push(e);vm.runInNewContext(source('study-storage.js'),sandbox);return sandbox.StudyStorage;}
const storage=storageTab();assert.equal(await storage.ready,true);assert.equal(JSON.parse(storage.getItem('qb.sessions.v1')).length,180);assert.equal(saved.has('qb.sessions.v1'),false);
storage.setItem('qb.sessions.v1',JSON.stringify(bulk));await storage.flush();const reopened=storageTab();await reopened.ready;assert.equal(JSON.parse(reopened.getItem('qb.sessions.v1')).length,count,'no rolling limit');
const before=JSON.parse(storage.getItem('qb.sessions.v1'));before[0].answers.q.reflection='逐条改动';storage.setItem('qb.sessions.v1',JSON.stringify(before));await storage.flush();await reopened.refresh();assert.equal(JSON.parse(reopened.getItem('qb.sessions.v1')).find(s=>s.id===before[0].id).answers.q.reflection,'逐条改动');
storage.setItem('qb.cloud.journal.v1',JSON.stringify({userId:'owner',records:{'session:x':{version:1,value:{id:'x'}}},pending:{'favorite:y':{seq:1,value:{ref:{qid:'q'}}}},conflicts:[]}));await storage.flush();await reopened.refresh();assert.equal(JSON.parse(reopened.getItem('qb.cloud.journal.v1')).pending['favorite:y'].seq,1);
// A failed deletion remains pending and the visible retry action replays it.
const originalTransaction=IDBDatabase.prototype.transaction;let abortNextWrite=true;
IDBDatabase.prototype.transaction=function(...args){const tx=originalTransaction.apply(this,args);if(abortNextWrite&&args[1]==='readwrite'){abortNextWrite=false;queueMicrotask(()=>tx.abort());}return tx;};
try{storage.removeItem('qb.cloud.journal.v1');await assert.rejects(()=>storage.flush());assert(storage.pending()>0);await storage.retry();assert.equal(storage.pending(),0);await reopened.refresh();assert.equal(reopened.getItem('qb.cloud.journal.v1'),null);}finally{IDBDatabase.prototype.transaction=originalTransaction;}
const db=await new Promise((resolve,reject)=>{const r=factory.open('xingce-study-records-v2');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const backup=await new Promise(resolve=>{const r=db.transaction('rows').objectStore('rows').get('migration:local-v1');r.onsuccess=()=>resolve(r.result);});assert.equal(backup.value.sessionCount,180);db.close();
// Paginated RPC guard and optimistic writes, incremental reads and tombstones.
const pg=await fixtureDatabase();async function rpc(account,changes=[],after='',since=0,until=null){await pg.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)`,[account?.id||'',JSON.stringify(account?{email:account.email}:{})]);await pg.exec('set role '+(account?'authenticated':'anon'));try{return (await pg.query('select public.study_sync_page($1::jsonb,$2,25,$3,$4) as data',[JSON.stringify(changes),after,since,until])).rows[0].data;}finally{await pg.exec('reset role');}}
await assert.rejects(()=>rpc(null));await assert.rejects(()=>rpc(other));for(let i=0;i<80;i+=20){const r=await rpc(owner,Array.from({length:20},(_,j)=>({key:'session:p'+(i+j).toString().padStart(3,'0'),version:0,value:{id:i+j}})));assert.equal(r.records.length,20,'POST returns only this batch');}
let first=await rpc(owner),next=first.next,received=[...first.records];while(next){const r=await rpc(owner,[],next,0,first.until);received.push(...r.records);next=r.next;}assert.equal(received.length,80);assert.equal(new Set(received.map(r=>r.key)).size,80);
assert.equal((await rpc(owner,[], '',first.until)).records.length,0);const updated=await rpc(owner,[{key:'session:p000',version:1,value:null}]);assert.equal(updated.records.length,1);const incremental=await rpc(owner,[],'',first.until);assert.equal(incremental.records.length,1);assert.equal(incremental.records[0].value,null);assert(incremental.until>first.until);
assert.equal((await rpc(owner,[{key:'session:p000',version:1,value:{id:'resurrect'}}])).conflict,true);await pg.close();
// Real export code, real worker ZIP framing, archive links and byte hashes.
class TestWorker{constructor(){this.ctx={crypto:webcrypto,TextEncoder,Uint8Array,DataView,Blob,self:{postMessage:m=>queueMicrotask(()=>this.onmessage?.({data:m}))}};vm.createContext(this.ctx);vm.runInContext(source('report-zip-worker.js'),this.ctx);}postMessage(m){this.ctx.self.onmessage({data:m});}terminate(){this.onmessage=null;}}
context.Worker=TestWorker;context.ExportTools.images=async md=>Object.fromEntries(context.ExportTools.imagePaths(md).map(p=>[p,Buffer.from('fixture-image').toString('base64')]));
const host={htmlToMd:h=>String(h||'').replace(/<img src="([^"]+)">/g,'![图片]($1)').replace(/<[^>]*>/g,''),loadScript:()=>{},download:()=>{}};
const zipOutputs=[];await E.full({data,host,limitMB:1,onPackage:r=>zipOutputs.push(r)});assert(zipOutputs.length);
function unzip(bytes){const files=new Map();let i=0,v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);while(v.getUint32(i,true)===0x04034b50){const size=v.getUint32(i+18,true),n=v.getUint16(i+26,true),extra=v.getUint16(i+28,true),name=new TextDecoder().decode(bytes.slice(i+30,i+30+n)),start=i+30+n+extra;files.set(name,bytes.slice(start,start+size));i=start+size;}return files;}
for(const output of zipOutputs){const files=unzip(new Uint8Array(await output.blob.arrayBuffer())),manifest=JSON.parse(new TextDecoder().decode(files.get('manifest.json')));assert.equal(manifest.format,'xingce-ai-evidence');for(const file of manifest.files){assert.equal(file.sha256,await D.hash(files.get(file.path)));}
  for(const [name,bytes] of files)if(name.endsWith('.md')){const md=new TextDecoder().decode(bytes);for(const m of md.matchAll(/\]\(([^)]+)\)/g)){const p=m[1].split('#')[0];if(!p||/^https?:/.test(p))continue;const parts=(name.slice(0,name.lastIndexOf('/')+1)+p).split('/'),resolved=[];for(const part of parts)part==='..'?resolved.pop():part!=='.'&&resolved.push(part);assert(files.has(resolved.join('/')),'unresolved '+name+' '+p);}}
  const raw=JSON.parse(new TextDecoder().decode(files.get('raw/question-index.json')));assert.equal(raw.length,manifest.attempts);assert(![...files.values()].some(b=>new TextDecoder().decode(b).includes('refresh_token')));
}
// Same question in two papers keeps both explanation versions and their images.
const versionData=await D.build([session('version-one',10),session('version-two',20,'A',{},'p2')],{loadQuestion:async ref=>({...q,explanation:ref.key==='p2'?'<p>另一来源解析<img src="assets/img/explanation.png"></p>':q.explanation}),catalog,hashImage});
assert.equal(D.select(versionData).overall.unique,1);
const versionOutputs=[];await E.full({data:versionData,host,onPackage:r=>versionOutputs.push(r)});
const versionFiles=unzip(new Uint8Array(await versionOutputs[0].blob.arrayBuffer())),versionJson=JSON.parse(new TextDecoder().decode(versionFiles.get('raw/question-versions.json'))),versionIndex=JSON.parse(new TextDecoder().decode(versionFiles.get('raw/question-index.json')));
assert.equal(Object.keys(versionJson).length,2);
assert.equal(versionIndex.length,2);for(const row of versionIndex){assert(versionJson[row.questionVersionId]);assert.equal(row.order,1);}
const versionMd=new TextDecoder().decode([...versionFiles].find(([name])=>name.startsWith('questions/'))[1]);assert(versionMd.includes('另一来源解析'));
const versionManifest=JSON.parse(new TextDecoder().decode(versionFiles.get('manifest.json')));assert(versionFiles.has(versionManifest.imageSources['assets/img/explanation.png']));
const cancelled=new AbortController();let emitted=0;await assert.rejects(()=>E.full({data:stress,host,signal:cancelled.signal,onProgress:()=>cancelled.abort(),onPackage:()=>emitted++}),e=>e.name==='AbortError');assert.equal(emitted,0);
const splitRows=stress.rows.slice(0,3000),parts=E.planPackages(splitRows,{meta:{'assets/img/a.png':{bytes:100000}},questionPaths:{[splitRows[0].contentId]:['assets/img/a.png']}},1);
assert(parts.length>1);assert.equal(parts.reduce((n,p)=>n+p.rows.length,0),splitRows.length);for(const p of parts){assert(p.paths.includes('assets/img/a.png'));assert(p.estimate<1024*1024,'bounded chunks must split a very long same-question history');}
console.log('PASS report: three-attempt identities, images, scoring, provenance, 10k history, IDB migration, paged RPC, ZIP SHA-256/links and cancellation');
