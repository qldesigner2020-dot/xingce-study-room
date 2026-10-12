import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {buildOffline,buildUpdateEntry} from './offline-build.mjs';

const source=fs.readFileSync('client/assets/site-update.js','utf8'),version='1234567890abcdef1234';
const settle=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
function fixture(options={}){
  const elements=new Map(['update-status','update-retry','update-enter'].map(id=>[id,{hidden:false,textContent:'',href:'',listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}}]));
  let clock=0,sequence=0,registers=0,unregisters=0,readyReads=0,requests=0,replaces=[];
  const timers=new Map();
  class Worker{
    state=options.installing?'installing':options.waiting?'installed':'activated';
    listeners=new Set();
    addEventListener(_,fn){this.listeners.add(fn);}
    removeEventListener(_,fn){this.listeners.delete(fn);}
    change(state){this.state=state;for(const fn of [...this.listeners])fn();}
    postMessage({type},ports){
      if(options.silent)return;
      if(type==='VERSION')queueMicrotask(()=>ports[0].postMessage({value:{version:options.stale?'ffffffffffffffffffff':version,shellReady:!options.incomplete}}));
      if(type==='ACTIVATE'){
        queueMicrotask(()=>{reg.active=this;reg.waiting=null;this.change('activated');ports[0].postMessage({value:{activated:true}});});
      }
    }
  }
  class Channel{
    port1={onmessage:null,closed:false,close(){this.closed=true;}};
    port2={postMessage:data=>{if(!this.port1.closed)this.port1.onmessage?.({data});}};
  }
  const worker=new Worker(),base='https://fixture.test/xingce-study-room/';
  const reg={scope:options.foreign?base.replace('xingce-study-room/',''):base,
    active:options.installing||options.waiting?null:worker,waiting:options.waiting?worker:null,installing:options.installing?worker:null,
    unregister:async()=>{unregisters++;return options.unreleased?false:true;},
    update:async()=>{if(options.updateHang)return new Promise(()=>{});if(options.installing||options.waiting)throw new Error('Do not duplicate an in-progress install');}};
  const serviceWorker={
    register:async()=>{registers++;if(options.registerHang)return new Promise(()=>{});if(options.registerError)throw new Error('注册失败');return reg;},
    getRegistration:async()=>options.noRegistration?undefined:reg,
    get ready(){readyReads++;throw new Error('ready must not gate opening the website');}
  };
  const navigator={onLine:!options.offline};if(!options.unsupported)navigator.serviceWorker=serviceWorker;
  const location={href:options.file?'file:///D:/fixture/update.html':base+'update.html?repair=2#/insights',protocol:options.file?'file:':'https:',origin:options.file?'null':'https://fixture.test',hash:'#/insights',replace:url=>replaces.push(url)};
  vm.runInNewContext(source,{
    window:{origin:options.preview?'null':location.origin},
    document:{getElementById:id=>elements.get(id)},location,navigator,URL,AbortController,MessageChannel:Channel,queueMicrotask,
    setTimeout:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout:id=>timers.delete(id),
    fetch:async(url,init)=>{requests++;assert.match(url,/^site-version\.json\?website-update=/);assert.equal(init.cache,'no-store');
      if(options.fetchHang)return new Promise(()=>{});
      return {ok:!options.httpError,json:async()=>options.bodyHang?new Promise(()=>{}):{version:options.invalid?'invalid':version}};}
  });
  const tick=async(ms)=>{
    clock+=ms;for(const [id,timer] of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}await settle();
  };
  return {elements,worker,reg,tick,
    get registers(){return registers;},get unregisters(){return unregisters;},get readyReads(){return readyReads;},get requests(){return requests;},get replaces(){return replaces;},get timers(){return timers;},
    retry:()=>elements.get('update-retry').listeners.click(),
    enter:()=>elements.get('update-enter').listeners.click({preventDefault(){}}),
    install:()=>{reg.installing=null;reg.waiting=worker;worker.change('installed');}
  };
}
let f=fixture();await settle();assert.deepEqual(f.replaces,['./#/insights']);assert.equal(f.readyReads,0);assert.equal(f.timers.size,0);assert.equal(f.unregisters,0);
f=fixture({waiting:true});await settle();assert.deepEqual(f.replaces,['./#/insights']);assert.equal(f.worker.state,'activated');assert.equal(f.timers.size,0);
f=fixture({installing:true});await settle();assert.match(f.elements.get('update-status').textContent,/新版网页/);f.install();await settle();assert.deepEqual(f.replaces,['./#/insights']);assert.equal(f.worker.listeners.size,0);

