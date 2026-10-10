import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {SUBTYPES,classify} from './training-taxonomy.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function buildTrainingIndex(client=path.join(root,'client')) {
  const read=(rel,name,key)=>{const c={window:{}};vm.runInNewContext(fs.readFileSync(path.join(client,rel),'utf8'),c);return key?c.window[name][key]:c.window[name];};
  const cat=read('data/catalog.js','QB_CATALOG'),pools=read('data/pools/index.js','QB_POOL_INDEX');
  const format={};vm.runInNewContext(fs.readFileSync(path.join(client,'assets/exam-format.js'),'utf8'),format);
  const signature=q=>crypto.createHash('sha1').update(JSON.stringify([q.type,format.ExamFormat.stem(q.stem,q.type),q.material||'',q.options])).digest('hex');
  const sources=new Map();
  for(const p of cat.papers)for(const q of read(`data/papers/${p.id}.js`,'QB_PAPERS',p.id).questions) {
    const sig=signature(q);if(!sources.has(sig))sources.set(sig,[]);
    const {group,tag}=classify(q);
    sources.get(sig).push({src:[p.id,q.no,q.materialNo||0,q.qid],leaf:group+'::'+tag});
  }
  const records=[],groups=cat.typeOrder.map(t=>({id:t,label:t,module:cat.typeModule[t],leaves:(SUBTYPES[t]||[t]).map(label=>({id:t+'::'+label,label}))}));
  for(const [type,pool] of Object.entries(pools)) {
    const questions=read(`data/pools/${pool.key}.js`,'QB_POOLS',pool.key).questions;
    questions.forEach((q,i)=>{
      const source=sources.get(signature(q));if(!source?.length)throw new Error('Training source missing: '+q.qid);
      const variants=new Map();
      for(const item of source){if(!variants.has(item.leaf))variants.set(item.leaf,[]);variants.get(item.leaf).push(item.src);}
      for(const [leaf,src] of variants){
        if(!groups.some(g=>g.leaves.some(t=>t.id===leaf)))throw new Error('Invalid training tag '+leaf);
        records.push({qid:q.qid,k:pool.key,i,t:type,leaf,src});
      }
    });
  }
  const data={version:1,basis:'题库解析与题面规则识别；保留原题型，无法可靠识别的标为未细分',groups,records};
  fs.writeFileSync(path.join(client,'data/training-index.js'),'window.QB_TRAINING_INDEX='+JSON.stringify(data)+';\n');
  const classified=records.filter(r=>!r.leaf.endsWith('::未细分')).length;
  console.log(`Training index: ${records.length} unique entries, ${classified} classified, ${groups.reduce((n,g)=>n+g.leaves.length,0)} selectable tags; exact year/region source pairs`);
  return data;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))buildTrainingIndex();
