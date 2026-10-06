import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the real browser journal with a deferred network response. These
// regressions came from continuous quiz edits and PostgreSQL jsonb key order.
const saved=new Map(),records=new Map();
let release,started,first=true;
const inflight=new Promise(resolve=>started=resolve);
const reverse=value=>Array.isArray(value)?value.map(reverse):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).reverse().map(key=>[key,reverse(value[key])])):value;
const snapshot=()=>({userId:'fixture',records:[...records.values()],conflicts:[],conflict:false});
const backend={ready:Promise.resolve({guest:false}),isGuest:()=>false,async request(method='GET',changes=[]) {
  if(method==='POST') {
    const payload=JSON.parse(JSON.stringify(changes));
    if(first){first=false;started(payload);await new Promise(resolve=>release=resolve);}
    for(const row of payload)assert.equal(row.version,records.get(row.key)?.version||0,'next edit must use acknowledged version');
    for(const row of payload)records.set(row.key,{key:row.key,value:reverse(row.value),version:row.version+1,updatedAt:1});
  }
  return snapshot();
}};
const localStorage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,String(value)),removeItem:key=>saved.delete(key)};
const sandbox={window:{CloudBackend:backend,addEventListener(){}},document:{querySelectorAll:()=>[],activeElement:null,
  addEventListener(){},createElement:()=>({}),body:{appendChild(){}}},localStorage,TextEncoder,
  setTimeout:()=>0,clearTimeout(){},setInterval:()=>0};
vm.runInNewContext(fs.readFileSync('client/assets/cloud-sync.js','utf8'),sandbox);
const sync=sandbox.window.CloudSync;
await sync.ready;
let rerenders=0;
sync.bind({onRemote:()=>rerenders++});
const session={id:'race',answers:{q:{pick:'A',reflection:'第一段'}}};
localStorage.setItem('qb.active.v1',JSON.stringify(session));
sync.changed('qb.active.v1',session);
const flushing=sync.flush();
const sent=await inflight;
session.answers.q.reflection='第二段：上传中继续输入';
localStorage.setItem('qb.active.v1',JSON.stringify(session));
sync.changed('qb.active.v1',session);
assert.equal(sent[0].value.answers.q.reflection,'第一段','in-flight snapshot stays immutable');
release();await flushing;
assert.equal(records.get('active').value.answers.q.reflection,session.answers.q.reflection);
assert.equal(records.get('active').version,2);
assert.equal(Object.keys(JSON.parse(saved.get('qb.cloud.journal.v1')).pending).length,0);
assert.equal(JSON.parse(saved.get('qb.cloud.journal.v1')).conflicts.length,0);
assert.equal(rerenders,0,'acknowledging local changes must not redraw and collapse the report');
// Different key order on a subsequent pull must not create a needless write.
sync.changed('qb.active.v1',JSON.parse(JSON.stringify(session)));
await sync.flush();
assert.equal(records.get('active').version,2);
console.log('PASS browser sync: in-flight editing, jsonb key order and acknowledged versions');
