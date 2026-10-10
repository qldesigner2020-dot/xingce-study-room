import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {transform} from 'esbuild';

const origin='https://example.test/study/',contents=new Map([
  ['index.html','<html>offline</html>'],['assets/app.js','app-v1'],['data/papers/p1.js','paper-one'],['assets/img/one.png','image-one'],
  ['data/pools/q1.js','specialist']]);
const manifest=version=>({version,files:[...contents].map(([url,text])=>({url,bytes:Buffer.byteLength(text),
  integrity:'sha256-'+crypto.createHash('sha256').update(text).digest('base64'),group:/^(data|assets\/img)/.test(url)?'data':'core'})),
  papers:[{id:'p1',files:['data/papers/p1.js','assets/img/one.png']}],questions:1});
class Cache {
  values=new Map();
  key=r=>typeof r==='string'?r:r.url;
  async put(r,v){this.values.set(this.key(r),v.clone());}
  async match(r){return this.values.get(this.key(r))?.clone();}
  async keys(){return [...this.values.keys()].map(url=>new Request(url));}
}
const caches={values:new Map(),async open(n){if(!this.values.has(n))this.values.set(n,new Cache());return this.values.get(n);},
  async keys(){return [...this.values.keys()];},async delete(n){return this.values.delete(n);}};
let network=true,missing='',requests=0,activated=0;
const create=pack=>{
  const handlers={};
  const self={location:{href:origin+'sw.js'},addEventListener:(name,fn)=>handlers[name]=fn,
    clients:{claim:async()=>{},matchAll:async()=>[]},skipWaiting:async()=>activated++};
  const sandbox={self,caches,URL,Request,Response,AbortController,DOMException,setTimeout,clearTimeout,
    async fetch(url,options){requests++;if(!network||url.endsWith(missing||'NEVER'))throw new TypeError('offline');
      const text=contents.get(url.slice(origin.length));assert.ok(text,'only allowlisted resources may be requested');
      assert.equal(options.integrity,'sha256-'+crypto.createHash('sha256').update(text).digest('base64'));
      return new Response(text);}};
  vm.runInNewContext(fs.readFileSync('client/sw.js','utf8').replace('/* OFFLINE_PACKAGE */ null',JSON.stringify(pack)),sandbox);
  const lifecycle=async name=>{let work;handlers[name]({waitUntil:p=>work=p});await work;};
  const message=async(type,target)=>{
    let work,result;
    handlers.message({data:{type,target},ports:[{postMessage:x=>result=x}],waitUntil:p=>work=p});await work;
    if(result?.error)throw new Error(result.error);return result?.value;
  };
  const fetchResource=async path=>{
    let response;
    handlers.fetch({request:{method:'GET',mode:path===''?'navigate':'cors',url:origin+path},respondWith:p=>response=p});
    return response?await response:undefined;
  };
  return {lifecycle,message,fetchResource};
};
const first=create(manifest('v1'));
await first.lifecycle('install');await first.lifecycle('activate');
assert.equal((await first.message('STATUS')).shellReady,true);
assert.equal((await first.message('STATUS')).complete,false);
await first.message('DOWNLOAD','p1');
let status=await first.message('STATUS');assert.deepEqual([...status.papers],['p1']);assert.equal(status.complete,false);
network=false;
assert.match(await (await first.fetchResource('')).text(),/offline/);
assert.equal(await (await first.fetchResource('assets/img/one.png')).text(),'image-one');
assert.equal((await first.fetchResource('data/pools/q1.js')).status,503);
assert.equal(await first.fetchResource('private.json'),undefined,'unknown requests stay outside the worker');
network=true;missing='q1.js';await first.message('DOWNLOAD','all');
status=await first.message('STATUS');assert.equal(status.complete,false);assert.equal(status.running,false);assert.match(status.error,/下载中断/);
const before=requests;missing='';await first.message('DOWNLOAD','all');
assert.equal(requests-before,1,'resume downloads only the missing file');assert.equal((await first.message('STATUS')).complete,true);
// Updating a full offline package must complete before it can replace the old
// worker, including automatic activation when all previous windows close.
contents.set('assets/app.js','app-v2');contents.set('data/pools/q1.js','specialist-v2');
const broken=create(manifest('v2'));missing='q1.js';await assert.rejects(broken.lifecycle('install'));
assert.equal((await first.message('STATUS')).complete,true,'failed new install preserves old full cache');
const second=create(manifest('v2'));missing='';const updateStart=requests;await second.lifecycle('install');
assert.equal(requests-updateStart,1,'update reuses every unchanged resource and resumes the interrupted install');
assert.equal((await second.message('STATUS')).complete,true);
await second.message('ACTIVATE');assert.equal(activated,1);await second.lifecycle('activate');
network=false;assert.equal(await (await second.fetchResource('assets/app.js')).text(),'app-v2');
assert.equal(await (await first.fetchResource('assets/app.js')).text(),'app-v1');
await second.message('CLEAR');assert.equal((await second.message('STATUS')).complete,false);
assert.equal((await second.message('STATUS')).shellReady,true);
await assert.rejects(second.message('DOWNLOAD','unknown'),/试卷不存在/);

