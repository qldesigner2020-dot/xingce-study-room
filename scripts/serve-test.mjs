// Isolated fixture only. Not part of the published static website.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fixtureDatabase,asAccount,owner} from './test-database.mjs';
const db=await fixtureDatabase(),root=path.resolve('dist');
let queue=Promise.resolve();
const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
const token=Buffer.from(JSON.stringify({alg:'none'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:owner.id,email:owner.email,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture';
const user={...owner,aud:'authenticated',role:'authenticated',created_at:new Date().toISOString(),app_metadata:{provider:'email'},user_metadata:{},identities:[]};
const session={access_token:token,refresh_token:'fixture-refresh-only',token_type:'bearer',expires_in:3600,user};
http.createServer(async(req,res)=>{
  const origin=req.headers.origin;
  const cors={'content-type':'application/json','access-control-allow-origin':origin==='http://127.0.0.1:8942'?origin:'http://127.0.0.1:8941',
    'access-control-allow-headers':req.headers['access-control-request-headers']||'apikey,authorization,content-type,x-client-info,x-supabase-api-version','access-control-allow-methods':'GET,POST,OPTIONS'};
  if(req.method==='OPTIONS'){res.writeHead(204,cors).end();return;}
  const data=[];for await(const chunk of req)data.push(chunk);
  const body=data.length?JSON.parse(Buffer.concat(data)):{};
  const url=new URL(req.url,'http://127.0.0.1:8943');
  try {
    let result;
    if(url.pathname==='/auth/v1/token') {
      if(body.grant_type!=='refresh_token'&&url.searchParams.get('grant_type')!=='refresh_token'&&
        (body.email!==owner.email||body.password!=='fixture-password-123'))throw new Error('Invalid login credentials');
      result=session;
    } else if(url.pathname==='/auth/v1/user')result=user;
    else if(url.pathname==='/auth/v1/logout')result={};
    else if(url.pathname==='/rest/v1/rpc/study_sync') {
      const bearer=String(req.headers.authorization||'').replace(/^Bearer /,'');
      const claims=JSON.parse(Buffer.from(bearer.split('.')[1]||'','base64url'));
      if(!bearer.endsWith('.fixture')||claims.sub!==owner.id){res.writeHead(401,cors).end(JSON.stringify({message:'not signed in'}));return;}
      result=await serial(()=>asAccount(db,owner,body.p_changes));
    } else {res.writeHead(404,cors).end(JSON.stringify({message:'fixture route missing'}));return;}
    res.writeHead(200,cors).end(JSON.stringify(result));
  }catch(error){res.writeHead(400,cors).end(JSON.stringify({message:error.message,code:error.code}));}
}).listen(8943,'127.0.0.1');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif'};
for(const port of [8941,8942])http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:'+port),prefix='/xingce-study-room/';
  if(!url.pathname.startsWith(prefix)){res.writeHead(404).end();return;}
  const rel=decodeURIComponent(url.pathname.slice(prefix.length)||'index.html');
  if(rel==='assets/cloud-config.js'){res.writeHead(200,{'content-type':'text/javascript'}).end('window.STUDY_CLOUD_CONFIG='+JSON.stringify({url:'http://127.0.0.1:8943',publishableKey:'sb_publishable_fixture_only'})+';');return;}
  const file=path.resolve(root,rel);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
  res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});
  fs.createReadStream(file).pipe(res);
}).listen(port,'127.0.0.1',()=>console.log('Fixture browser http://127.0.0.1:'+port+'/xingce-study-room/'));
