(function(){
  'use strict';
  const supported=location.protocol!=='file:'&&window.isSecureContext&&'serviceWorker' in navigator&&'caches' in window;
  const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const mb=n=>(n/1048576).toFixed(1)+' MB';
  let registration,current,next,installPrompt,problem='',selected='all',busy=false,storage;
  const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  function call(worker,type,extra={}) {
    return new Promise((resolve,reject)=>{
      if(!worker){reject(new Error('离线功能正在准备，请稍后再试'));return;}
      const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(new Error('暂时没有响应，请重新打开离线面板'));},15000);
      channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();e.data.error?reject(new Error(e.data.error)):resolve(e.data.value);};
      worker.postMessage({type,...extra},[channel.port2]);
    });
  }
  async function refresh() {
    if(registration?.active)current=await call(registration.active,'STATUS');
    next=registration?.waiting?await call(registration.waiting,'STATUS'):null;
    storage=await navigator.storage?.estimate?.().catch(()=>null);
    paint();
  }
  function statusHtml() {
    if(!supported)return '';
    const label=next?'更新网站':current?.complete?(navigator.onLine?'已可离线':'离线可用'):'手机离线';
    return `<button class="btn btn-sm offline-entry ${next?'btn-primary':''}" data-offline-action="${next?'apply':'open'}">${label}</button>`;
  }
  function paint() {
    document.querySelectorAll('.offline-entry').forEach(el=>{el.textContent=next?'更新网站':current?.complete?(navigator.onLine?'已可离线':'离线可用'):'手机离线';el.dataset.offlineAction=next?'apply':'open';el.classList.toggle('btn-primary',!!next);});
    const host=document.querySelector('#offline-panel .modal-body');if(!host)return;
    const state=next||current,full=current?.complete;
    const title=state?.running?'正在下载到手机':next?'有新版本可下载':full?'断网也能接着练':'把题库带到手机里';
    const ratio=state?Math.round(state.bytes/state.totalBytes*100):0;
    const catalog=window.QB_CATALOG?.papers||[];
    const cached=new Set(current?.papers||[]);
    const progressTitle=state?.complete?'完整题库已就绪':state?`${ratio}%`:'准备中';
    const detail=`${current?`已可离线做 ${current.papers.length} / ${current.paperCount} 套试卷`:'首次准备需要联网'}${state?.running?' · 下载时请保持此页面打开':''}`;
    const paintKey=JSON.stringify([state?.version,!!state?.running,!!state?.complete,!!next,!!full,busy,problem,state?.error,navigator.onLine,!!installPrompt,standalone()]);
    // Progress ticks update text only. Replacing controls on every tick makes
    // taps unreliable and loses keyboard focus in mobile browsers.
    if(host.dataset.paintKey===paintKey) {
      host.querySelector('.offline-progress-label strong').textContent=progressTitle;
      host.querySelector('.offline-progress-label span').textContent=state?`${mb(state.bytes)} / ${mb(state.totalBytes)}`:'';
      host.querySelector('progress').value=ratio;host.querySelector('.offline-detail').textContent=detail;return;
    }
    host.dataset.paintKey=paintKey;
    const hint=standalone()?'已经从主屏幕打开。请在这里下载题库。':/iPad|iPhone|iPod/.test(navigator.userAgent)?
      '先在 Safari 的分享菜单选择「添加到主屏幕」，再从桌面图标进入并下载。':
      '先在浏览器菜单选择「安装应用」或「添加到主屏幕」，再从桌面图标进入并下载。';
    host.innerHTML=`<div class="offline-summary"><p class="offline-eyebrow">${next?'更新准备':navigator.onLine?'手机离线':'当前已断网'}</p><h2>${title}</h2>
      <p>${full?'整套真题、专项、题目图片和解析已保存。':state?`下载后，真题、专项、图片、解析和导出都能离线使用。共 ${state.paperCount} 套试卷，${mb(state.totalBytes)}。`:'正在准备离线功能…'}</p></div>
      <section class="offline-download"><div class="offline-progress-label"><strong>${progressTitle}</strong><span>${state?`${mb(state.bytes)} / ${mb(state.totalBytes)}`:''}</span></div>
      <progress max="100" value="${ratio}" aria-label="题库下载进度"></progress>
      <p class="offline-detail">${detail}</p>
      ${problem||state?.error?`<p class="offline-error" role="alert">${safe(problem||state.error)}</p>`:''}
      <div class="offline-actions">${state?.running?'<button class="btn" data-offline-action="pause">暂停下载</button>':
        `<button class="btn btn-primary" data-offline-action="download" ${busy||!state||!navigator.onLine||state.complete?'disabled':''}>${next?'下载更新':state?.count>40?'继续下载完整题库':'下载完整题库'}</button>`}
      ${next?`<button class="btn" data-offline-action="apply" ${busy||state?.running||!navigator.onLine&&!next.complete?'disabled':''}>更新网站</button>`:''}
      <button class="btn" data-offline-action="verify" ${busy?'disabled':''}>检查下载</button></div></section>
      ${!next&&!state?.running&&!full?`<details class="offline-partial"><summary>只下载一套试卷</summary><label for="offline-paper">选择试卷（包含题图和解析）</label><select id="offline-paper">${catalog.map(p=>`<option value="${safe(p.id)}" ${selected===p.id?'selected':''}>${cached.has(p.id)?'已下载 · ':''}${safe(p.name)}</option>`).join('')}</select><button class="btn" data-offline-action="paper" ${busy||!navigator.onLine?'disabled':''}>下载所选试卷</button></details>`:''}
      <section class="offline-install"><h3>${standalone()?'主屏幕应用':'添加到手机主屏幕'}</h3><p>${hint}</p>
      ${installPrompt&&!standalone()?'<button class="btn" data-offline-action="install">安装到主屏幕</button>':''}
      <p>微信、QQ 等内置浏览器请改用系统浏览器打开。</p></section>
      <section class="offline-records"><h3>练习记录一直保存在本机</h3><p>断网时作答、笔迹、收藏和复盘照常保存；登录账号的记录联网后补传。安装后如果记录没有出现，先登录同一账号，或在「记录」导入完整备份。</p>
      <p>首次下载请使用 Wi-Fi。手机可能清理网站存储，重要记录请在「记录」导出完整备份。${storage?.quota?`可用存储约 ${mb(Math.max(0,storage.quota-storage.usage))}。`:''}</p>
      <div class="offline-actions"><button class="btn btn-ghost" data-offline-action="check-update" ${busy||!navigator.onLine?'disabled':''}>检查更新</button><button class="btn btn-ghost" data-offline-action="clear" ${busy||state?.running?'disabled':''}>移除离线题库</button></div></section>`;
  }
  function open() {
    document.getElementById('offline-panel')?.remove();
    const overlay=document.createElement('div');overlay.id='offline-panel';overlay.className='modal-bg';
    overlay.innerHTML='<section class="modal offline-modal" role="dialog" aria-modal="true" aria-label="手机离线"><div class="modal-head"><h3>手机离线</h3><button class="btn" data-offline-action="close">关闭</button></div><div class="modal-body"></div></section>';
    overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
    document.body.appendChild(overlay);paint();refresh().catch(e=>{problem=e.message;paint();});overlay.querySelector('[data-offline-action="close"]').focus();
  }
  document.addEventListener('change',e=>{if(e.target.id==='offline-paper')selected=e.target.value;});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')document.getElementById('offline-panel')?.remove();});
  document.addEventListener('click',async e=>{
    const action=e.target.closest('[data-offline-action]')?.dataset.offlineAction;if(!action)return;
    if(action==='open'){open();return;}
    if(action==='close'){document.getElementById('offline-panel')?.remove();return;}
    if(busy)return;
    busy=true;problem='';
    try {
      const worker=registration?.waiting||registration?.active;
      if(action==='install'){await installPrompt?.prompt();await installPrompt?.userChoice;installPrompt=null;}
      if(action==='download'||action==='paper') {
        await navigator.storage?.persist?.().catch(()=>false);
        const target=action==='paper'?(document.getElementById('offline-paper')?.value||selected):'all';
        await call(worker,'DOWNLOAD',{target});
      }
      if(action==='pause')await call(worker,'PAUSE');
      if(action==='verify'){await refresh();problem=current?.complete?'检查通过，完整题库和图片已在本机。':'检查完成，可以继续下载缺少的内容。';}
      if(action==='clear') {
        if(!confirm('移除下载的题库和图片？你的作答、笔迹、收藏和练习记录会保留。'))return;
        await call(registration.active,'CLEAR');
      }
      if(action==='apply') {
        await refresh();
        if(!next?.shellReady||!registration.waiting)throw new Error('新版网站尚未准备好，请稍后重试');
        if(!navigator.onLine&&!next.complete)throw new Error('请联网更新网站，新题目和图片将按需加载');
        if(!confirm('现在更新应用？当前作答已在本机保存，更新后可继续练习。'))return;
        const waiting=registration.waiting;
        navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});
        await call(waiting,'ACTIVATE');
      }
      if(action==='check-update'){await registration?.update();problem=registration?.installing?'正在检查新版本，请稍候。':registration?.waiting?'发现新版本。':'当前已是最新版本。';}
      await refresh();
    } catch(error){problem=error.message;}
    finally {busy=false;paint();}
  });
  window.OfflineStudy={statusHtml,open,refresh};
  if(!supported)return;
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;paint();});
  window.addEventListener('appinstalled',()=>{installPrompt=null;paint();});
  window.addEventListener('online',()=>{paint();refresh().catch(()=>{});});
  window.addEventListener('offline',()=>paint());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh().catch(()=>{});});
  navigator.serviceWorker.addEventListener('message',event=>{
    if(event.data?.type!=='OFFLINE_STATUS')return;
    if(event.data.value.version===current?.version)current=event.data.value;else next=event.data.value;
    paint();
  });
  navigator.serviceWorker.register('sw.js',{scope:'./',updateViaCache:'none'}).then(async reg=>{
    registration=reg;
    const watch=worker=>worker?.addEventListener('statechange',()=>refresh().catch(()=>{}));
    watch(reg.installing);reg.addEventListener('updatefound',()=>watch(reg.installing));
    await navigator.serviceWorker.ready;await refresh();
    await reg.update();
  }).catch(error=>{problem='当前浏览器未能保存离线应用，请联网刷新或换用系统浏览器。';console.warn('Offline registration:',error.message);paint();});
})();