for(const [options,ms,expected] of [
  [{fetchHang:true},12000,/版本检查超时/],
  [{bodyHang:true},12000,/版本检查超时/],
  [{registerHang:true},20000,/连接更新超时/],
  [{updateHang:true},20000,/检查网页更新超时/],
  [{installing:true},60000,/加载超时/],
  [{silent:true},10000,/没有响应/]
]){
  f=fixture(options);await settle();await f.tick(ms);
  assert.match(f.elements.get('update-status').textContent,expected);
  assert.equal(f.elements.get('update-retry').hidden,false);assert.equal(f.replaces.length,0);assert.equal(f.timers.size,0);assert.equal(f.worker.listeners.size,0);
}
for(const options of [{stale:true},{incomplete:true},{registerError:true},{httpError:true},{invalid:true},{unsupported:true},{offline:true}]){
  f=fixture(options);await settle();assert.equal(f.elements.get('update-retry').hidden,false);assert.equal(f.replaces.length,0);assert.equal(f.timers.size,0);
}
f=fixture({installing:true});await settle();f.worker.change('redundant');await settle();assert.match(f.elements.get('update-status').textContent,/失败/);assert.equal(f.worker.listeners.size,0);
f=fixture({fetchHang:true});f.retry();f.retry();await settle();assert.equal(f.requests,1,'repeated clicks cannot create parallel updates');await f.tick(12000);f.retry();await settle();assert.equal(f.requests,2,'retry works after a timeout');await f.tick(12000);
f=fixture({fetchHang:true});await settle();await f.enter();await settle();assert.equal(f.unregisters,1);assert.match(f.replaces[0],/website-online=.*#\/insights$/);assert.equal(f.timers.size,0);await f.tick(90000);assert.equal(f.replaces.length,1,'cancelled update cannot later override online navigation');
f=fixture({foreign:true,fetchHang:true});await settle();await f.enter();assert.equal(f.unregisters,0,'do not unregister a shared host controller');
f=fixture({unsupported:true});await settle();await f.enter();assert.equal(f.unregisters,0);assert.equal(f.replaces.length,1);
f=fixture({unreleased:true,fetchHang:true});await settle();await f.enter();assert.equal(f.replaces.length,0);assert.match(f.elements.get('update-status').textContent,/无法切换/);
f=fixture({offline:true});await settle();await f.enter();assert.equal(f.unregisters,0);assert.equal(f.replaces.length,0);
for(const options of [{preview:true},{file:true}]){
  f=fixture(options);await settle();assert.equal(f.requests,0);assert.equal(f.registers,0);assert.equal(f.elements.get('update-enter').target,'_blank');
  assert.match(f.elements.get('update-status').textContent,/网页预览/);assert.match(f.elements.get('update-enter').href,/^https:\/\/baohuafen-trainer-/);
  await f.enter();assert.equal(f.unregisters,0,'opaque/file previews never call forbidden service worker APIs');
}
assert.ok(!/localStorage|indexedDB|caches\.delete|\.clear\(/.test(source),'recovery does not touch practice data');

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'xingce-update-test-'));
try{
  fs.mkdirSync(path.join(temp,'assets'),{recursive:true});fs.mkdirSync(path.join(temp,'data'),{recursive:true});
  fs.copyFileSync('client/update.html',path.join(temp,'update.html'));fs.copyFileSync('client/assets/site-update.js',path.join(temp,'assets/site-update.js'));
  for(const file of ['app.css','exam.css','mobile.css','tablet.css'])fs.copyFileSync('client/assets/'+file,path.join(temp,'assets',file));
  fs.copyFileSync('client/sw.js',path.join(temp,'sw.js'));
  fs.writeFileSync(path.join(temp,'data/catalog.js'),'window.QB_CATALOG={papers:[]};');
  buildUpdateEntry(temp);const html=fs.readFileSync(path.join(temp,'update.html'),'utf8');
  assert.ok(html.includes(source.trim()));assert.ok(!/<script src=|<link rel="stylesheet"/.test(html),'recovery has no blocking external dependencies');
  assert.match(html,/\[hidden\]\{display:none!important\}/);
  const pack=buildOffline(temp),info=JSON.parse(fs.readFileSync(path.join(temp,'site-version.json'),'utf8'));
  assert.equal(info.version,pack.version);assert.ok(fs.statSync(path.join(temp,'site-version.json')).size<100);
  assert.ok(!pack.files.some(x=>x.url==='site-version.json'),'no recursive version hash');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
console.log('PASS update recovery: bounded network/body/registration/install/RPC, first install, activation, retries, online escape, shared scope and data preservation');
