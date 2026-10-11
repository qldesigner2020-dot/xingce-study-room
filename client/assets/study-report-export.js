(function(root){
  'use strict';
  const D=root.StudyReportData,utf8=new TextEncoder(),pct=n=>n==null?'未知':(100*n).toFixed(1)+'%',sec=n=>n==null?'未知':(n/1000).toFixed(1)+' 秒';
  const familiar={first:'第一次做',forgot:'做过忘了答案',remember:'做过记得答案'},confidence={clear:'思路清楚',hesitant:'有犹豫',guess:'猜测 / 蒙的'};
  const safe=s=>String(s).replace(/[^A-Za-z0-9_-]/g,'_'),check=signal=>{if(signal?.aborted)throw new DOMException('已取消','AbortError');};
  const task='# AI 分析任务\n\n请先读取口径说明与统计。不要把复刷正确、记得答案、蒙对、犹豫正确等同于独立掌握。依据具体题目和各次作答识别知识缺口、解题方法、审题和速度问题。每项结论引用题目 ID 与作答 ID；区分事实、考生自述和推断。不能用缺参考答案的题评价正确率；对答案疑问先核验。给出未来一周的训练重点、建议题量和复测方式，并说明证据不足的部分。\n\n先检查图片、原题、答案和手写预览是否能读取。原图 OCR 为辅助提取文字，公式以原图为准。若无法解压 ZIP，先分析总览与 statistics，再请我上传指定题目 MD 和图片。\n';
  const csv=(groups)=>'\ufeff'+[['模块','题型','主考点','全部作答次数','有答案已答','答对','全部正确率','首次有效题量','首次答对','首次正确率','95%下界','95%上界','平均毫秒','中位毫秒','样本提示'],...groups.map(g=>[...g.labels.concat(['','']).slice(0,3),g.answered,g.graded,g.right,g.accuracy??'',g.firstN,g.firstRight,g.firstAccuracy??'',g.interval?.[0]??'',g.interval?.[1]??'',g.meanMs??'',g.medianMs??'',g.sample])].map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  function overview(view,context={}){const s=view.overall;return `# 我的学习总览\n\n导出时间：${new Date().toLocaleString('zh-CN')}\n\n范围：${JSON.stringify(context)}\n\n| 指标 | 结果 |\n|---|---|\n| 已作答次数 / 去重题量 | ${s.answered} / ${s.unique} |\n| 首次有效正确率 | ${pct(s.firstAccuracy)}（${s.firstRight}/${s.firstN}） |\n| 全部作答正确率 | ${pct(s.accuracy)}（${s.right}/${s.graded}） |\n| 平均 / 中位用时 | ${sec(s.meanMs)} / ${sec(s.medianMs)} |\n| 待巩固题目 | ${s.consolidate} |\n| 蒙对 / 犹豫 / 记得答案 | ${s.guessCorrect} / ${s.hesitant} / ${s.remembered} |\n| 未答 / 缺参考或题目 / 缺计时 | ${s.unanswered} / ${s.pending} / ${s.missingTime} |\n\n## 模块表现\n\n| 模块 | 首次有效正确率 | 样本 | 全部正确率 | 平均用时 |\n|---|---|---|---|---|\n${view.modules.map(g=>`| ${g.labels[0]} | ${pct(g.firstAccuracy)} | ${g.firstN} · ${g.sample} | ${pct(g.accuracy)} | ${sec(g.meanMs)} |`).join('\n')}\n\n## 优先观察的考点\n\n${view.concepts.slice().sort((a,b)=>(a.firstN<10)-(b.firstN<10)||(a.firstAccuracy??1)-(b.firstAccuracy??1)).slice(0,15).map(g=>`- ${g.labels.join(' / ')}：${pct(g.firstAccuracy)}，${g.firstN} 道首次有效；${g.sample}，平均 ${sec(g.meanMs)}。`).join('\n')}\n\n以上是练习统计。样本、记忆、猜测、复刷和计时缺失都会影响解释，不能据此计算官方能力分或预测分。具体作答证据见 questions 与 attempts。\n`;}
  function small({data,filters,host}){const view=D.select(data,filters);host.download('我的学习报告_摘要.md',overview(view,filters)+'\n'+task);}
  function allImagePaths(q,host){return [...new Set([...D.paths(q),...root.ExportTools.imagePaths(host.htmlToMd(q?.explanation||''))])];}
  function planPackages(rows,images,limitMB){
    const grouped=new Map();for(const r of rows){const id=r.examType+'-'+r.examClass+'-'+r.module;if(!grouped.has(id))grouped.set(id,new Map());const contents=grouped.get(id);if(!contents.has(r.contentId))contents.set(r.contentId,[]);contents.get(r.contentId).push(r);}
    const limit=Math.max(1,limitMB)*1024*1024,parts=[];
    let current={rows:[],paths:new Set(),estimate:60000,labels:new Set()};
    const finish=()=>{if(current.rows.length)parts.push({...current,paths:[...current.paths],labels:[...current.labels]});current={rows:[],paths:new Set(),estimate:60000,labels:new Set()};};
    for(const [label,contents] of grouped){if(current.rows.length&&current.estimate>limit*.65)finish();
      for(const allAttempts of contents.values())for(let start=0;start<allAttempts.length;start+=100){
        const attempts=allAttempts.slice(start,start+100);
        const paths=[...new Set(attempts.flatMap(r=>images.questionPaths[r.contentId]||[]))],base=utf8.encode(JSON.stringify(attempts[0].q)).length*2+utf8.encode(JSON.stringify(attempts.map(r=>({a:r.a,ref:r.ref})))).length*3+attempts.filter(r=>r.a.annotations?.strokes?.length||r.a.annotations?.marks?.length).length*450000;
        const added=paths.filter(p=>!current.paths.has(p)).reduce((n,p)=>n+(images.meta[p]?.bytes||0),0)+base;
        if(current.rows.length&&current.estimate+added>limit)finish();
        const imageBytes=paths.filter(p=>!current.paths.has(p)).reduce((n,p)=>n+(images.meta[p]?.bytes||0),0);
        current.rows.push(...attempts);current.labels.add(label);for(const p of paths)current.paths.add(p);current.estimate+=base+imageBytes;
      }
    }finish();return parts;
  }
  function writer(signal){
    let worker;try{worker=new Worker('assets/report-zip-worker.js');}catch(error){throw new Error('浏览器不允许后台打包。请用在线版导出，或先导出小型摘要。'+error.message);}
    let sequence=0;const requests=new Map();
    const stop=()=>{worker.terminate();for(const p of requests.values())p.reject(new DOMException('已取消','AbortError'));requests.clear();};signal?.addEventListener('abort',stop,{once:true});
    worker.onmessage=e=>{const p=requests.get(e.data.id);if(!p)return;requests.delete(e.data.id);e.data.error?p.reject(new Error(e.data.error)):p.resolve(e.data);};
    worker.onerror=()=>{for(const p of requests.values())p.reject(new Error('打包线程失败'));requests.clear();};
    const send=(type,payload,transfer=[])=>{check(signal);const id=++sequence;return new Promise((resolve,reject)=>{requests.set(id,{resolve,reject});worker.postMessage({id,type,...payload},transfer);});};
    return {async add(name,data){if(data instanceof Uint8Array){const buffer=data.slice().buffer;return send('add',{name,data:buffer},[buffer]);}return send('add',{name,data});},finish:manifest=>send('finish',{manifest}),close(){signal?.removeEventListener('abort',stop);worker.terminate();}};
  }
  function portableSessions(rows){const by=new Map();for(const r of rows){if(!by.has(r.session.id)){const s=r.session;by.set(s.id,{id:s.id,title:s.title,kind:s.kind,paperId:s.paperId??null,createdAt:s.createdAt??null,submittedAt:s.submittedAt??null,submitted:s.submitted??null,index:0,training:s.training??null,meta:s.meta??null,refs:[],answers:{},evidence:{}});}const s=by.get(r.session.id);s.refs.push(r.ref);s.answers[r.ref.qid]=r.a;s.evidence[r.ref.qid]={contentId:r.contentId,classification:r.q?.classification??null,referenceAnswer:r.q?.answer??null,answerStatus:r.q?.answerStatus??null,capturedAt:r.session.evidence?.[r.ref.qid]?.capturedAt??null,provenance:r.provenance};}return [...by.values()];}
  function indexRows(rows){return rows.map(r=>({attemptId:r.attemptId,order:r.order??null,contentId:r.contentId,sourceId:r.sourceId,sessionId:r.session.id,ref:r.ref,correct:r.correct,first:r.first,at:r.at,dateKnown:r.dateKnown,module:r.module,type:r.type,concept:r.concept,examType:r.examType,examClass:r.examClass,year:r.year,region:r.region,paperName:r.paperName,paperId:r.paperId,identityComplete:r.identityComplete,classification:r.q?.classification??null,referenceAnswer:r.q?.answer??null,answerStatus:r.q?.answerStatus??null,provenance:r.provenance,currentFavorite:r.favorite}));}
  async function annotationPreview(row,{images,host,signal}){
    check(signal);if(!root.html2canvas)await host.loadScript('assets/vendor/html2canvas.min.js');check(signal);
    const ann=row.a.annotations||{},wrapper=document.createElement('div');wrapper.style.cssText='position:fixed;left:-10000px;top:0;z-index:-1;width:800px;background:#f5f7f3;color:#25362c;padding:26px;font:500 19px/1.9 "Microsoft YaHei",sans-serif;pointer-events:none';
    const embed=h=>root.StudyReport.sanitize(h).replace(/src=["'](assets\/img\/[^"']+)["']/g,(_,p)=>`src="data:${images.mime(p)};base64,${images.base64[p]}"`);
    const zones=[...(row.q?.material?[['material',row.q.material]]:[]),['stem',row.q?.stem||'题目未能加载'],...(row.q?.options||[]).map(o=>['opt-'+o.k,o.t,o.k])];
    wrapper.innerHTML=zones.map(([id,h,key])=>`<div data-export-zone="${id}" style="position:relative;padding:10px 0;${key?'display:flex;gap:12px':''}">${key?'<b style="font-weight:500">'+key+'.</b>':''}<div data-export-text style="flex:1;min-width:0">${embed(h)}</div></div>`).join('');wrapper.querySelectorAll('img').forEach(img=>{img.style.maxWidth='100%';img.style.height='auto';});document.body.appendChild(wrapper);
    try{
      await Promise.all([...wrapper.querySelectorAll('img')].map(img=>img.decode().catch(()=>{})));check(signal);
      const NS='http://www.w3.org/2000/svg',allPaths=[];let reconstructed=false;
      for(const zone of wrapper.querySelectorAll('[data-export-zone]')){
        const id=zone.dataset.exportZone,strokes=(ann.strokes||[]).filter(s=>s.zone===id),refs=strokes.map(s=>s.reference).filter(Boolean);
        if(refs[0]){zone.style.width=Math.max(100,refs[0].width)+'px';zone.style.fontSize=refs[0].font+'px';wrapper.style.width=Math.max(800,refs[0].width+52)+'px';}
        const bounds=zone.getBoundingClientRect(),textNodes=[];const walker=document.createTreeWalker(zone.querySelector('[data-export-text]'),NodeFilter.SHOW_TEXT);let n,start=0;while(n=walker.nextNode()){textNodes.push({node:n,start,end:start+n.length});start+=n.length;}
        const origin=offset=>{const found=textNodes.find(t=>offset>=t.start&&offset<t.end)||textNodes.at(-1);if(!found)return null;const r=document.createRange(),i=Math.max(0,Math.min(found.node.length-1,offset-found.start));r.setStart(found.node,i);r.setEnd(found.node,i+1);return r.getBoundingClientRect();};
        const svg=document.createElementNS(NS,'svg');svg.setAttribute('width',bounds.width);svg.setAttribute('height',bounds.height);svg.style.cssText='position:absolute;inset:0;overflow:visible;pointer-events:none';
        for(const stroke of strokes){const reference=stroke.reference,font=reference?.font||19,anchor=origin(stroke.anchor),x=reference?.originX??(anchor?anchor.left-bounds.left:0),y=reference?.originY??(anchor?anchor.top-bounds.top:0);if(!reference)reconstructed=true;
          const d=stroke.points.map((p,i)=>`${i?'L':'M'}${(x+p[0]*font).toFixed(2)},${(y+p[1]*font).toFixed(2)}`).join(' '),path=document.createElementNS(NS,'path');path.setAttribute('d',d);path.setAttribute('fill','none');path.setAttribute('stroke',/^#[0-9a-f]{3,8}$/i.test(stroke.color)?stroke.color:'#b54836');path.setAttribute('stroke-width',stroke.width||2);path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');svg.appendChild(path);
          const r=zone.getBoundingClientRect(),base=wrapper.getBoundingClientRect();allPaths.push(`<g transform="translate(${r.left-base.left},${r.top-base.top})">${path.outerHTML}</g>`);
        }
        for(const mark of (ann.marks||[]).filter(m=>m.zone===id))for(const t of textNodes){const a=Math.max(mark.start,t.start),b=Math.min(mark.end,t.end);if(a>=b)continue;const range=document.createRange();range.setStart(t.node,a-t.start);range.setEnd(t.node,b-t.start);for(const rect of range.getClientRects()){const highlight=mark.kind==='highlight',shape=document.createElementNS(NS,'rect');shape.setAttribute('x',rect.left-bounds.left);shape.setAttribute('y',rect.top-bounds.top+(highlight?0:rect.height-1));shape.setAttribute('width',rect.width);shape.setAttribute('height',highlight?rect.height:1.5);shape.setAttribute('fill',highlight?'#c4af55':'#b54836');if(highlight)shape.setAttribute('opacity','.3');svg.appendChild(shape);const zr=zone.getBoundingClientRect(),base=wrapper.getBoundingClientRect();allPaths.push(`<g transform="translate(${zr.left-base.left},${zr.top-base.top})">${shape.outerHTML}</g>`);}}
        zone.appendChild(svg);
      }
      const bounds=wrapper.getBoundingClientRect();check(signal);const canvas=await root.html2canvas(wrapper,{backgroundColor:'#f5f7f3',scale:1,logging:false,useCORS:false});check(signal);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('手写预览生成失败');
      return {png:new Uint8Array(await blob.arrayBuffer()),svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="0 0 ${bounds.width} ${bounds.height}"><metadata>${row.attemptId}; ${reconstructed?'legacy geometry reconstructed':'saved reference geometry'}</metadata>${allPaths.join('')}</svg>`,reconstructed};
    }finally{wrapper.remove();}
  }
  async function full({data,filters={},scope='all',limitMB=80,host,signal,onProgress=()=>{},onPackage=()=>{}}){
    await root.StudyStorage?.flush();check(signal);
    const fullView=D.select(data,filters),latest=new Map(fullView.rows.map(r=>[r.contentId,r])),wanted=new Set([...latest.values()].filter(D.needs).map(r=>r.contentId));
    const rows=fullView.rows.filter(r=>scope!=='consolidate'||wanted.has(r.contentId));if(!rows.length)throw new Error('所选范围没有题目');
    const questionPaths={},meta={},paths=new Set();for(const r of rows){questionPaths[r.contentId]=[...new Set([...(questionPaths[r.contentId]||[]),...allImagePaths(r.q,host)])];for(const p of questionPaths[r.contentId])paths.add(p);}
    const list=[...paths];let read=0;
    for(let i=0;i<list.length;i+=4){check(signal);await Promise.all(list.slice(i,i+4).map(async p=>{const base64=(await root.ExportTools.images('![图片]('+p+')',host.loadScript))[p],bytes=root.ExportTools.decode(base64);meta[p]={bytes:bytes.length,hash:await D.hash(bytes),ext:p.split('.').at(-1).toLowerCase()};onProgress(++read,list.length,'核算题目与图片 '+read+' / '+list.length);}));}
    check(signal);const packages=planPackages(rows,{meta,questionPaths},limitMB),bytes=Object.values(meta).reduce((n,m)=>n+m.bytes,0);
    onProgress(0,packages.length,`预计原图 ${(bytes/1024/1024).toFixed(1)} MB，生成 ${packages.length} 个包（包含预览的实际大小会略有增加）`);
    const date=new Date().toLocaleDateString('sv-SE'),packageNames=packages.map((_,i)=>'我的学习报告_'+date+'_'+String(i+1).padStart(2,'0')+'-共'+packages.length+'包.zip');
    for(let part=0;part<packages.length;part++){
      check(signal);const pkg=packages[part],w=writer(signal),imageMap={},base64={},mime=p=>({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',svg:'image/svg+xml',webp:'image/webp',gif:'image/gif'}[meta[p]?.ext]||'image/png');let reconstructed=0;
      try{
        for(let i=0;i<pkg.paths.length;i++){check(signal);const p=pkg.paths[i];onProgress(i,pkg.paths.length,'第 '+(part+1)+' / '+packages.length+' 包：打包图片 '+(i+1)+' / '+pkg.paths.length);
          base64[p]=(await root.ExportTools.images('![图片]('+p+')',host.loadScript))[p];const m=meta[p];imageMap[p]='images/'+m.hash+'.'+m.ext;
          if(!Object.values(imageMap).slice(0,-1).includes(imageMap[p]))await w.add(imageMap[p],root.ExportTools.decode(base64[p]));
        }
        const md=h=>host.htmlToMd(h||'').replace(/\]\((assets\/img\/[^)]+)\)/g,(_,p)=>'](../'+imageMap[p]+')');
        const grouped=new Map(),bySession=new Map(),attemptFiles=new Map(),sessionChunks=[],versions={},versionIds=new Map(),versionCache=new Map();
        for(const r of pkg.rows){if(!grouped.has(r.contentId))grouped.set(r.contentId,[]);grouped.get(r.contentId).push(r);if(!bySession.has(r.session.id))bySession.set(r.session.id,[]);bySession.get(r.session.id).push(r);const signature=JSON.stringify(r.q);if(!versionCache.has(signature)){versionCache.set(signature,'v-'+await D.hash(signature));versions[versionCache.get(signature)]=r.q;}versionIds.set(r.attemptId,versionCache.get(signature));}
        for(const s of portableSessions(pkg.rows)){
          const attempts=bySession.get(s.id);for(let i=0;i<attempts.length;i+=100){const chunk=attempts.slice(i,i+100),path='attempts/'+safe(s.id)+(attempts.length>100?'-'+(Math.floor(i/100)+1):'')+'.md';sessionChunks.push({session:s,rows:chunk,path});for(const r of chunk)attemptFiles.set(r.attemptId,path);}
        }
        for(const [id,attempts] of grouped){const r=attempts[0],q=r.q,sources=[...new Set(attempts.map(a=>a.paperName+' · 原题 '+(a.ref.no??'未知')+' · '+a.sourceId))];
          const body=`# ${id}\n\n模块：${r.module} / 题型：${r.type} / 主考点：${r.concept}\n\n分类版本 / 置信度：${q?.classification?.version||'未知'} / ${q?.classification?.confidence||'未知'}\n\n分类依据：${q?.classification?.basis||'未知'}\n\n证据版本：${r.provenance}\n\n${q?`## 材料\n\n${md(q.material)||'无独立材料'}\n\n## 题干\n\n${md(q.stem)}\n\n## 选项\n\n${(q.options||[]).map(o=>'**'+o.k+'** '+md(o.t)).join('\n\n')}\n\n## 参考答案与解析\n\n参考答案：${q.answer||'缺失，待核对'}（来源状态：${q.answerStatus||'历史参考答案'}）\n\n${md(q.explanation)||'暂无解析'}\n\n${q.sourceText?'## 原件提取文字（OCR / PDF 辅助，不替代原图）\n\n'+(q.sourceText.material||'')+'\n\n'+(q.sourceText.stem||'')+'\n\n'+(q.sourceText.explanation||''):''}`:'原题未加载，保留原卷位置与作答，不能据此判断答案。'}\n\n## 所有原卷位置\n\n${sources.map(s=>'- '+s).join('\n')}\n\n## 本包全部作答\n\n${attempts.map(a=>'- ['+a.attemptId+'](../'+attemptFiles.get(a.attemptId)+'#'+a.attemptId.toLowerCase()+')').join('\n')}\n`;
          const variants=[...new Map(attempts.map(a=>[a.q?.explanation||'',a])).values()].filter(a=>a.q?.explanation&&a.q.explanation!==q?.explanation);
          const extra=variants.length?'\n## 其他来源版本的解析\n\n'+variants.map(a=>'### '+a.paperName+' · 原题 '+a.ref.no+'\n\n'+md(a.q.explanation)).join('\n\n'):'';
          await w.add('questions/'+id+'.md',body+extra+'\n\n原始题目版本与分类差异见 [question-versions.json](../raw/question-versions.json)，逐次索引中的 questionVersionId 对应版本。\n');
        }
        const annotations=[];
        for(const chunk of sessionChunks){const s=chunk.session;let body=`# ${s.title}\n\n练习 ID：${s.id}\n\n开始：${s.createdAt?new Date(s.createdAt).toISOString():'历史未知'}\n\n提交：${s.submittedAt?new Date(s.submittedAt).toISOString():'历史未知'}\n\n练习方式：${s.kind}\n\n组题条件与配额：\n\n\`\`\`json\n${JSON.stringify(s.training,null,2)}\n\`\`\`\n\n`;
          for(const r of chunk.rows){check(signal);const a=r.a;body+=`<a id="${r.attemptId.toLowerCase()}"></a>\n\n## ${r.attemptId}\n\n[查看完整题目](../questions/${r.contentId}.md)\n\n原卷：${r.paperName} / 原题号 ${r.ref.no??'未知'}\n\n所选答案：${a.pick||'未作答'} / 参考答案：${r.q?.answer||'缺失'} / 结果：${!a.pick?'未答':r.correct==null?'待核对':r.correct?'正确':'错误'}\n\n有效用时：${sec(a.ms||null)} / ${r.first?'首次可计分记录':'复刷或待核对'}\n\n熟悉程度：${familiar[a.review?.familiarity]||'未标注'} / 把握：${confidence[a.review?.confidence]||'未标注'}\n\n待复查：${a.flagged?'是':'否'} / 当前收藏：${r.favorite?'是':'否'}（当次收藏状态：历史未记录） / 考生质疑答案：${a.answerDoubt?'是':'未标记'}\n\n排除选项：${Array.from(a.excluded||[]).join('、')||'无'}\n\n自评修改时间：${a.review?.updatedAt?new Date(a.review.updatedAt).toISOString():'历史未知'}\n\n### 我的复盘\n\n${a.reflection||'未填写'}\n\n复盘修改时间：${a.reflectionUpdatedAt?new Date(a.reflectionUpdatedAt).toISOString():'历史未知'}\n\n### 当时草稿\n\n${a.note||'未填写'}\n\n`;
            if(a.annotations?.strokes?.length||a.annotations?.marks?.length){onProgress(0,1,'第 '+(part+1)+' 包：合成手写预览 '+r.attemptId);const preview=await annotationPreview(r,{images:{base64,mime},host,signal});if(preview.reconstructed)reconstructed++;
              await w.add('annotations/'+safe(r.attemptId)+'.svg',preview.svg);await w.add('annotations/'+safe(r.attemptId)+'.png',preview.png);
              body+=`### 手写标注合成预览\n\n![标注预览](../annotations/${safe(r.attemptId)}.png)\n\n[独立手写图层](../annotations/${safe(r.attemptId)}.svg)；原始路径与锚点见 raw/annotations.json。${preview.reconstructed?'旧笔迹未保存原始尺寸，预览按文本锚点重建，位置可能有偏差。':'含当时参考尺寸，按原始坐标复原。'}\n\n`;
              annotations.push({attemptId:r.attemptId,contentId:r.contentId,annotations:a.annotations,reconstructed:preview.reconstructed});
            }
          }await w.add(chunk.path,body);
        }
        const selected=D.select({rows:pkg.rows},{}),globalText=overview(fullView,filters),partText=overview(selected,{part:part+1,total:packages.length,scope,modules:pkg.labels});
        const intro=`# 先读这里\n\n本文件是个人学习分析包 ${part+1} / ${packages.length}，不是恢复备份。\n\n${packageNames.map((n,i)=>'- '+(i===part?'**当前包：':'其他包：')+n+(i===part?'**':'')).join('\n')}\n\n每包带齐本包题目与图片，可独立阅读。全部包共同覆盖所选范围；重复图片可能在各包中各存一份。\n\n先读 [学习总览](01_学习总览.md) 与 [AI 分析任务](02_AI分析任务.md)，再读 statistics 和具体题目。AI 不一定支持 ZIP，必要时解压后上传 MD 与 images。\n\n## 统计口径\n\n全部正确率仅统计已答且有参考答案的次数；首次有效正确率使用全部历史中的首次可计分记录，已记得答案的首次记录另列；缺答案、未答不计错。首次标记先在全历史建立，再应用本次范围；若未导出更早的作答，这个标记仍保留历史判断。\n\n样本少于 10 为不足，10—29 为初步观察，30 以上可观察 95% 区间。没有预测分或排名。自评是考生自述，答对但猜测或犹豫不等同于稳定掌握。收藏为导出时状态，未记录的历史字段为未知。答案疑问不自行取消计分。\n\n## 完整性\n\n本包 ${pkg.rows.length} 次题目呈现，${selected.overall.answered} 次已作答，${grouped.size} 道去重题。缺题目 ${pkg.rows.filter(r=>!r.q).length} 次；旧笔迹重建预览 ${reconstructed} 次。历史无题目快照时采用当前题库并明确标注。删除的记录不在有效历史中，已被旧版 150 次上限裁掉且无备份的内容无法恢复。\n\n原始会话与逐次索引在 raw，原始手写坐标在 raw/annotations.json。manifest.json 提供文件 SHA-256 与缺失信息。导出不包含登录凭据。本包包含你主动填写的复盘，请按需要分享。\n\n## 题目索引\n\n${[...grouped].map(([id,a])=>'- ['+a[0].type+' / '+a[0].concept+' · '+id+'](questions/'+id+'.md)').join('\n')}\n`;
        await w.add('00_先读这里.md',intro);await w.add('01_学习总览.md',globalText+'\n---\n\n本包统计：\n\n'+partText);await w.add('02_AI分析任务.md',task);
        await w.add('statistics/overall.json',JSON.stringify({global:fullView.overall,part:selected.overall,filters,scope},null,2));for(const [name,groups] of [['modules',selected.modules],['question-types',selected.types],['concepts',selected.concepts]])await w.add('statistics/'+name+'.csv',csv(groups));
        await w.add('statistics/trends.csv','\ufeff周期,作答次数,正确次数,正确率,平均毫秒\n'+selected.trends.map(t=>[t.label,t.n,t.right,t.accuracy??'',t.meanMs??''].join(',')).join('\n'));
        await w.add('raw/question-versions.json',JSON.stringify(versions));
        await w.add('raw/question-content.json',JSON.stringify(Object.fromEntries([...grouped].map(([id,attempts])=>[id,attempts[0].q]))));
        await w.add('raw/sessions.json',JSON.stringify(portableSessions(pkg.rows)));await w.add('raw/question-index.json',JSON.stringify(indexRows(pkg.rows).map(r=>({...r,questionVersionId:versionIds.get(r.attemptId)}))));await w.add('raw/favorites.json',JSON.stringify({state:'导出时当前状态，历史事件未知',questions:[...grouped].map(([id,a])=>({contentId:id,favorite:a.some(r=>r.favorite),sources:a.map(r=>r.ref)}))}));await w.add('raw/annotations.json',JSON.stringify(annotations));
        const missing=pkg.rows.filter(r=>!r.q).map(r=>({attemptId:r.attemptId,kind:'question',sourceId:r.sourceId}));
        const {blob}=await w.finish({format:'xingce-ai-evidence',version:2,exportedAt:new Date().toISOString(),part:part+1,totalParts:packages.length,filters,scope,attempts:pkg.rows.length,contentQuestions:grouped.size,missing,imageSources:imageMap,reconstructedAnnotations:reconstructed,estimatedBytes:pkg.estimate,limitMB,identity:'SHA-256 full stem/material/ordered options/answer version/image content; unresolved images kept per source'});
        check(signal);onPackage({name:packageNames[part],blob});onProgress(part+1,packages.length,'已生成 '+(part+1)+' / '+packages.length+' 包');
      }finally{w.close();}
    }return {packages:packages.length,missingQuestions:rows.filter(r=>!r.q).length};
  }
  root.StudyReportExport={full,small,planPackages,portableSessions,indexRows,overview,csv,writer};
})(typeof window==='undefined'?globalThis:window);
