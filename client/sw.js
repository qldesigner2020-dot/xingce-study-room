'use strict';
// Filled by the build. Each worker serves one coherent version of the app.
const PACKAGE = /* OFFLINE_PACKAGE */ null;
if(!PACKAGE)throw new Error('Offline app requires npm run build');
const BASE=new URL('./',self.location.href);
const PREFIX='xingce-offline-'+BASE.pathname.replace(/[^a-z0-9]/gi,'_')+'-';
const SHELL=PREFIX+'shell-'+PACKAGE.version,DATA=PREFIX+'data-'+PACKAGE.version;
const MANIFEST_URL=new URL('offline-manifest.json',BASE).href;
const absolute=file=>new URL(file.url,BASE).href;
const FILES=new Map(PACKAGE.files.map(f=>[absolute(f),f]));
let job=null,jobError='',reusePromise;
const cacheFor=file=>caches.open(file.group==='core'?SHELL:DATA);

async function previousFiles() {
  const result=new Map();
  for(const name of await caches.keys()) {
    if(!name.startsWith(PREFIX+'shell-')||name===SHELL)continue;
    const cache=await caches.open(name),response=await cache.match(MANIFEST_URL);
    if(!response)continue;
    try {
      const old=await response.json();
      for(const f of old.files) {
        const key=f.url+'|'+f.integrity;
        const names=result.get(key)||[];
        names.push(PREFIX+(f.group==='core'?'shell-':'data-')+old.version);result.set(key,names);
      }
    } catch { /* An incomplete older install is not a source of reusable files. */ }
  }
  return result;
}
async function previousComplete() {
  for(const name of await caches.keys()) {
    if(!name.startsWith(PREFIX+'shell-')||name===SHELL)continue;
    const response=await (await caches.open(name)).match(MANIFEST_URL);if(!response)continue;
    const old=await response.json(),urls=new Set();
    for(const key of [name,PREFIX+'data-'+old.version])for(const r of await (await caches.open(key)).keys())urls.add(r.url);
    if(old.files.every(f=>urls.has(new URL(f.url,BASE).href)))return true;
  }
  return false;
}
async function storeFile(file,signal) {
  const cache=await cacheFor(file),url=absolute(file);
  if(await cache.match(url))return;
  const reusable=await (reusePromise||=previousFiles());
  for(const name of reusable.get(file.url+'|'+file.integrity)||[]) {
    const old=await (await caches.open(name)).match(url);
    if(old){await cache.put(url,old);return;}
  }
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
  try {
    if(signal?.aborted)throw new DOMException('Paused','AbortError');
    // Integrity prevents a truncated download or a newly deployed file entering
    // the old version's cache. Only public static files are in this allowlist.
    const response=await fetch(url,{cache:'reload',integrity:file.integrity,signal:controller.signal});
    if(!response.ok||response.type==='opaque')throw new Error('无法下载 '+file.url);
    await cache.put(url,response);
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
async function inventory() {
  const urls=new Set();
  for(const name of [SHELL,DATA])for(const r of await (await caches.open(name)).keys())urls.add(r.url);
  return urls;
}
async function status() {
  const urls=await inventory(),present=PACKAGE.files.filter(f=>urls.has(absolute(f)));
  const core=PACKAGE.files.filter(f=>f.group==='core');
  const papers=PACKAGE.papers.filter(p=>p.files.every(url=>urls.has(new URL(url,BASE).href))).map(p=>p.id);
  return {version:PACKAGE.version,complete:present.length===PACKAGE.files.length,shellReady:core.every(f=>urls.has(absolute(f))),
    count:present.length,total:PACKAGE.files.length,bytes:present.reduce((n,f)=>n+f.bytes,0),totalBytes:PACKAGE.files.reduce((n,f)=>n+f.bytes,0),
    papers,paperCount:PACKAGE.papers.length,questions:PACKAGE.questions,running:!!job,error:jobError,target:job?.target||''};
}
async function broadcast() {
  const value=await status();
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))client.postMessage({type:'OFFLINE_STATUS',value});
}
async function download(target) {
  const urls=await inventory(),paper=PACKAGE.papers.find(p=>p.id===target);
  if(target!=='all'&&!paper)throw new Error('试卷不存在');
  const needed=PACKAGE.files.filter(f=>!urls.has(absolute(f))&&(target==='all'||f.group==='core'||paper.files.includes(f.url)));
  let index=0,last=0;
  const thisJob=job;
  await Promise.all(Array.from({length:4},async()=>{
    while(index<needed.length&&!thisJob.controller.signal.aborted) {
      const file=needed[index++];
      try {await storeFile(file,thisJob.controller.signal);}
      catch(error) {
        if(thisJob.controller.signal.aborted)return;
        jobError=error.name==='QuotaExceededError'?'手机空间不足，请释放空间后继续下载':'下载中断，已下载的内容保留，请恢复网络后继续';
        thisJob.controller.abort();return;
      }
      if(Date.now()-last>500){last=Date.now();await broadcast();}
    }
  }));
  if(job===thisJob)job=null;
  await broadcast();
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  for(const file of PACKAGE.files.filter(f=>f.group==='core'))await storeFile(file);
  const full=await previousComplete(),reusable=await (reusePromise||=previousFiles());
  // Browsers can activate a waiting worker after all old windows close. Before
  // it becomes installable, preserve the old package's completeness (atomic
  // update) and reuse every unchanged file of a partial package as well.
  for(const file of PACKAGE.files.filter(f=>f.group==='data')) {
    if(full||reusable.has(file.url+'|'+file.integrity))await storeFile(file);
  }
  await (await caches.open(SHELL)).put(MANIFEST_URL,new Response(JSON.stringify(PACKAGE),{headers:{'Content-Type':'application/json'}}));
  // A new worker waits. Existing exercises and the old full offline package
  // remain available until the user chooses to apply the update.
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  await self.clients.claim();
  const names=await caches.keys();
  const previous=names.filter(n=>n.startsWith(PREFIX+'shell-')&&n!==SHELL).slice(-1)[0];
  // Keep the current and previous app versions; remove older static downloads.
  for(const name of names)if(name.startsWith(PREFIX)&&name!==SHELL&&name!==DATA&&name!==previous&&name!==previous?.replace('shell-','data-'))await caches.delete(name);
})()));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==BASE.origin||!url.pathname.startsWith(BASE.pathname))return;
  const navigation=event.request.mode==='navigate'&&(url.pathname===BASE.pathname||url.pathname===BASE.pathname+'index.html');
  const file=FILES.get(navigation?new URL('index.html',BASE).href:url.href);
  if(!file)return; // Never intercept accounts, cloud records or other sites.
  event.respondWith((async()=>{
    const cache=await cacheFor(file),key=absolute(file),cached=await cache.match(key);
    if(cached)return cached;
    try {await storeFile(file);return await cache.match(key);}
    catch {return new Response('此内容尚未下载。联网后打开「手机离线」继续下载。',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});}
  })());
});
self.addEventListener('message',event=>{
  const {type,target}=event.data||{},port=event.ports[0];
  const reply=value=>port?.postMessage({value});
  event.waitUntil((async()=>{
    try {
      if(type==='STATUS'){reply(await status());return;}
      if(type==='DOWNLOAD') {
        if(target&&target!=='all'&&!PACKAGE.papers.some(p=>p.id===target))throw new Error('试卷不存在');
        if(!job){jobError='';job={target:target||'all',controller:new AbortController()};const task=download(job.target);reply({started:true});await task;}
        else reply({started:false});return;
      }
      if(type==='PAUSE'){job?.controller.abort();reply({paused:true});return;}
      if(type==='CLEAR') {
        if(job)throw new Error('先暂停下载，再清除离线题库');
        for(const name of await caches.keys())if(name.startsWith(PREFIX+'data-'))await caches.delete(name);
        jobError='';reply(await status());await broadcast();return;
      }
      if(type==='ACTIVATE') {
        if(job)throw new Error('请等待下载完成');
        await self.skipWaiting();reply({activated:true});return;
      }
    } catch(error){port?.postMessage({error:error.message});}
  })());
});
