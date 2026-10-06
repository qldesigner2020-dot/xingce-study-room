/* Loaded only by the hosted build. Local app keeps its original storage and startup. */
(function() {
  'use strict';
  const journalKey='qb.cloud.journal.v1';
  const keys={settings:'qb.settings.v1',active:'qb.active.v1',sessions:'qb.sessions.v1',wrong:'qb.wrong.v1',favorites:'qb.favorites.v1'};
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
  let state=read(journalKey,{userId:null,records:{},pending:{},conflicts:[]});
  let hooks={},timer,busy=false,offline=false,message='',sequence=0;
  state.records||={};state.pending||={};state.conflicts||=[];
  const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
  const persist=()=>{try{localStorage.setItem(journalKey,JSON.stringify(state));return true;}catch{message='同步缓存保存失败，请导出完整备份';return false;}};
  const effective=()=>({...Object.fromEntries(Object.entries(state.records).map(([k,r])=>[k,r.value])),
    ...Object.fromEntries(Object.entries(state.pending).map(([k,r])=>[k,r.value]))});
  function split(kind,value) {
    if(kind==='sessions')return Object.fromEntries((value||[]).map(s=>['session:'+s.id,s]));
    if(kind==='favorites')return Object.fromEntries(Object.entries(value||{}).map(([k,v])=>['favorite:'+k,v]));
    if(kind==='wrong')return Object.fromEntries(Object.entries(value||{}).map(([k,v])=>['wrong:'+k,v]));
    return {[kind]:value};
  }
  function changed(storageKey,value) {
    if(window.CloudBackend.isGuest())return;
    const kind=Object.keys(keys).find(k=>keys[k]===storageKey);if(!kind)return;
    const next=split(kind,value),old=effective();
    const owns=k=>kind==='sessions'?k.startsWith('session:'):kind==='favorites'?k.startsWith('favorite:'):kind==='wrong'?k.startsWith('wrong:'):k===kind;
    for(const key of new Set([...Object.keys(next),...Object.keys(old).filter(owns)])) {
      const v=next[key]??null;
      if(same(old[key],v))continue;
      state.pending[key]={value:v,version:state.pending[key]?.version??state.records[key]?.version??0,seq:++sequence};
    }
    message='';persist();update();clearTimeout(timer);timer=setTimeout(flush,1000);
  }
  function localValues(values) {
    const sessions=Object.entries(values).filter(([k,v])=>k.startsWith('session:')&&v).map(([,v])=>v)
      .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    const object=prefix=>Object.fromEntries(Object.entries(values).filter(([k,v])=>k.startsWith(prefix)&&v).map(([k,v])=>[k.slice(prefix.length),v]));
    let active=values.active||null;
    if(active&&sessions.some(s=>s.id===active.id&&s.submitted))active=null;
    return {sessions,settings:values.settings||{},active,favorites:object('favorite:'),wrong:object('wrong:')};
  }
  function materialize() {
    const values=localValues(effective());let changed=false;
    for(const [kind,key] of Object.entries(keys)) {
      const raw=JSON.stringify(values[kind]);
      if(localStorage.getItem(key)!==raw){localStorage.setItem(key,raw);changed=true;}
    }
    if(changed)hooks.onRemote?.();
  }
  function apply(data) {
    const remote=Object.fromEntries(data.records.map(r=>[r.key,r]));
    // Never let a different device silently replace a running exam.
    if(hooks.isBusy?.()&&remote.active&&state.records.active?.version!==remote.active.version&&!state.pending.active) {
      const local=read(keys.active,null);
      if(!same(local,remote.active.value))state.pending.active={value:local,version:state.records.active?.version||0,seq:++sequence};
    }
    for(const [key,p] of Object.entries(state.pending)) {
      if(same(p.value,remote[key]?.value)&&remote[key]?.version>=p.version)delete state.pending[key];
    }
    state.records=remote;state.userId=data.userId;
    state.conflicts=Object.entries(state.pending).filter(([k,p])=>(remote[k]?.version||0)!==p.version).map(([k])=>k);
    persist();materialize();update();
  }
  async function request(method='GET',changes) {
    return window.CloudBackend.request(method,changes);
  }
  function status() {
    if(window.CloudBackend.isGuest())return '本机练习';
    return message|| (state.conflicts.length?'同步有冲突':offline?'离线，已本地保存':busy?'正在同步…':
      Object.keys(state.pending).length?'待同步 '+Object.keys(state.pending).length+' 项':'云端已同步');
  }
  function update() {
    document.querySelectorAll('[data-cloud-status]').forEach(el=>el.textContent=status());
    document.querySelectorAll('[data-cloud-panel-status]').forEach(el=>el.textContent=status());
  }
  async function flush() {
    if(window.CloudBackend.isGuest()||busy||state.conflicts.length)return;
    busy=true;update();
    try {
      while(Object.keys(state.pending).length) {
        const batch=[];let size=0;
        for(const [key,p] of Object.entries(state.pending)) {
          const row={key,value:p.value,version:p.version};
          const bytes=new TextEncoder().encode(JSON.stringify(row)).length;
          if(batch.length&&(size+bytes>2300000||batch.length>=25))break;
          batch.push(row);size+=bytes;
        }
        const sent=Object.fromEntries(batch.map(r=>[r.key,{...state.pending[r.key]}]));
        const data=await request('POST',batch);
        // New keystrokes can arrive during the request. Retain them, but advance their base version.
        const versions=Object.fromEntries(data.records.map(r=>[r.key,r]));
        for(const [key,p] of Object.entries(sent)) {
          const remote=versions[key],local=state.pending[key];
          if(local&&same(remote?.value,p.value)&&remote.version>p.version) {
            if(same(local.value,p.value))delete state.pending[key];
            else local.version=remote.version;
          }
        }
        offline=false;message='';apply(data);
        if(state.conflicts.length)break;
      }
    } catch(error){offline=true;message=['TypeError','AbortError'].includes(error.name)?'':error.message;persist();}
    finally {busy=false;update();}
  }
  async function pull() {
    if(window.CloudBackend.isGuest()||busy||hooks.isBusy?.()||document.activeElement?.matches('input,textarea,select'))return;
    if(Object.keys(state.pending).length)return flush();
    busy=true;update();
    try {apply(await request());offline=false;message='';}
    catch(error){offline=true;if(error.message==='请重新登录')message=error.message;}
    finally {busy=false;update();}
  }
  function panel() {
    document.getElementById('cloud-panel')?.remove();
    const overlay=document.createElement('div');overlay.id='cloud-panel';overlay.className='modal-bg';
    overlay.innerHTML='<section class="modal" role="dialog" aria-modal="true" aria-label="云端同步"><div class="modal-head"><h3>云端同步</h3><button class="btn" data-cloud-action="close">关闭</button></div><div class="modal-body"><p data-cloud-panel-status></p><p>同一账号在不同电脑登录，自动同步练习、收藏、自评、复盘描述和笔迹。</p><p>迁移本地记录：先在本地版「练习记录」导出完整备份，再到在线版的同一页面导入。首次同步前请保留备份文件。</p>'+
      (state.conflicts.length?'<div class="card card-pad"><p>两台电脑修改了同一份记录。请先下载冲突明细，再选择采用哪一份；其他记录不受影响。</p><div class="row"><button class="btn" data-cloud-action="backup">下载冲突明细</button><button class="btn" data-cloud-action="cloud">采用云端版本</button><button class="btn" data-cloud-action="local">保留当前电脑版本</button></div></div>':'')+
      (localStorage.getItem('qb.cloud.migration-backup.v1')?'<p>登录前的本机记录已保留为备份，可以下载后在「练习记录」导入。</p><button class="btn" data-cloud-action="migration-backup">下载登录前的完整备份</button>':'')+
      (window.CloudBackend.isGuest()?'<p><button class="btn btn-primary" data-cloud-action="login">登录并同步</button></p>':
      '<p><button class="btn btn-primary" data-cloud-action="retry">立即同步</button><button class="btn btn-ghost" data-cloud-action="logout">退出登录</button></p>')+'</div></section>';
    document.body.appendChild(overlay);update();
  }
  document.addEventListener('click',async e=>{
    if(e.target.closest('[data-cloud-status]'))return panel();
    const action=e.target.closest('[data-cloud-action]')?.dataset.cloudAction;if(!action)return;
    if(action==='close')return document.getElementById('cloud-panel')?.remove();
    if(action==='login')return window.CloudBackend.signIn();
    if(action==='migration-backup') {
      const blob=new Blob([localStorage.getItem('qb.cloud.migration-backup.v1')],{type:'application/json'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='登录前的行测完整备份.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),4000);return;
    }
    if(action==='logout') {
      if(hooks.isBusy?.()){alert('请先退出当前练习，当前作答会保存在本机。');return;}
      if(Object.keys(state.pending).length){alert('还有未同步的记录，请先同步或导出完整备份，再退出登录。');return;}
      try {await window.CloudBackend.signOut();for(const key of Object.values(keys))localStorage.removeItem(key);localStorage.removeItem(journalKey);location.reload();}
      catch(error){alert(error.message||'退出失败，请重试');}return;
    }
    if(action==='backup') {
      const blob=new Blob([JSON.stringify({local:localValues(effective()),cloud:localValues(Object.fromEntries(Object.entries(state.records).map(([k,r])=>[k,r.value]))),conflicts:state.conflicts},null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='行测同步冲突明细.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),4000);return;
    }
    if(['cloud','local'].includes(action)) {
      if(hooks.isBusy?.()){alert('请先退出当前练习，再处理同步冲突。当前作答已在本地保存。');return;}
      for(const key of state.conflicts) {
        if(action==='cloud')delete state.pending[key];
        else state.pending[key].version=state.records[key]?.version||0;
      }
      state.conflicts=[];persist();materialize();panel();flush();return;
    }
    if(action==='retry') {
      if(message==='请重新登录')window.CloudBackend.signIn();
      else Object.keys(state.pending).length?flush():pull();
    }
  });
  async function init() {
    const auth=await window.CloudBackend.ready;
    if(auth.guest)return true;
    try {
      const data=await request();
      if(state.userId&&state.userId!==data.userId) {
        localStorage.setItem('qb.cloud.previous-account',JSON.stringify({state,cache:localValues(effective())}));
        state={userId:data.userId,records:{},pending:{},conflicts:[]};
      } else if(state.userId) {
        // Recover edits whose journal write was interrupted, using the durable local cache.
        for(const [kind,key] of Object.entries(keys))changed(key,read(key,kind==='sessions'?[]:kind==='active'?null:{}));
      } else {
        const cache={sessions:read(keys.sessions,[]),settings:read(keys.settings,{}),active:read(keys.active,null),wrong:read(keys.wrong,{}),favorites:read(keys.favorites,{})};
        if(cache.sessions.length||cache.active||Object.keys(cache.favorites).length||Object.keys(cache.wrong).length)
          localStorage.setItem('qb.cloud.migration-backup.v1',JSON.stringify({kind:'xingce-backup',version:1,exportedAt:Date.now(),...cache}));
      }
      apply(data);offline=false;flush();return true;
    } catch(error) {
      if(error.message==='请重新登录') {
        window.CloudBackend.signIn();
        return false;
      }
      offline=true;if(!['TypeError','AbortError'].includes(error.name))message=error.message;update();return true;
    }
  }
  const safe=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  window.CloudSync={changed,bind:h=>{hooks=h;update();},statusHtml:()=>'<button class="btn btn-sm" data-cloud-status>'+safe(status())+'</button>',ready:init(),flush};
  setInterval(pull,30000);
  window.addEventListener('online',()=>{offline=false;flush();pull();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)flush();else pull();});
  window.CloudSync.ready.then(ok=>{
    if(!ok)return;
    const script=document.createElement('script');script.src='assets/app.js';
    script.onload=()=>update();document.body.appendChild(script);
  });
})();
