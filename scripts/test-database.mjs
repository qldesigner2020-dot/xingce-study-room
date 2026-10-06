import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pathToFileURL} from 'node:url';
export const owner={id:'11111111-1111-4111-8111-111111111111',email:'owner@example.test'};
export const other={id:'22222222-2222-4222-8222-222222222222',email:'other@example.test'};
export async function fixtureDatabase() {
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid(),auth.jwt() to anon,authenticated;
    insert into auth.users values ('${owner.id}'),('${other.id}');`);
  await db.exec(fs.readFileSync('supabase/schema.sql','utf8'));
  await db.query('insert into public.study_accounts(email) values ($1)',[owner.email]);
  return db;
}
export async function asAccount(db,account,changes=[],role=account?'authenticated':'anon') {
  await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)`,
    [account?.id||'',JSON.stringify(account?{sub:account.id,email:account.email}:{})]);
  await db.exec('set role '+role);
  try {return (await db.query('select public.study_sync($1::jsonb) as data',[JSON.stringify(changes)])).rows[0].data;}
  finally {await db.exec('reset role');}
}
export async function runTests() {
  const db=await fixtureDatabase();let count=0;
  await assert.rejects(()=>asAccount(db,null));count++;
  await assert.rejects(()=>asAccount(db,other),/此账号未启用同步/);count++;
  assert.equal((await asAccount(db,owner)).records.length,0);count++;
  let data=await asAccount(db,owner,[{key:'session:a',version:0,value:{id:'a',reflection:'完整自述'}}]);
  assert.equal(data.records[0].version,1);assert.equal(data.userId,owner.id);count++;
  data=await asAccount(db,owner,[{key:'session:a',version:0,value:{id:'a',reflection:'旧电脑覆盖'}},{key:'favorite:new',version:0,value:{test:true}}]);
  assert.equal(data.conflict,true);assert.equal(data.records.length,1);assert.equal(data.records[0].value.reflection,'完整自述');count++;
  data=await asAccount(db,owner,[{key:'session:a',version:1,value:null}]);assert.equal(data.records[0].version,2);assert.equal(data.records[0].value,null);count++;
  assert.equal((await asAccount(db,owner,[{key:'session:a',version:1,value:{id:'resurrect'}}])).conflict,true);count++;
  await assert.rejects(()=>asAccount(db,owner,[{key:'wrong:x',version:0,value:{}},{key:'wrong:x',version:0,value:{}}]));count++;
  await assert.rejects(()=>asAccount(db,owner,[{key:'unsafe',version:0,value:{}}]));count++;
  await assert.rejects(()=>asAccount(db,owner,[{key:'active',version:0.5,value:{}}]));count++;
  await assert.rejects(()=>asAccount(db,owner,[{key:'active',version:0}]));count++;
  await assert.rejects(()=>asAccount(db,owner,[{key:'active',version:0,value:'x'.repeat(1700001)}]));count++;
  await db.query('insert into public.study_accounts(email) values ($1)',[other.email]);
  assert.equal((await asAccount(db,other)).records.length,0);count++;
  await asAccount(db,other,[{key:'session:a',version:0,value:{id:'a',reflection:'另一个账号'}}]);
  assert.equal((await asAccount(db,owner)).records[0].value,null);count++;
  await db.exec('set role authenticated');
  await assert.rejects(()=>db.query('select * from public.study_records'));await assert.rejects(()=>db.query('select * from public.study_accounts'));count++;
  await db.exec('reset role');
  await assert.rejects(()=>asAccount(db,owner,new Array(26).fill({key:'settings',version:0,value:{}})));count++;
  await db.close();console.log(`PASS ${count} PostgreSQL checks: access, isolation, atomic conflicts, tombstones and validation`);
}
if(import.meta.url===pathToFileURL(process.argv[1]).href)await runTests();
