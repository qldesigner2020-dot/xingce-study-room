import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {VERSION,SUBTYPES,classify} from './training-taxonomy.mjs';
const root=path.resolve(import.meta.dirname,'..');
const arg=n=>process.argv.find(v=>v.startsWith('--'+n+'='))?.slice(n.length+3);
const vault=path.resolve(arg('vault')||'D:/Obsidian/开源题库');
const stage=path.resolve(root,arg('stage')||'tmp/taxonomy-stage');
if(!stage.startsWith(root+path.sep)||stage===root)throw new Error('Stage must be inside project');
const apply=process.argv.includes('--apply');
const modules=['政治理论','常识判断','言语理解与表达','数量关系','判断推理','资料分析'];
const context={};vm.runInNewContext(fs.readFileSync(path.join(root,'client/assets/exam-format.js'),'utf8'),context);
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
const clean=raw=>raw.replace(/<!-- kaogong-tags:start -->\r?\n[\s\S]*?<!-- kaogong-tags:end -->\r?\n/g,'');
const re=/^(#{2,4})\s*第\s*(\d+)\s*题[^\r\n]*<sub>qid\s*(\d+)\s*·\s*([^<]+?)<\/sub>[^\r\n]*$/gm;
const tagText=s=>s.replace(/[\s#.,;:!?。；：？！【】（）()\[\]<>]/g,'_').replaceAll('·','/');
export function metadataFromBlock(block){const m=block.match(/<!-- kaogong-taxonomy: (.+) -->/);return m?JSON.parse(m[1]):null;}
function parse(raw,rel,module){
  const source=clean(raw),marks=[...source.matchAll(re)],meta={};
  for(const m of source.slice(0,source.indexOf('\n---',4)).matchAll(/^([^:\r\n]+):\s*"?(.*?)"?\s*$/gm))meta[m[1]]=m[2];
  let material='',materialNo=0,previousEnd=0;
  return marks.map((m,i)=>{
    const preceding=source.slice(previousEnd,m.index),mat=preceding.match(/## 材料\s*(\d+)\s*\r?\n([\s\S]*)/);
    if(mat){materialNo=+mat[1];material=mat[2].trim();}
    if(m[1].length===2){material='';materialNo=0;}
    const end=marks[i+1]?.index??source.length,body=source.slice(m.index+m[0].length,end),ex=body.split(/\*\*官方解析\*\*\s*\r?\n/),before=ex[0];
    const stem=before.split(/^-\s*\*\*[A-Z]\*\*\s*\.|^\*\*答案\*\*[：:]|^-\s*（选项）/m)[0].trim();
    const options=[...before.matchAll(/^-\s*\*\*([A-Z])\*\*\s*\.\s?(.+)$/gm)].map(x=>({k:x[1],t:x[2].replace(/[\s\u3000]*✅[\s\u3000]*$/,'').trim()}));
    const explanation=(ex[1]||'').replace(/\r?\n---\s*(?:\r?\n)?$/,'').trim();
    const answer=before.match(/^\*\*答案\*\*[：:]\s*(.+)$/m)?.[1].trim()||'';
    const q={qid:m[3],no:+m[2],type:m[4].trim(),module,stem:context.ExamFormat.stem(stem,m[4].trim()),options,answer,explanation,material,materialNo};
    previousEnd=end;
    // Material preceding subsequent question is inside previous body: find the
    // latest material boundary in everything before this heading, when nested.
    if(m[1].length>2){const all=source.slice(0,m.index);const last=[...all.matchAll(/^## 材料\s*(\d+)\s*\r?\n/gm)].at(-1);if(last){q.materialNo=+last[1];q.material=all.slice(last.index+last[0].length).split(/^#{2,4}\s*第\s*\d+\s*题/m)[0].trim();}}
    const key=digest(JSON.stringify([q.type,q.stem,q.material,options]));
    return {key,file:rel,qid:q.qid,no:q.no,module,type:q.type,year:Number(meta['年份']),region:meta['地区'],paper:meta['试卷']||path.basename(rel,'.md'),q};
  });
}
const files=[],records=[];
for(let i=0;i<modules.length;i++){
  const dir=String(i+1).padStart(2,'0')+'-'+modules[i];
  for(const name of fs.readdirSync(path.join(vault,dir)).filter(n=>n.endsWith('.md')&&n!=='README.md').sort()){
    const rel=dir+'/'+name,raw=fs.readFileSync(path.join(vault,rel),'utf8'),qs=parse(raw,rel,modules[i]);
    if(!qs.length)continue;
    const declared=raw.match(/^题数:\s*"?(\d+)/m)?.[1];
    if(qs.length!==Number(declared))throw new Error('Declared question count mismatch: '+rel);
    files.push({file:rel,hash:digest(raw),cleanHash:digest(clean(raw)),raw,questions:qs});records.push(...qs);
  }
}
const byKey=new Map();for(const r of records){r.classification=classify(r.q,{ignorePersisted:true});if(!byKey.has(r.key))byKey.set(r.key,[]);byKey.get(r.key).push(r);}
const overridesFile=path.join(vault,'99-题目分类/人工修正.json');
const overrides=fs.existsSync(overridesFile)?JSON.parse(fs.readFileSync(overridesFile,'utf8')):{};
let conflicts=0,manual=0;
for(const [key,rr] of byKey){
  const variants=new Set(rr.filter(r=>r.classification.tag!=='未细分').map(r=>r.classification.group+'::'+r.classification.tag));
  let chosen=[...rr].sort((a,b)=>({'高':3,'中':2,'原分类':1,'待复核':0}[b.classification.confidence]||0)-({'高':3,'中':2,'原分类':1,'待复核':0}[a.classification.confidence]||0))[0].classification;
  if(variants.size>1){chosen={...chosen,group:rr[0].type,tag:'未细分',confidence:'待复核',needsReview:true,auxiliary:[],methods:[],rule:'duplicate.conflict',evidence:'同题不同解析给出不同主考点：'+[...variants].join('；')};conflicts++;}
  if(overrides[key]){
    const v=overrides[key];if(!SUBTYPES[v.group]?.includes(v.tag)||!v.reason)throw new Error('Invalid manual override '+key);
    chosen={...chosen,...v,version:VERSION,confidence:'人工确认',needsReview:false,rule:'manual.override',evidence:v.reason};manual++;
  }
  // One result per exact content; every paper occurrence retains its own link.
  for(const r of rr)r.classification=chosen;
}
fs.mkdirSync(stage,{recursive:true});
const serial=records.map(({q,...r})=>r);
const counts={},uniqueCounts={},status={};
for(const r of serial){const leaf=r.classification.group+'::'+r.classification.tag;counts[leaf]=(counts[leaf]||0)+1;status[r.classification.confidence]=(status[r.classification.confidence]||0)+1;}
for(const rr of byKey.values()){const c=rr[0].classification,leaf=c.group+'::'+c.tag;uniqueCounts[leaf]=(uniqueCounts[leaf]||0)+1;}
const report={version:VERSION,vault,files:files.length,occurrences:records.length,uniqueContent:byKey.size,duplicateConflicts:conflicts,manualOverrides:manual,status,counts,uniqueCounts};
fs.writeFileSync(path.join(stage,'report.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(stage,'records.jsonl'),serial.map(r=>JSON.stringify(r)).join('\n')+'\n');
fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(files.map(({raw,questions,...f})=>f),null,2));
const sample=records.filter((r,i)=>i%211===0).map(r=>({file:r.file,no:r.no,qid:r.qid,stem:r.q.stem.slice(0,240),explanation:r.q.explanation.slice(0,360),classification:r.classification}));
fs.writeFileSync(path.join(stage,'sample.json'),JSON.stringify(sample,null,2));
const unresolved=['片段阅读','数学运算','综合','定义判断'].flatMap(t=>records.filter(r=>r.classification.group===t&&r.classification.tag==='未细分').slice(0,6).map(r=>({type:r.type,qid:r.qid,stem:r.q.stem,explanation:r.q.explanation.slice(0,650)})));
fs.writeFileSync(path.join(stage,'unresolved-sample.json'),JSON.stringify(unresolved,null,2));
if(apply){
  const backup=arg('backup');if(!backup||!fs.existsSync(backup))throw new Error('--apply requires an existing backup archive');
  for(const f of files){
    const abs=path.resolve(vault,f.file);if(!abs.startsWith(vault+path.sep)||digest(fs.readFileSync(abs,'utf8'))!==f.hash)throw new Error('Source changed during classification: '+f.file);
    const nl=f.raw.includes('\r\n')?'\r\n':'\n';let j=0;
    const updated=clean(f.raw).replace(re,(heading)=>{
      const r=f.questions[j++],c=r.classification;
      const meta={...c,key:r.key,sourceType:r.type};
      const main='#行测/'+tagText(r.module)+'/'+tagText(c.group)+'/'+tagText(c.tag);
      const aux=c.auxiliary.map(t=>'#辅助/'+tagText(c.group)+'/'+tagText(t));
      const met=c.methods.map(t=>'#方法/'+tagText(r.module)+'/'+tagText(t));
      const form=c.forms.map(t=>'#题面/'+tagText(t));
      const block=['<!-- kaogong-tags:start -->','<!-- kaogong-taxonomy: '+JSON.stringify(meta)+' -->','> **主考点**：'+main,'> '+[aux.length?'辅助：'+aux.join(' '):'',met.length?'方法：'+met.join(' '):'',form.length?'形式：'+form.join(' '):'','分类：'+c.confidence+(c.needsReview?' #分类状态/待复核':'')].filter(Boolean).join(' · '),'','^kg-q-'+r.qid,'','<!-- kaogong-tags:end -->'].join(nl);
      return heading+nl+block;
    });
    if(j!==f.questions.length||digest(clean(updated))!==f.cleanHash)throw new Error('Original content was changed '+f.file);
    fs.writeFileSync(abs,updated);
  }
  const output=path.join(vault,'99-题目分类');fs.mkdirSync(output,{recursive:true});
  fs.copyFileSync(path.join(stage,'records.jsonl'),path.join(output,'分类结果.jsonl'));
  fs.copyFileSync(path.join(stage,'report.json'),path.join(output,'分类统计.json'));
  if(!fs.existsSync(overridesFile))fs.writeFileSync(overridesFile,'{}\n');
  const buckets=new Map();
  for(const r of serial){
    const c=r.classification,entries=[['主考点',c.group+' / '+c.tag],...c.auxiliary.map(t=>['辅助考点',c.group+' / '+t]),...c.methods.map(t=>['解题方法',r.module+' / '+t]),...c.forms.map(t=>['题面形式',t])];
    for(const [kind,label] of entries){const id=kind+'/'+label;if(!buckets.has(id))buckets.set(id,[]);buckets.get(id).push(r);}
  }
  const index=['# 题目考点目录','',`分类版本：${VERSION}。覆盖 ${records.length.toLocaleString()} 次原卷收录、${byKey.size.toLocaleString()} 个去重内容。`,'','[[99-题目分类/分类方法与事业编迁移方案]] · [[99-题目分类/分类统计]]','','主考点用于互斥组卷；辅助考点、方法和题面形式可交叉检索。重复省份题保留各原卷位置，不重复估计独立题量。',''];
  const generated=[];
  for(const [kind] of [['主考点'],['辅助考点'],['解题方法'],['题面形式']]){
    index.push('## '+kind,'','| 标签 | 原卷出现次数 | 去重内容 | 入口 |','|---|---:|---:|---|');
    for(const [id,rr] of [...buckets].filter(([id])=>id.startsWith(kind+'/')).sort(([a],[b])=>a.localeCompare(b,'zh'))){
      const label=id.slice(kind.length+1),pages=[];
      for(let start=0;start<rr.length;start+=300){
        const name=kind+'/'+label.replaceAll(' / ','-')+(rr.length>300?'-'+(start/300+1):'')+'.md',abs=path.join(output,name);fs.mkdirSync(path.dirname(abs),{recursive:true});
        const content=['# '+label,'',`原卷出现 ${rr.length} 次；去重内容 ${new Set(rr.map(r=>r.key)).size} 个。`,'','[[99-题目分类/题目考点目录|返回分类目录]]','',...rr.slice(start,start+300).map(r=>`- [[${r.file.slice(0,-3)}#^kg-q-${r.qid}|${r.paper} · ${r.module}第 ${r.no} 题]] · ${r.classification.confidence}`),''].join('\n');
        fs.writeFileSync(abs,content);generated.push(name);pages.push(`[[99-题目分类/${name.slice(0,-3)}|${rr.length>300?'第 '+(start/300+1)+' 页':'查看题目'}]]`);
      }
      index.push(`| ${label} | ${rr.length} | ${new Set(rr.map(r=>r.key)).size} | ${pages.join(' · ')} |`);
    }
    index.push('');
  }
  fs.writeFileSync(path.join(output,'题目考点目录.md'),index.join('\n'));
  fs.writeFileSync(path.join(output,'生成文件清单.json'),JSON.stringify(generated,null,2));
  fs.writeFileSync(path.join(output,'分类统计.md'),['# 分类统计','',`原卷收录：${records.length}；去重内容：${byKey.size}；重复解析冲突：${conflicts}。`,'','| 状态 | 原卷收录次数 |','|---|---:|',...Object.entries(status).map(([k,v])=>`| ${k} | ${v} |`),'','分类置信度是规则证据等级，不是题目难度，也不表示已人工逐题复核。'].join('\n'));
  // Full source-content integrity verified after write, not just in memory.
  for(const f of files)if(digest(clean(fs.readFileSync(path.join(vault,f.file),'utf8')))!==f.cleanHash)throw new Error('Post-write integrity failed '+f.file);
  report.synced=true;report.backup=path.resolve(backup);fs.writeFileSync(path.join(stage,'report.json'),JSON.stringify(report,null,2));
  console.log('Obsidian synchronized; original stems/options/answers/explanations/images byte-preserved.');
}
console.log(JSON.stringify({...report,counts:undefined,uniqueCounts:undefined},null,2));