// Exercise the real login adapter: cold guest startup and expired authenticated
// sessions never require a network refresh to open this device's records.
const backend=(await transform(fs.readFileSync('src/backend.js','utf8').replace("import {createClient} from '@supabase/supabase-js';",''),{format:'iife'})).code;
const authRun=async({guest=false,sessionUser='a',journalUser='a'})=>{
  const saved=new Map([['qb.cloud.journal.v1',JSON.stringify({userId:journalUser})],
    ['sb-fixture-auth-token',JSON.stringify({user:{id:sessionUser,email:'fixture@test'},refresh_token:'fixture',expires_at:1})]]);
  if(guest)saved.set('qb.cloud.guest.v1','1');
  let creates=0;
  const storage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v)),removeItem:k=>saved.delete(k)};
  const window={STUDY_CLOUD_CONFIG:{url:'https://fixture.supabase.co',publishableKey:'sb_publishable_fixture'},addEventListener(){}};
  const sandbox={window,localStorage:storage,sessionStorage:{...storage,getItem:()=>null},navigator:{onLine:false},
    location:{href:origin,search:'',hash:''},URL,setTimeout,clearTimeout,AbortController,
    document:{addEventListener(){},getElementById:()=>({innerHTML:''})},
    createClient(){creates++;return {auth:{onAuthStateChange(){},getSession:async()=>({data:{session:{user:{id:sessionUser}}}})}};}};
  vm.runInNewContext(backend,sandbox);
  const result=await window.CloudBackend.ready;return {result,creates,api:window.CloudBackend};
};
let auth=await authRun({});assert.equal(auth.result.offline,true);assert.equal(auth.result.userId,'a');assert.equal(auth.creates,0);
await assert.rejects(auth.api.request('GET'),/offline/);
auth=await authRun({guest:true});assert.equal(auth.result.guest,true);assert.equal(auth.creates,0);
// Offline identity mismatch must leave the login/local-mode choice pending,
// rather than identify this device's previous records as the new account.
// The cloud adapter's mismatch behavior is verified separately below.

const cloudSource=fs.readFileSync('client/assets/cloud-sync.js','utf8');
const cloudRun=async(auth)=>{
  const saved=new Map([['qb.cloud.journal.v1',JSON.stringify({userId:'a',records:{active:{value:{id:'old'}}},pending:{},conflicts:[]})],
    ['qb.active.v1',JSON.stringify({id:'old'})]]);
  const storage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v)),removeItem:k=>saved.delete(k)};
  let calls=0;
  const window={CloudBackend:{ready:Promise.resolve(auth),isGuest:()=>false,request:async()=>{calls++;throw new TypeError('offline');}},addEventListener(){}};
  vm.runInNewContext(cloudSource,{window,localStorage:storage,TextEncoder,setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,
    document:{querySelectorAll:()=>[],activeElement:null,addEventListener(){},createElement:()=>({}),body:{appendChild(){}}}});
  await window.CloudSync.ready;return {saved,calls};
};
let cloud=await cloudRun({guest:false,userId:'a',offline:true});assert.equal(cloud.calls,0);assert.ok(cloud.saved.has('qb.active.v1'));
cloud=await cloudRun({guest:false,userId:'b'});assert.equal(cloud.saved.has('qb.active.v1'),false,'another account cannot reopen previous local records');
assert.ok(cloud.saved.has('qb.cloud.previous-account'),'previous account remains recoverable');
assert.ok(!fs.readFileSync('client/sw.js','utf8').includes('localStorage'),'clearing downloads cannot clear user records');
console.log('PASS phone offline: partial/full cache, cold navigation/images, failures/resume, atomic updates, guest/auth startup and account isolation');
