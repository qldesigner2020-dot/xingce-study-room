// Recovery entry is a separate URL: an older cached index cannot intercept it.
// No localStorage, IndexedDB, account, or practice-record mutation is involved.
(function(){
  const status=document.getElementById('update-status'),retry=document.getElementById('update-retry');
  const call=(worker,type)=>new Promise((resolve,reject)=>{
    if(!worker)return reject(new Error('网站更新暂未就绪'));
    const c=new MessageChannel(),timer=setTimeout(()=>{c.port1.close();reject(new Error('更新超时，请重试'));},15000);
    c.port1.onmessage=e=>{clearTimeout(timer);c.port1.close();e.data.error?reject(new Error(e.data.error)):resolve(e.data.value);};worker.postMessage({type},[c.port2]);
  });
  const installed=worker=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(new Error('网络较慢，请稍后重试')),120000);
    const check=()=>{if(worker.state==='installed'||worker.state==='activated')finish();else if(worker.state==='redundant')finish(new Error('下载更新失败，请重试'));};
    function finish(error){clearTimeout(timer);worker.removeEventListener('statechange',check);error?reject(error):resolve();}
    worker.addEventListener('statechange',check);check();
  });
  async function run(){
    retry.hidden=true;status.textContent='正在检查最新版本…';
    try {
      if(!navigator.onLine)throw new Error('请联网后更新网站');
      if(!('serviceWorker' in navigator))throw new Error('请用 Edge、Chrome 或 Safari 打开网站');
      const latest=await fetch('offline-manifest.json?website-update='+Date.now(),{cache:'no-store'});
      if(!latest.ok)throw new Error('无法读取最新网站版本');
      const version=(await latest.json()).version;
      const reg=await navigator.serviceWorker.register('sw.js',{scope:'./',updateViaCache:'none'});
      await reg.update();
      if(reg.installing){status.textContent='正在下载新版网页和题目目录…';await installed(reg.installing);}
      await navigator.serviceWorker.ready;
      const worker=reg.waiting||reg.active,value=await call(worker,'STATUS');
      if(value.version!==version||!value.shellReady)throw new Error('新版网页尚未就绪，请重试');
      if(reg.waiting){
        const worker=reg.waiting;
        await Promise.all([call(worker,'ACTIVATE'),installedActivation(worker)]);
      }
      status.textContent='更新完成，正在返回练习室…';
      location.replace('./'+(location.hash.startsWith('#/')?location.hash:'#/'));
    } catch(error){status.textContent=error.message;retry.hidden=false;}
  }
  function installedActivation(worker){return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(new Error('更新切换超时，请重试')),15000);
    const check=()=>{if(worker.state==='activated')finish();else if(worker.state==='redundant')finish(new Error('更新切换失败'));};
    function finish(error){clearTimeout(timer);worker.removeEventListener('statechange',check);error?reject(error):resolve();}
    worker.addEventListener('statechange',check);check();
  });}
  retry.addEventListener('click',run);run();
})();
