import {createClient} from '@supabase/supabase-js';
const config=window.STUDY_CLOUD_CONFIG||{};
const guestKey='qb.cloud.guest.v1';
const safe=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let client,guest=sessionStorage.getItem(guestKey)==='1',readyResolve,mode='login';
const ready=new Promise(resolve=>readyResolve=resolve);
const redirectTo=new URL('.',location.href).href;
function humanError(error) {
  const known={'Invalid login credentials':'邮箱或密码不正确','Email not confirmed':'请先打开邮箱中的确认邮件',
    'User already registered':'此邮箱已有账号，请直接登录','Signup is disabled':'账号注册已关闭，请使用已有练习账号'};
  return known[error?.message]||error?.message||'暂时无法连接，请稍后重试';
}
function renderForm(message='') {
  const configured=!!client,recovery=mode==='recovery';
  document.getElementById('app').innerHTML=`<main class="auth-page"><section class="auth-paper">
    <p class="auth-brand">行测练习室</p><h1>${recovery?'设置新密码':mode==='signup'?'创建练习账号':'继续你的练习'}</h1>
    <p class="auth-intro">${configured?'登录后，在家和公司接着刷。':'同步服务还在配置中，可以先在本机练习。'}</p>
    ${configured?`<form id="study-login" class="auth-form">
      ${recovery?'':'<label>邮箱<input name="email" type="email" autocomplete="email" required></label>'}
      <label>${recovery?'新密码':'密码'}<input name="password" type="password" autocomplete="${mode==='signup'||recovery?'new-password':'current-password'}" minlength="8" required></label>
      <p class="auth-message" role="status">${safe(message)}</p>
      <button class="btn btn-primary" type="submit">${recovery?'保存新密码':mode==='signup'?'创建账号':'登录并同步'}</button>
    </form><div class="auth-links">${recovery?'':`<button class="btn btn-ghost" data-auth-action="switch">${mode==='signup'?'已有账号，登录':'首次使用，创建练习账号'}</button><button class="btn btn-ghost" data-auth-action="reset">忘记密码</button>`}</div>`:`<p class="auth-message" role="status">${safe(message)}</p>`}
    <div class="auth-local"><button class="btn" data-auth-action="guest">先在本机练习</button><p>本机练习不会跨电脑同步。</p></div>
  </section></main>`;
  document.getElementById('study-login')?.addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),status=form.querySelector('[role="status"]');
    button.disabled=true;status.textContent='正在连接…';
    try {
      const data=new FormData(form),email=String(data.get('email')||'').trim(),password=String(data.get('password'));
      const result=mode==='recovery'?await client.auth.updateUser({password}):mode==='signup'?
        await client.auth.signUp({email,password,options:{emailRedirectTo:redirectTo}}):
        await client.auth.signInWithPassword({email,password});
      if(result.error)throw result.error;
      form.querySelector('[name="password"]').value='';
      if(mode==='signup'&&!result.data.session){status.textContent='确认邮件已发送，请打开邮件中的链接，再登录。';return;}
      guest=false;sessionStorage.removeItem(guestKey);readyResolve({guest:false});
      if(window.CloudSync)location.reload();
    }catch(error){status.textContent=humanError(error);}finally{button.disabled=false;}
  });
}
document.addEventListener('click',async event=>{
  const action=event.target.closest('[data-auth-action]')?.dataset.authAction;if(!action)return;
  if(action==='guest'){guest=true;sessionStorage.setItem(guestKey,'1');readyResolve({guest:true});return;}
  if(action==='switch'){mode=mode==='signup'?'login':'signup';renderForm();return;}
  if(action==='reset') {
    const form=document.getElementById('study-login'),email=form?.querySelector('[name="email"]')?.value.trim();
    const status=document.querySelector('.auth-message');
    if(!email){status.textContent='先填写邮箱，再点击忘记密码。';return;}
    const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo});
    status.textContent=error?humanError(error):'如果此邮箱已有账号，会收到重置密码邮件。';
  }
});
async function start() {
  if(config.url&&config.publishableKey?.startsWith('sb_publishable_')) {
    client=createClient(config.url,config.publishableKey,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    client.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY'){mode='recovery';renderForm();}});
    const {data,error}=await client.auth.getSession();
    if(!error&&data.session&&mode!=='recovery'&&!guest){readyResolve({guest:false});return;}
  }
  if(guest){readyResolve({guest:true});return;}
  renderForm();
}
window.CloudBackend={ready,isGuest:()=>guest,email:async()=>(await client?.auth.getSession())?.data.session?.user.email||'',
  signIn(){sessionStorage.removeItem(guestKey);location.reload();},
  async signOut(){const {error}=await client.auth.signOut();if(error)throw error;sessionStorage.removeItem(guestKey);},
  async request(method,changes) {
    if(guest||!client)throw new Error('登录后开启同步');
    const {data:session,error:authError}=await client.auth.getSession();
    if(authError||!session.session)throw new Error('请重新登录');
    const {data,error}=await client.rpc('study_sync',{p_changes:method==='POST'?changes:[]});
    if(error){if(error.code==='PGRST301')throw new Error('请重新登录');throw new Error(humanError(error));}
    if(!data||!Array.isArray(data.records)||data.userId!==session.session.user.id)throw new Error('同步返回异常，当前记录已保留');
    return data;
  }
};
start().catch(error=>renderForm(humanError(error)));
