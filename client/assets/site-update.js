// Inlined into the published recovery page so an old worker cannot serve old updater code.
(function(){
  'use strict';
  const status=document.getElementById('update-status'),retry=document.getElementById('update-retry'),enter=document.getElementById('update-enter');
  const preview=!/^https?:$/.test(location.protocol)||location.origin==='null'||window.origin==='null';
  const base=new URL('./',preview?'https://baohuafen-trainer-d0dbbv55209602-1476347142.tcloudbaseapp.com/xingce-study-room/update.html':location.href),hash=location.hash.startsWith('#/')?location.hash:'#/';
  let running=false,opening=false,operation;
  enter.href=new URL('?website-online='+Date.now()+hash,base).href;
  if(preview){enter.textContent='打开正式网站';enter.target='_blank';enter.rel='noopener';}
  function bounded(task,ms,message,signal){
    return new Promise((resolve,reject)=>{
      let done=false;
      const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(value);};
      const cancel=()=>finish(signal.reason||new Error('更新已取消'));
      const timer=setTimeout(()=>finish(new Error(message)),ms);
      signal?.addEventListener('abort',cancel,{once:true});
      if(signal?.aborted){cancel();return;}
      Promise.resolve().then(task).then(value=>finish(null,value),finish);
    });
  }
  function call(worker,type,signal){
    return new Promise((resolve,reject)=>{
      if(!worker){reject(new Error('网站更新暂未就绪'));return;}
      const channel=new MessageChannel();let done=false;
      const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);channel.port1.close();error?reject(error):resolve(value);};
      const cancel=()=>finish(signal.reason||new Error('更新已取消'));
      const timer=setTimeout(()=>finish(new Error('更新没有响应，请重试或直接进入网站')),10000);
      signal?.addEventListener('abort',cancel,{once:true});
      if(signal?.aborted){cancel();return;}
      channel.port1.onmessage=e=>e.data?.error?finish(new Error(e.data.error)):finish(null,e.data?.value);
      try{worker.postMessage({type},[channel.port2]);}catch(error){finish(error);}
    });
  }
  function waitState(worker,states,ms,message,signal){
    return new Promise((resolve,reject)=>{
      let done=false;
      const finish=error=>{if(done)return;done=true;clearTimeout(timer);worker.removeEventListener('statechange',check);signal?.removeEventListener('abort',cancel);error?reject(error):resolve();};
      const cancel=()=>finish(signal.reason||new Error('更新已取消'));
      const check=()=>{if(states.includes(worker.state))finish();else if(worker.state==='redundant')finish(new Error('下载更新失败，可以直接进入网站'));};
      const timer=setTimeout(()=>finish(new Error(message)),ms);
      worker.addEventListener('statechange',check);signal?.addEventListener('abort',cancel,{once:true});
      if(signal?.aborted)cancel();else check();
    });
  }
  async function run(){
    if(running||opening)return;
    running=true;retry.hidden=true;status.textContent='正在检查最新版本…';
    const controller=operation=new AbortController(),signal=controller.signal;
    const total=setTimeout(()=>controller.abort(new Error('更新用时较长，可以重试或直接进入网站')),90000);
    try{
      if(preview){status.textContent='当前打开的是网页预览，请点击“打开正式网站”进入练习室';return;}
      if(navigator.onLine===false)throw new Error('请联网后更新；也可以返回已保存的练习室');
      if(!('serviceWorker' in navigator))throw new Error('当前浏览器不支持缓存更新，请直接进入网站');
      // Only a small version file is needed, not the multi-MB offline manifest.
      const info=await bounded(async()=>{
        const response=await fetch('site-version.json?website-update='+Date.now(),{cache:'no-store',signal});
        if(!response.ok)throw new Error('无法读取最新版本，请重试或直接进入网站');
        const value=await response.json();
        if(!/^[a-f0-9]{20}$/.test(value?.version||''))throw new Error('版本信息无效，请稍后重试');
        return value;
      },12000,'版本检查超时，可以重试或直接进入网站',signal);
      status.textContent='正在连接网站更新…';
      const reg=await bounded(()=>navigator.serviceWorker.register('sw.js',{scope:'./',updateViaCache:'none'}),20000,'连接更新超时，可以直接进入网站',signal);
      // On an existing registration, register may return before its background
      // update discovers the new worker. Await that check, except during a first
      // install or when the latest worker is already waiting to activate.
      if(!reg.installing&&!reg.waiting)await bounded(()=>reg.update(),20000,'检查网页更新超时，可以直接进入网站',signal);
      if(reg.installing){
        status.textContent='正在加载新版网页和题目目录…';
        await waitState(reg.installing,['installed','activating','activated'],60000,'新版网页加载超时，可以直接进入网站',signal);
      }
      let worker=reg.waiting||reg.active;
      if(worker?.state==='activating')await waitState(worker,['activated'],10000,'更新切换超时，请重试',signal);
      const value=await call(worker,'VERSION',signal);
      if(value?.version!==info.version||!value.shellReady)throw new Error('新版网页尚未就绪，请重试或直接进入网站');
      if(reg.waiting){
        worker=reg.waiting;status.textContent='正在切换到新版网站…';
        await Promise.all([call(worker,'ACTIVATE',signal),waitState(worker,['activated'],10000,'更新切换超时，可以直接进入网站',signal)]);
      }
      if(signal.aborted||opening)return;
      status.textContent='更新完成，正在返回练习室…';
      location.replace('./'+hash);
    }catch(error){
      if(!opening){status.textContent=error.name==='SecurityError'?'当前浏览器不支持缓存更新，请直接进入网站':error.message||'更新未完成，请重试或直接进入网站';retry.hidden=false;}
    }finally{
      clearTimeout(total);controller.abort(new Error('本次更新已结束'));running=false;
    }
  }
  async function openOnline(event){
    if(preview)return; // A real user click opens the normal website outside its preview.
    event.preventDefault();if(opening)return;
    if(navigator.onLine===false){status.textContent='当前未联网，请使用下方“返回练习室”打开已保存的网页';return;}
    opening=true;operation?.abort(new Error('正在进入网站'));retry.hidden=true;
    status.textContent='正在直接进入网站…';
    try{
      // Release only this site's controller; keep all caches, accounts and study
      // storage. Other projects on this shared host are untouched.
      if('serviceWorker' in navigator){
        const reg=await bounded(()=>navigator.serviceWorker.getRegistration(base.href),8000,'连接网站超时，请重试');
        if(reg?.scope===base.href){
          const released=await bounded(()=>reg.unregister(),8000,'切换在线模式超时，请重试');
          if(!released)throw new Error('暂时无法切换在线模式，请重试');
        }
      }
      location.replace(enter.href);
    }catch(error){status.textContent=error.message;retry.hidden=false;opening=false;}
  }
  retry.addEventListener('click',run);enter.addEventListener('click',openOnline);run();
})();
