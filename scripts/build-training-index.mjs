import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {VERSION,SUBTYPES,LEGACY_LEAVES,classify} from './training-taxonomy.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function buildTrainingIndex(client=path.join(root,'client')) {
  const read=(rel,name,key)=>{const c={window:{}};vm.runInNewContext(fs.readFileSync(path.join(client,rel),'utf8'),c);return key?c.window[name][key]:c.window[name];};
  const cat=read('data/catalog.js','QB_CATALOG'),pools=read('data/pools/index.js','QB_POOL_INDEX');
  const format={};vm.runInNewContext(fs.readFileSync(path.join(client,'assets/exam-format.js'),'utf8'),format);
  const signature=q=>crypto.createHash('sha1').update(JSON.stringify([q.type,format.ExamFormat.stem(q.stem,q.type),q.material||'',q.options])).digest('hex');
  const sources=new Map();
  const qualifiers=new Map();
  for(const p of cat.papers)for(const q of read(`data/papers/${p.id}.js`,'QB_PAPERS',p.id).questions) {
    const sig=signature(q);if(!sources.has(sig))sources.set(sig,[]);
    if(q.classification?.version!==VERSION)throw new Error('Sync Obsidian before building website: '+q.qid);
    const c=classify(q),{group,tag}=c,filters=[];
    for(const [kind,labels] of [['辅助考点',c.auxiliary],['解题方法',c.methods],['题面形式',c.forms]])for(const label of labels){
      const id=kind+'::'+(kind==='解题方法'?q.module:group)+'::'+label;
      filters.push(id);qualifiers.set(id,{id,label,group,kind,module:q.module});
    }
    sources.get(sig).push({src:[p.id,q.no,q.materialNo||0,q.qid],leaf:group+'::'+tag,filters,c});
  }
  const records=[],groups=cat.typeOrder.map(t=>({id:t,label:t,module:cat.typeModule[t],leaves:(SUBTYPES[t]||[t]).map(label=>({id:t+'::'+label,label}))}));
  for(const [type,pool] of Object.entries(pools)) {
    const questions=read(`data/pools/${pool.key}.js`,'QB_POOLS',pool.key).questions;
    questions.forEach((q,i)=>{
      const source=sources.get(signature(q));if(!source?.length)throw new Error('Training source missing: '+q.qid);
      const variants=new Map();
      for(const item of source){const key=JSON.stringify([item.leaf,item.filters]);if(!variants.has(key))variants.set(key,{...item,src:[]});variants.get(key).src.push(item.src);}
      for(const {leaf,src,filters,c} of variants.values()){
        if(!groups.some(g=>g.leaves.some(t=>t.id===leaf)))throw new Error('Invalid training tag '+leaf);
        records.push({qid:q.qid,k:pool.key,i,t:type,leaf,src,filters,classification:{version:c.version,group:c.group,tag:c.tag,auxiliary:c.auxiliary,methods:c.methods,forms:c.forms,confidence:c.confidence,basis:c.basis}});
      }
    });
  }
  const data={version:2,taxonomyVersion:VERSION,basis:'粉笔讲义体系；先同步 Obsidian，网页读取同一逐题标注；未细分留待复核',groups,qualifiers:[...qualifiers.values()],legacyLeaves:LEGACY_LEAVES,records};
  fs.writeFileSync(path.join(client,'data/training-index.js'),'window.QB_TRAINING_INDEX='+JSON.stringify(data)+';\n');
  const classified=records.filter(r=>!r.leaf.endsWith('::未细分')).length;
  console.log(`Training index: ${records.length} unique entries, ${classified} classified, ${groups.reduce((n,g)=>n+g.leaves.length,0)} selectable tags; exact year/region source pairs`);
  return data;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))buildTrainingIndex();
