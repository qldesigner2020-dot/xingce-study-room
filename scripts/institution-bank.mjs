import fs from 'node:fs';
import path from 'node:path';

const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const metadata=raw=>Object.fromEntries((raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]||'').split(/\r?\n/).flatMap(line=>{const m=line.match(/^([^:]+):\s*(.*?)\s*$/);return m?[[m[1],m[2]]]:[];}));
const imageLinks=text=>[...text.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map(m=>m[1]);
const clean=text=>text.replace(/^>.*$/gm,'').replace(/^\^.*$/gm,'').replace(/!\[\[[^\]]+\]\]/g,'').replace(/^---\s*$/gm,'').trim();

/** Import the Obsidian notes as-is: source IDs, taxonomy and OCR are retained.
 * Use original crops on screen/print because OCR loses figures and fractions. */
export function readInstitutionBank(root,registerImage) {
  const base=path.join(root,'07-事业编职测'),parsed=[];
  if(!fs.existsSync(base))return parsed;
  const renderImages=text=>imageLinks(text).map(source=>{
    const normalized=source.replaceAll('\\','/');
    if(!normalized.startsWith('07-事业编职测/90-图片/')||normalized.includes('..'))throw new Error('Unsafe institution image: '+source);
    const abs=path.join(root,...normalized.split('/'));
    if(!fs.existsSync(abs))throw new Error('Missing institution image: '+source);
    const rel='assets/img/institution/'+path.basename(abs);
    registerImage(rel,abs);
    return '<img src="'+esc(rel)+'" class="fig source-crop" alt="试题原图">';
  }).join('');
  function walk(dir){
    for(const item of fs.readdirSync(dir,{withFileTypes:true})){
      const abs=path.join(dir,item.name);
      if(item.isDirectory()){walk(abs);continue;}
      if(!item.name.endsWith('.md'))continue;
      const raw=fs.readFileSync(abs,'utf8').replace(/\r\n/g,'\n'),meta=metadata(raw);
      if(meta['考试领域']!=='事业单位职测'||!meta['模块'])continue;
      if(!/^[ABC]$/.test(meta['类别'])||!/^\d{4}-\d{2}-\d{2}$/.test(meta['日期']))throw new Error('Invalid institution metadata: '+abs);
      const headings=[...raw.matchAll(/^## 第 (\d+) 题 · (.+)$/gm)],questions=[];
      if(headings.length!==Number(meta['题数']))throw new Error('Institution count mismatch: '+abs);
      let shared=null;
      for(let i=0;i<headings.length;i++){
        const h=headings[i],end=headings[i+1]?.index??raw.length;
        const before=raw.slice(i?headings[i-1].index:0,h.index);
        const matAt=before.lastIndexOf('### 共享材料');
        // A new material occurs between two question blocks, never in an answer.
        if(matAt>=0){
          const body=before.slice(matAt+'### 共享材料'.length);
          const marker=body.match(/\^sy-material-[abc]\d{8}m(\d+)/);
          if(!marker)throw new Error('Missing material identity: '+abs+'/'+h[1]);
          shared={no:Number(marker[1]),html:renderImages(body),text:clean(body)};
          if(!shared.html)throw new Error('Missing material images: '+abs+'/'+h[1]);
        }
        let block=raw.slice(h.index,end);
        const nextMaterial=block.indexOf('### 共享材料');if(nextMaterial>=0)block=block.slice(0,nextMaterial);
        const annotation=block.match(/<!-- shiye-taxonomy: (.+) -->/);
        if(!annotation)throw new Error('Missing Obsidian taxonomy: '+abs+'/'+h[1]);
        const saved=JSON.parse(annotation[1]),no=Number(h[1]);
        if(saved.qid!==`sy-${meta['类别'].toLowerCase()}-${meta['日期'].replaceAll('-','')}-${String(no).padStart(3,'0')}`)throw new Error('Institution qid mismatch: '+abs+'/'+no);
        const c=saved.classification;
        if(c.version!=='shiye-v1.20261011')throw new Error('Unsupported institution taxonomy: '+c.version);
        const stemAt=block.indexOf('**题干**');if(stemAt<0)throw new Error('Missing question text: '+saved.qid);
        const content=block.slice(stemAt+'**题干**'.length),cropStart=content.indexOf('> [!example]');
        if(cropStart<0)throw new Error('Missing original question: '+saved.qid);
        const questionText=content.slice(0,cropStart),optAt=questionText.search(/^- \*\*[A-D]\*\*\./m);
        const stemText=clean(optAt<0?questionText:questionText.slice(0,optAt));
        const extracted=new Map([...questionText.matchAll(/^- \*\*([A-D])\*\*\.\s*(.+)$/gm)].map(m=>[m[1],m[2].replace(/\s*✅\s*$/,'').trim()]));
        const ansAt=content.indexOf('**参考答案**'),questionImages=renderImages(content.slice(cropStart,ansAt));
        if(!questionImages)throw new Error('Missing original question image: '+saved.qid);
        const answerRaw=block.match(/\*\*参考答案\*\*[：:]\s*(.*)/)?.[1]?.trim()||'';
        const answer=/^[A-D]+$/.test(answerRaw)?answerRaw:'';
        if(!answer&&!/缺失|待核对|未提供/.test(answerRaw))throw new Error('Unrecognized answer: '+saved.qid+'/'+answerRaw);
        const explStart=block.search(/\*\*原件解析[^\n]*\*\*/),sourceAt=block.indexOf('**来源**');
        const explBlock=explStart<0?'':block.slice(explStart,sourceAt<0?undefined:sourceAt);
        const explText=clean(explBlock.replace(/^\*\*原件解析.*$/m,''));
        const module=meta['模块']==='数量分析'?'数量关系':/综合分析|策略选择|实验设计/.test(meta['模块'])?'综合分析':meta['模块'];
        const sourceType=saved.sourceType,type=sourceType==='时事政治'&&module==='常识判断'?'常识时政':/^综合分析[BC]$/.test(sourceType)?'综合分析':sourceType;
        const material=/本题按上方共享材料作答/.test(block)?shared:null;
        questions.push({qid:saved.qid,no,type,module,classification:c,
          stem:'<div class="source-question">'+questionImages+'</div>',
          material:material?.html?'<div class="source-material">'+material.html+'</div>':undefined,materialNo:material?.no,
          options:['A','B','C','D'].map(k=>({k,t:esc(extracted.get(k)||k)})),answer,multi:answer.length>1,
          answerStatus:answer?'reference':'missing',explanation:renderImages(explBlock)||'<p>'+esc(explText||'原件未提供独立解析。')+'</p>',
          original:true,sourceText:{stem:stemText,options:['A','B','C','D'].map(k=>({k,t:extracted.get(k)||k})),material:material?.text||'',explanation:explText},
          from:{file:path.relative(root,abs).replaceAll('\\','/'),module,sourceModule:saved.sourceModule,sourceType,questionPages:c.sourcePages?.paper,answerPages:c.sourcePages?.answer},
        });
      }
      const moduleKey=meta['模块']==='数量分析'?'数量关系':/综合分析|策略选择|实验设计/.test(meta['模块'])?'综合分析':meta['模块'];
      parsed.push({absPath:abs,moduleKey,institution:true,meta:{'试卷':`${meta['日期']} 全国事业单位联考职业能力倾向测验 ${meta['类别']}类`,'年份':meta['年份'],'地区':'全国联考','考试类别':'事业编','事业编类别':meta['类别'],'日期':meta['日期']},questions});
    }
  }
  for(const category of ['A类','B类','C类']){const dir=path.join(base,category);if(fs.existsSync(dir))walk(dir);}
  return parsed;
}
