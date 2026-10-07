import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('client/assets/cloud-sync.js','utf8');
const saved=new Map(),server=new Map();
const copy=v=>JSON.parse(JSON.stringify(v));
const snapshot=()=>copy({userId:'owner',records:[...server.values()],conflicts:[],conflict:false});
let hold=false,release,entered,failNext=false,failRelease,failEntered;
const backend={ready:Promise.resolve({guest:false}),isGuest:()=>false,async request(method='GET',changes=[]) {
  if(method==='GET'&&hold) {hold=false;const old=snapshot();entered();await new Promise(r=>release=r);return old;}
  if(method==='POST') {
    if(failNext){failNext=false;failEntered();await new Promise(r=>failRelease=r);throw new TypeError('offline');}
    for(const r of changes)assert.equal(r.version,server.get(r.key)?.version||0);
    for(const r of changes)server.set(r.key,{...copy(r),version:r.version+1});
  }
  return snapshot();
}};
function tab() {
  const polls=[],events={};
  const sandbox={window:{CloudBackend:backend,addEventListener:(n,fn)=>events[n]=fn},
    document:{querySelectorAll:()=>[],activeElement:null,addEventListener(){},createElement:()=>({}),body:{appendChild(){}}},
    localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v))},
    TextEncoder,setTimeout:()=>0,clearTimeout(){},setInterval:fn=>polls.push(fn)};
  vm.runInNewContext(source,sandbox);
  return {sync:sandbox.window.CloudSync,pull:()=>polls[0](),storage:()=>events.storage({key:'qb.cloud.journal.v1'})};
}
const a=tab();await a.sync.ready;const b=tab();await b.sync.ready;
await new Promise(resolve=>setImmediate(resolve));
const session={id:'new-practice',answers:{q:{pick:'C',reflection:'不能丢失',review:{confidence:'hesitant'}}}};
const waitEntered=new Promise(r=>entered=r);hold=true;
const oldPull=b.pull();await waitEntered;
saved.set('qb.sessions.v1',JSON.stringify([session]));a.sync.changed('qb.sessions.v1',[session]);
// This tab's late response must retain an acknowledged write by the other tab.
await a.sync.flush();release();await oldPull;
assert.deepEqual(JSON.parse(saved.get('qb.sessions.v1')),[session]);
assert.equal(server.get('session:new-practice').version,1);

// Unsent changes from different tabs must coexist in the same durable queue.
const edited={...session,answers:{q:{pick:'C',reflection:'跨标签编辑',review:{confidence:'guess'}}}};
saved.set('qb.sessions.v1',JSON.stringify([edited]));a.sync.changed('qb.sessions.v1',[edited]);
b.sync.changed('qb.favorites.v1',{question:{ref:{qid:'q'}}});
const pending=JSON.parse(saved.get('qb.cloud.journal.v1')).pending;
assert(pending['session:new-practice']);assert(pending['favorite:question']);
await b.sync.flush();a.storage();
assert.equal(server.get('session:new-practice').value.answers.q.reflection,'跨标签编辑');
assert.equal(Object.keys(JSON.parse(saved.get('qb.cloud.journal.v1')).pending).length,0);
assert.deepEqual(JSON.parse(saved.get('qb.sessions.v1')),[edited]);

// A failed upload must not roll back edits queued elsewhere during that request.
const offlineEdit={...edited,answers:{q:{pick:'C',reflection:'离线后仍保留'}}};
saved.set('qb.sessions.v1',JSON.stringify([offlineEdit]));a.sync.changed('qb.sessions.v1',[offlineEdit]);
const waitFailure=new Promise(r=>failEntered=r);failNext=true;
const failing=a.sync.flush();await waitFailure;
b.sync.changed('qb.favorites.v1',{question:{ref:{qid:'q'}},another:{ref:{qid:'second'}}});
failRelease();await failing;
assert(JSON.parse(saved.get('qb.cloud.journal.v1')).pending['favorite:another']);
await a.sync.flush();
assert.equal(server.get('session:new-practice').value.answers.q.reflection,'离线后仍保留');
assert(server.get('favorite:another'));

// Typography must remain idempotent and retain offsets of saved ink/text marks.
const formatScope={module:{exports:{}}};vm.runInNewContext(fs.readFileSync('client/assets/exam-format.js','utf8'),formatScope);
const format=formatScope.module.exports;
const raw='<p>庙堂······留之……，大多____。<img src="dots......png"></p>';
const html=format.stem(raw,'逻辑填空');
assert.equal((html.match(/class="exam-ellipsis"/g)||[]).length,2);
assert(html.includes('dots......png'));
assert.equal(format.stem(html,'逻辑填空'),html);
assert.equal(html.replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' '),'庙堂······留之……，大多 。');
console.log('PASS multi-tab: late responses, shared pending edits, cache preservation and punctuation offsets');
