/* Durable per-record storage. Legacy localStorage is kept until migration commits. */
(function(root){
  'use strict';
  const sessionKey='qb.sessions.v1',journalKey='qb.cloud.journal.v1',signalKey='qb.storage.revision.v2';
  const managed=k=>/^qb\./.test(k)&&!/^qb\.__|^qb\.storage/.test(k)&&!/^qb\.cloud\.guest/.test(k);
  const cache=new Map(),dirty=new Map();let db=null,queue=Promise.resolve(),failure=null,rev=0;
  const parse=(s,f)=>{try{return JSON.parse(s)??f;}catch{return f;}};
  const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  function parts(key,raw){
    if(raw==null)return [];
    const v=parse(raw,null);
    if(key===sessionKey)return (v||[]).map(s=>['session:'+s.id,s]);
    if(key===journalKey){const {records={},pending={},...meta}=v||{};return [['journal:meta',meta],...Object.entries(records).map(([k,r])=>['journal:record:'+k,r]),...Object.entries(pending).map(([k,r])=>['journal:pending:'+k,r])];}
    return [['kv:'+key,raw]];
  }
  function notifyError(error){failure=error;root.dispatchEvent(new CustomEvent('study-storage-error',{detail:'长期保存失败：'+error.message+'。请保持页面打开并导出完整备份，再重试保存。'}));}
  function enqueue(key,raw,previous){
    const before=new Map(parts(key,previous)),after=new Map(parts(key,raw)),ops=[];
    for(const [id,value] of after)if(JSON.stringify(value)!==JSON.stringify(before.get(id)))ops.push({id,key,value});
    for(const id of before.keys())if(!after.has(id))ops.push({id,key,remove:true});
    if(!ops.length)return;
    for(const op of ops)dirty.set(op.id,op);
    persistDirty();
  }
  function persistDirty(){
    queue=queue.catch(()=>{}).then(async()=>{
      const pending=[...dirty.values()];if(!db)throw new Error('浏览器未启用 IndexedDB');
      await new Promise((resolve,reject)=>{const tx=db.transaction('rows','readwrite'),st=tx.objectStore('rows');for(const op of pending)op.remove?st.delete(op.id):st.put(op);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('写入中断'));});
      for(const op of pending)if(dirty.get(op.id)===op)dirty.delete(op.id);
      failure=null;localStorage.setItem(signalKey,String(Date.now())+':'+(++rev));
    }).catch(error=>{notifyError(error);throw error;});
    // The pending data remains in memory; flush() exposes the failure to callers.
    queue.catch(()=>{});
  }
  async function refresh(){
    if(!db)return;
    const rows=await request(db.transaction('rows').objectStore('rows').getAll());
    const current=new Map(rows.map(r=>[r.id,r]));for(const [id,op] of dirty)op.remove?current.delete(id):current.set(id,op);
    cache.clear();const sessions=[],records={},pending={};let meta=null;
    for(const r of current.values()){
      if(r.id.startsWith('session:'))sessions.push(r.value);
      else if(r.id==='journal:meta')meta=r.value;
      else if(r.id.startsWith('journal:record:'))records[r.id.slice(15)]=r.value;
      else if(r.id.startsWith('journal:pending:'))pending[r.id.slice(16)]=r.value;
      else if(r.id.startsWith('kv:'))cache.set(r.key,r.value);
    }
    cache.set(sessionKey,JSON.stringify(sessions.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))));
    if(meta)cache.set(journalKey,JSON.stringify({...meta,records,pending}));else cache.delete(journalKey);
  }
  const api={
    getItem:k=>managed(k)?cache.get(k)??localStorage.getItem(k):localStorage.getItem(k),
    setItem(k,v){if(!managed(k)||!db){localStorage.setItem(k,v);return;}const prev=api.getItem(k);cache.set(k,String(v));enqueue(k,String(v),prev);if(k===journalKey){const uid=parse(v,{}).userId;localStorage.setItem('qb.cloud.identity.v2',JSON.stringify({userId:uid}));}},
    removeItem(k){if(!managed(k)||!db){cache.delete(k);localStorage.removeItem(k);return;}const prev=api.getItem(k);cache.delete(k);localStorage.removeItem(k);enqueue(k,null,prev);},
    async flush(){await queue;if(db&&failure)throw failure;},refresh,
    async retry(){if(!db)throw failure||new Error('浏览器未启用长期存储');persistDirty();await api.flush();},
    async migrationBackup(){if(!db)return null;const row=await request(db.transaction('rows').objectStore('rows').get('migration:local-v1'));if(!row)return null;const old=row.value.keys;return {kind:'xingce-backup',version:1,migratedAt:row.value.at,exportedAt:Date.now(),sessions:parse(old[sessionKey],[]),settings:parse(old['qb.settings.v1'],{}),active:parse(old['qb.active.v1'],null),favorites:parse(old['qb.favorites.v1'],{}),wrong:parse(old['qb.wrong.v1'],{})};},
    durable:()=>!!db, pending:()=>dirty.size,error:()=>db?failure:null
  };
  root.StudyStorage=api;
  api.ready=(async()=>{
    try{
      if(!root.indexedDB)throw new Error('浏览器不支持长期存储');
      const opening=indexedDB.open('xingce-study-records-v2',1);
      opening.onupgradeneeded=()=>opening.result.createObjectStore('rows',{keyPath:'id'}).createIndex('key','key');
      db=await request(opening);db.onversionchange=()=>db.close();
      const existing=await request(db.transaction('rows').objectStore('rows').getAll());
      if(!existing.length){
        const old={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(managed(k))old[k]=localStorage.getItem(k);}
        if(Object.keys(old).length){
          const tx=db.transaction('rows','readwrite'),st=tx.objectStore('rows');
          st.put({id:'migration:local-v1',key:'migration',value:{at:Date.now(),keys:old,sessionCount:parse(old[sessionKey],[]).length}});
          for(const [k,v] of Object.entries(old))for(const [id,value] of parts(k,v))st.put({id,key:k,value});
          await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
          const migrated=await request(db.transaction('rows').objectStore('rows').getAll());
          if(migrated.filter(r=>r.id.startsWith('session:')).length!==new Set(parse(old[sessionKey],[]).map(s=>s.id)).size)throw new Error('迁移数量核对未通过');
        }
      }
      await refresh();
      // Only bulky caches move out of localStorage; authentication still reads its small identity.
      for(const k of [sessionKey,journalKey])localStorage.removeItem(k);
      if(cache.has(journalKey))localStorage.setItem('qb.cloud.identity.v2',JSON.stringify({userId:parse(cache.get(journalKey),{}).userId}));
      return true;
    }catch(error){db=null;failure=error;return false;}
  })();
  root.addEventListener('storage',async e=>{if(e.key!==signalKey)return;await refresh();root.dispatchEvent(new CustomEvent('study-storage-remote'));});
})(window);
