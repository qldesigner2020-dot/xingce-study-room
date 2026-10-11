/** Targeted, audited repair of three imported notes, before website ingestion.
 * Original PDFs/answers/qids are not changed. Back up every note before writing. */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {classify,INSTITUTION_VERSION} from './training-taxonomy.mjs';
const root=path.resolve(process.argv[2]||'D:/Obsidian/开源题库'),base=path.join(root,'07-事业编职测');
const backup=path.resolve('tmp/institution-source-backup');
const plans=[
  {category:'B',date:'2024-11-02',quantity:'数量分析',pdf:'B-2024-11-02-paper-4812e290.pdf',materials:[[51,13,[115,106,470,525],'2022—2023年全国茶园面积及干毛茶产量'],[56,14,[117,245,475,729],'2023年H省与F省成品糖产量及同比增速']]},
  {category:'B',date:'2026-03-29',quantity:'数量关系',pdf:'B-2026-03-29-paper-9e80c2d2.pdf',materials:[[51,9,[50,459,542,676],'2021—2022年部分城市建筑业企业房屋累计竣工面积及价值'],[56,10,[48,343,546,625],'2024年电子信息制造业生产、效益与分地区数据']]},
  {category:'C',date:'2024-11-02',quantity:'数量分析',pdf:'C-2024-11-02-paper-ce75943a.pdf',materials:[[51,12,[115,106,470,525],'2022—2023年全国茶园面积及干毛茶产量'],[56,13,[116,234,476,670],'2023年Z省一般公共预算当期收入及累计支出']]},
  {category:'B',date:'2022-11-12',quantity:'数量分析',materials:[],existingMaterials:true},
  {category:'C',date:'2022-11-12',quantity:'数量分析',materials:[],existingMaterials:true},
  {category:'C',date:'2023-08-26',quantity:'数量分析',materials:[],existingMaterials:true},
];
const saved=new Set(),changes=[];
function write(file,text){if(!saved.has(file)){const dest=path.join(backup,path.relative(root,file));fs.mkdirSync(path.dirname(dest),{recursive:true});if(fs.existsSync(file)&&!fs.existsSync(dest))fs.copyFileSync(file,dest);saved.add(file);}fs.writeFileSync(file,text,'utf8');}
const jobs=[];
for(const plan of plans)for(const [no,page,rect] of plan.materials){
  const name=`${plan.category}-${plan.date}-m${no}-材料-核对补齐-p${page}.jpg`;
  const dest=path.join(base,'90-图片',name);
  if(!fs.existsSync(dest))jobs.push({source:path.join(base,'91-原始PDF',plan.pdf),dest,page,rect});
}
const script="import sys,json,fitz,base64\nfor job in json.loads(base64.b64decode(sys.stdin.buffer.read())):\n d=fitz.open(job['source']);p=d[job['page']-1];p.get_pixmap(matrix=fitz.Matrix(2,2),clip=fitz.Rect(job['rect'])).save(job['dest'])\n";
const render=spawnSync('python',['-c',script],{input:Buffer.from(JSON.stringify(jobs)).toString('base64'),encoding:'utf8'});
if(render.status!==0)throw new Error(render.stderr||'PDF rendering failed');
for(const plan of plans){
  const dir=path.join(base,plan.category+'类',plan.date.slice(0,4),plan.date);
  const dataFile=path.join(dir,'资料分析.md'),mathFile=path.join(dir,plan.quantity+'.md');
  const parse=file=>{const text=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n'),heads=[...text.matchAll(/^## 第 (\d+) 题 · (.+)$/gm)];return {text,header:text.slice(0,heads[0].index),blocks:heads.map((h,i)=>({no:+h[1],block:text.slice(h.index,heads[i+1]?.index??text.length)}))};};
  const data=parse(dataFile),math=parse(mathFile);
  if(data.blocks.length===10&&(plan.existingMaterials||data.text.includes('材料-核对补齐')))continue;
  const moved=math.blocks.filter(r=>r.no>=51&&r.no<=60),questions=[...data.blocks,...moved].sort((a,b)=>a.no-b.no);
  if(questions.length!==10||new Set(questions.map(r=>r.no)).size!==10)throw new Error('Repair would lose questions: '+plan.date+'/'+plan.category);
  const remaining=math.blocks.filter(r=>r.no<51||r.no>60);
  for(const entry of moved){
    const old=JSON.parse(entry.block.match(/<!-- shiye-taxonomy: (.+) -->/)[1]);
    const stem=entry.block.split('**题干**')[1].split('> [!example]')[0];
    const expl=entry.block.split(/\*\*原件解析[^\n]*\*\*/)[1]?.split('> [!example]')[0]||'';
    const c=classify({module:'资料分析',type:'资料分析',stem,explanation:expl,answer:entry.block.match(/\*\*参考答案\*\*[：:]\s*([A-D]+)/)?.[1]}, {ignorePersisted:true});
    c.version=INSTITUTION_VERSION;c.frameworkVersion='fenbi-v2.20261011';c.sourcePages=old.classification.sourcePages;c.correction={date:'2026-10-11',basis:'对照原卷资料分析段及共享材料',previous:{sourceModule:old.sourceModule,sourceType:old.sourceType,group:old.classification.group,tag:old.classification.tag}};
    const fresh={...old,sourceType:'资料分析',classification:c};
    entry.block=entry.block.replace(/^## 第 (\d+) 题 · .+$/m,'## 第 $1 题 · 资料分析').replace(/<!-- shiye-taxonomy: .+ -->/,'<!-- shiye-taxonomy: '+JSON.stringify(fresh)+' -->').replace(/^> \*\*主考点\*\*：.*$/m,`> **主考点**：#事业编/资料分析/${c.group}/${c.tag}  · 分类：${c.confidence}`);
    changes.push({qid:old.qid,oldFile:mathFile,newFile:dataFile,classification:c});
  }
  const header=data.header.replace(/^题数: \d+$/m,'题数: 10');
  let body=header;
  for(const entry of questions){
    const material=plan.materials.find(m=>m[0]===entry.no);
    if(material){const [no,pn,,title]=material;body+=`### 共享材料\n\n${title}。以下材料已对照原件第 ${pn} 页补齐，图表与数据以原图为准。\n\n![[07-事业编职测/90-图片/${plan.category}-${plan.date}-m${no}-材料-核对补齐-p${pn}.jpg]]\n\n^sy-material-${plan.category.toLowerCase()}${plan.date.replaceAll('-','')}m${no}\n\n`;}
    if(!entry.block.includes('本题按上方共享材料作答。'))entry.block=entry.block.replace(/(\*\*参考答案\*\*[：:].*\n)/,'$1\n本题按上方共享材料作答。\n');
    body+=entry.block;
  }
  const mathBody=remaining.map(r=>r.block).join('');
  // Shared passages were duplicated at the end of the math file solely because
  // a data question had been misplaced there. The correct data note retains it.
  write(dataFile,body);write(mathFile,math.header.replace(/^题数: \d+$/m,'题数: '+remaining.length)+(plan.existingMaterials?mathBody.split('### 共享材料')[0]:mathBody));
  const index=path.join(dir,'试卷目录.md');let text=fs.readFileSync(index,'utf8');
  text=text.replace(new RegExp('(\\| '+plan.quantity+' \\| )\\d+( \\|)'),'$1'+remaining.length+'$2').replace(/(\| 资料分析 \| )\d+( \|)/,'$110$2');
  for(const entry of moved){const c=JSON.parse(entry.block.match(/<!-- shiye-taxonomy: (.+) -->/)[1]).classification;text=text.replace(new RegExp('^\\| '+entry.no+' \\|.*$','m'),`| ${entry.no} | 资料分析 | 资料分析 | ${c.tag} | ${entry.block.match(/\*\*参考答案\*\*[：:]\s*([A-D]+)/)?.[1]||'缺失'} | [[${path.relative(root,dataFile).replaceAll('\\','/').replace(/\.md$/,'')}#^sy-q-${plan.category.toLowerCase()}-${plan.date.replaceAll('-','')}-${String(entry.no).padStart(3,'0')}|${plan.date} ${plan.category}类 · 第${entry.no}题]] |`);}
  write(index,text);
}
if(!changes.length){console.log('Source repairs already applied; existing notes and repair report preserved.');process.exit(0);}
// Update exact block links wherever the moved questions were indexed. Main-tag
// index rows are relocated to their corrected tag; arbitrary notes stay intact.
const indexRoot=path.join(base,'99-分类与导入');
const all=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())walk(file);else if(e.name.endsWith('.md'))all.push(file);}}walk(indexRoot);
for(const file of all){let text=fs.readFileSync(file,'utf8'),before=text;
  for(const change of changes){const old=path.relative(root,change.oldFile).replaceAll('\\','/').replace(/\.md$/,''),fresh=path.relative(root,change.newFile).replaceAll('\\','/').replace(/\.md$/,''),anchor=change.qid.replace(/^sy-/,'sy-q-');text=text.replaceAll(old+'#^'+anchor,fresh+'#^'+anchor);
    if(file.includes(path.sep+'主考点'+path.sep))text=text.split(/\r?\n/).filter(line=>!line.includes('#^'+anchor)).join('\n');
  }if(text!==before)write(file,text);
}
for(const change of changes){const c=change.classification,folder=path.join(indexRoot,'主考点','资料分析'),file=path.join(folder,c.group+'-'+c.tag+'.md');fs.mkdirSync(folder,{recursive:true});
  let text=fs.existsSync(file)?fs.readFileSync(file,'utf8'):`# ${c.group} · ${c.tag}\n\n#事业编/资料分析/${c.group}/${c.tag}\n\n`;
  const anchor=change.qid.replace(/^sy-/,'sy-q-'),link=path.relative(root,change.newFile).replaceAll('\\','/').replace(/\.md$/,'');
  text+=`\n- [[${link}#^${anchor}|${change.qid} · 已对照原卷修正模块归属]]\n`;write(file,text);
}
const report=path.join(indexRoot,'网站接入核对补充.md');
const previous=fs.existsSync(report)?fs.readFileSync(report,'utf8').split('\n').filter(line=>line.startsWith('- sy-')):[];
write(report,'# 网站接入核对补充\n\n2026-10-11：对照原始 PDF，补齐 B 类 2024-11-02、B 类 2026-03-29、C 类 2024-11-02 第 51—60 题的 6 组共享材料；检查其他含共享材料的数学运算题，修正误归模块的资料题。题号、qid、原图、参考答案和解析未修改。\n\n'+[...previous,...changes.map(r=>'- '+r.qid+' → 资料分析 / '+r.classification.group+' / '+r.classification.tag)].join('\n')+'\n\n备份位于网站仓库 tmp/institution-source-backup。原件缺答案的两道题继续保留“缺失”，不将 AI 建议答案当作参考答案。分类仍有待复核项，本次修正不是全题人工审核。\n');
console.log('Obsidian source repairs:',changes.map(c=>c.qid).join(', '),'and 6 original material crops; backups:',backup);
