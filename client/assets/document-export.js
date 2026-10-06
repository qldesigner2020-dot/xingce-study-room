/* Structured A4 exports. PDF contains searchable text and embedded image bytes. */
(function(root) {
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const plain=s=>String(s||'').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim();
  const imageOptions=q=>/<img\b/i.test(q.stem)&&q.options.length>0&&q.options.every(o=>plain(o.t)===o.k);
  const mime=p=>({jpg:'image/jpeg',jpeg:'image/jpeg',svg:'image/svg+xml',gif:'image/gif',webp:'image/webp'}[p.split('.').pop()]||'image/png');
  function imageUri(path,images) {
    if(!images[path])throw new Error('导出图片缺失：'+path);
    return 'data:'+mime(path)+';base64,'+images[path];
  }
  function embed(h,images) {
    return String(h||'').replace(/src=["'](assets\/img\/[^"']+)["']/g,(_,p)=>'src="'+imageUri(p,images)+'"');
  }
  function html(documents,images,title) {
    const body=documents.map((doc,di)=>{
      let type='',material='';
      const qs=doc.questions.map((q,i)=>{
        const heading=type!==q.type?'<h2>'+esc(q.type)+'</h2>':'';
        const mat=q.material&&(q.material!==material||heading)?'<section class="material"><h3>材料</h3>'+embed(q.material,images)+'</section>':'';
        type=q.type;material=q.material;
        const opts=imageOptions(q)?'':'<div class="options">'+q.options.map(o=>'<div class="option"><b>'+esc(o.k)+'.</b><div>'+embed(o.t,images)+'</div></div>').join('')+'</div>';
        const r=q.result;
        const review=r?'<section class="review"><div class="answer-line"><b>'+esc(r.state)+'</b><span>我的答案：'+esc(r.mine)+'</span><span>参考答案：'+esc(r.answer)+'</span><span>用时：'+esc(r.time)+'</span></div>'+
          '<p class="self-assessment">'+esc(r.familiarity)+' · '+esc(r.confidence)+'<br>'+esc(r.interpretation)+'</p>'+
          (r.excluded?'<p>曾排除选项：'+esc(r.excluded)+'</p>':'')+
          '<p>收藏：'+(r.favorite?'是':'否')+'　待复查：'+(r.flagged?'是':'否')+'</p>'+
          (r.note?'<div class="personal"><h3>我的草稿 / 思路</h3><p>'+esc(r.note)+'</p></div>':'')+
          (r.reflection?'<div class="personal"><h3>我的复盘描述</h3><p>'+esc(r.reflection)+'</p></div>':'')+
          (r.explanation?'<div class="explanation"><h3>参考解析</h3>'+embed(r.explanation,images)+'</div>':'')+'</section>':'';
        return heading+mat+'<article class="question"><div class="stem"><b class="number">'+(i+1)+'.</b><div>'+embed(q.stem,images)+'</div></div>'+opts+review+'</article>';
      }).join('');
      return '<section class="document'+(di?' next-document':'')+'"><h1>'+esc(doc.title)+'</h1>'+
        '<div class="sheet-info">'+(doc.report?'<span>复盘报告 · '+doc.questions.length+' 题</span><span>'+esc(doc.date||'')+'</span>':'<span>共 '+doc.questions.length+' 题</span><span>姓名：____________</span><span>日期：____________</span>')+'</div>'+
        (doc.summary?.length?'<div class="stats">'+doc.summary.map(s=>'<p>'+esc(s)+'</p>').join('')+'</div>':'')+qs+'</section>';
    }).join('');
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><style>'+
      'body{margin:0;background:#eaf0eb;color:#25362c;font:17px/1.85 "SimSun","Songti SC",serif}main{max-width:760px;margin:24px auto;padding:40px;background:#f5f7f3}h1{text-align:center;font:700 24px/1.6 "Microsoft YaHei",sans-serif}h2{font:700 22px/1.6 "Microsoft YaHei",sans-serif;margin:30px 0 18px;padding-bottom:8px;border-bottom:2px solid #3d6552;break-after:avoid}h3{font-size:16px;margin:0 0 8px;break-after:avoid}.sheet-info{display:flex;flex-wrap:wrap;justify-content:space-between;gap:14px;padding:14px 0;border-bottom:1px solid #bfcdbf;font-size:15px}.stats{padding:14px 0;border-bottom:1px solid #d6dfd5}.stats p{font-size:15px;margin:2px 0}.material{margin:16px 0 24px}.question{margin:22px 0 32px}.stem,.option{display:flex;gap:8px}.number{min-width:24px}.stem>div,.option>div{flex:1;min-width:0}.options{margin:12px 0 0 32px}.option{margin:8px 0;break-inside:avoid}p{margin:4px 0 10px}img{max-width:100%;height:auto;vertical-align:middle;break-inside:avoid}img.tex{max-height:1.6em;width:auto}.exam-blank{display:inline-block;min-width:4em;height:1em;border-bottom:1px solid;vertical-align:baseline}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #888;padding:4px}tr{break-inside:avoid}.review{margin:18px 0 0 32px;padding:16px 0 0;border-top:1px solid #bfcdbf;font-size:15px}.answer-line{display:flex;flex-wrap:wrap;gap:12px;font-weight:600}.self-assessment{margin-top:12px;color:#526359}.personal{margin-top:14px;padding-left:12px;border-left:2px solid #bfcdbf}.personal p{white-space:pre-wrap;overflow-wrap:anywhere}.explanation{margin-top:18px}.printbar{text-align:center;padding:16px;font:16px/1.6 "Microsoft YaHei",sans-serif}.printbar button{font:inherit;background:#3d6552;color:white;border:0;border-radius:8px;padding:10px 24px;cursor:pointer}.next-document{margin-top:50px;break-before:page}@page{size:A4;margin:17mm 16mm}@media(max-width:800px){main{margin:0;padding:20px}.options,.review{margin-left:20px}}@media print{body,main{background:white;color:black}body{font-size:12pt;line-height:1.8}main{padding:0;margin:0;max-width:none}.printbar{display:none}h1{font-size:18pt}h2{font-size:15pt;border-color:#333}h3{font-size:11pt}.sheet-info,.stats p,.review{font-size:10.5pt}.question{margin:18px 0 28px}img{max-height:230mm}.self-assessment{color:#333}}</style></head><body><div class="printbar"><button onclick="window.print()">打印</button></div><main>'+body+'</main></body></html>';
  }
  let ready;
  function loadPdf(loadScript) {
    if(!ready)ready=(async()=>{
      if(!root.pdfMake)await loadScript('assets/vendor/pdfmake.min.js');
      if(!root.QB_PDF_FONTS)await loadScript('assets/vendor/pdf-fonts.js');
      root.pdfMake.fonts={Exam:{normal:'Exam-Regular.woff',bold:'Exam-Bold.woff',italics:'Exam-Regular.woff',bolditalics:'Exam-Bold.woff'}};
      if(typeof FontFace!=='undefined') {
        const face=new FontFace('ExamPDF','url(data:font/woff;base64,'+root.QB_PDF_FONTS['Exam-Regular.woff']+')');
        await face.load();document.fonts.add(face);
      }
    })().catch(e=>{ready=null;throw e;});
    return ready;
  }
  async function pdf(documents,images,loadScript) {
    await loadPdf(loadScript);
    const imageInfo={};
    for(const path of Object.keys(images)) {
      const img=new Image();img.src=imageUri(path,images);
      await img.decode();
      let uri=img.src;
      if(!/\.(png|jpe?g)$/i.test(path)) {
        const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
        canvas.getContext('2d').drawImage(img,0,0);uri=canvas.toDataURL('image/png');
      }
      imageInfo[path]={uri,w:img.naturalWidth,h:img.naturalHeight};
    }
    const measuring=document.createElement('canvas').getContext('2d');
    function formulaLines(runs,fontSize) {
      // Equations are images, but surrounding text remains real PDF text on the same baseline.
      const lines=[];let pieces=[],width=0;
      const finish=()=>{if(!pieces.length)return;
        const groups=[];
        for(const p of pieces) {
          const last=groups[groups.length-1];
          if(p.text!==undefined&&last?.text!==undefined&&last.bold===p.bold&&last.decoration===p.decoration&&last.fontSize===p.fontSize) {
            last.text+=p.text;last.width+=p.width;
          }else groups.push({...p});
        }
        lines.push({columns:groups.map(p=>p.image?{width:p.width,image:p.image,height:p.height,margin:[0,1,0,0]}:
          {width:p.width+.5,text:p.text,bold:p.bold,decoration:p.decoration,fontSize:p.fontSize||fontSize}),
          columnGap:0,margin:[0,0,0,3]});pieces=[];width=0;
      };
      for(const run of runs) {
        const parts=run.image?[run]:[...run.text].map(char=>{
          measuring.font=(run.fontSize||fontSize)+'px "ExamPDF","SimSun",serif';
          return {...run,text:char,width:measuring.measureText(char).width*1.015};
        });
        for(const p of parts) {
          if(p.text==='\n'){finish();continue;}
          if(width+p.width>458&&pieces.length) {
            const last=pieces[pieces.length-1];
            const carry=/^[，。；：？！、）】》」』,.;!?)]$/.test(p.text||'')||/^[（【《「『(]$/.test(last.text||'')
              ?pieces.pop():null;
            finish();
            if(carry){pieces.push(carry);width=carry.width;}
          }
          if(!pieces.length&&p.text===' ')continue;
          pieces.push(p);width+=p.width;
        }
      }
      finish();return {stack:lines,margin:[0,0,0,5]};
    }
    function blocks(markup, fontSize=12) {
      const doc=new DOMParser().parseFromString(String(markup||''),'text/html');
      function walk(nodes,format={}) {
        const out=[];let text=[];
        function flush(){if(text.length){out.push(text.some(t=>t.image)?formulaLines(text,fontSize):{text,fontSize,margin:[0,0,0,5]});text=[];}}
        for(const n of nodes) {
          if(n.nodeType===3) {if(n.textContent)text.push({text:n.textContent,...format});continue;}
          if(n.nodeType!==1)continue;
          const tag=n.tagName.toLowerCase();
          if(['script','style'].includes(tag))continue;
          if(n.classList.contains('exam-blank')) {text.push({text:'________',...format});continue;}
          if(tag==='br') {text.push({text:'\n',...format});continue;}
          if(tag==='img') {
            const p=n.getAttribute('src'),im=imageInfo[p];if(!im)throw new Error('PDF 图片缺失：'+p);
            const formula=n.classList.contains('tex');
            const scale=formula?Math.min(fontSize*1.25/im.h,465/im.w):Math.min(.6,465/im.w,560/im.h);
            if(formula){text.push({image:im.uri,width:im.w*scale,height:im.h*scale});continue;}
            flush();
            out.push({image:im.uri,width:im.w*scale,height:im.h*scale,margin:[0,2,0,6]});continue;
          }
          if(tag==='table') {
            flush();const trs=[...n.querySelectorAll('tr')].filter(tr=>tr.closest('table')===n);
            const cols=Math.max(1,...trs.map(tr=>tr.children.length));
            out.push({table:{widths:Array(cols).fill('*'),body:trs.map(tr=>Array.from({length:cols},(_,i)=>({stack:tr.children[i]?walk(tr.children[i].childNodes):[{text:''}],margin:[3,3,3,3]})))},layout:'lightHorizontalLines',margin:[0,6,0,8],fontSize:10});continue;
          }
          const f={...format};
          if(['b','strong','th'].includes(tag))f.bold=true;
          if(tag==='u'||/underline/.test(n.style.textDecoration))f.decoration='underline';
          if(['sup','sub'].includes(tag))f.fontSize=fontSize*.75;
          if(['p','div','section','li','blockquote','h1','h2','h3'].includes(tag)) {
            flush();out.push(...walk(n.childNodes,f));
          } else {
            // Keep ordinary inline markup in a single wrapping paragraph.
            const inline=walk(n.childNodes,f);
            for(const item of inline) {
              if(item.text)text.push(...(Array.isArray(item.text)?item.text:[{text:item.text}]));
              else {flush();out.push(item);}
            }
          }
        }
        flush();return out;
      }
      return walk(doc.body.childNodes);
    }
    const content=[];
    documents.forEach((doc,di)=>{
      content.push({text:doc.title,style:'title',...(di?{pageBreak:'before'}:{})});
      content.push({text:doc.report?'复盘报告 · '+doc.questions.length+' 题　'+(doc.date||''):'共 '+doc.questions.length+' 题　　姓名：____________　日期：____________',style:'meta'});
      for(const s of doc.summary||[])content.push({text:s,style:'summary'});
      let type='',material='';
      doc.questions.forEach((q,i)=>{
        const newType=type!==q.type;
        if(newType)content.push({text:q.type,style:'type'});
        if(q.material&&(q.material!==material||newType)) {
          content.push({text:'材料',style:'label'});content.push(...blocks(q.material));
        }
        type=q.type;material=q.material;
        const stemBlocks=blocks(q.stem);
        const imageHeight=stemBlocks.reduce((n,b)=>n+(b.image?b.height+8:0),0);
        const estimatedHeight=Math.ceil(plain(q.stem).length/38)*20+imageHeight;
        content.push({columns:[{width:24,text:(i+1)+'.',bold:true},{width:'*',stack:stemBlocks}],
          unbreakable:estimatedHeight<620,margin:[0,10,0,4]});
        if(!imageOptions(q))for(const o of q.options)content.push({columns:[{width:22,text:o.k+'.',bold:true},{width:'*',stack:blocks(o.t)}],margin:[24,3,0,3]});
        const r=q.result;
        if(r) {
          content.push({text:r.state+'　我的答案：'+r.mine+'　参考答案：'+r.answer+'　用时：'+r.time,style:'result'});
          content.push({text:r.familiarity+' · '+r.confidence+'\n'+r.interpretation,style:'selfAssessment'});
          if(r.excluded)content.push({text:'曾排除选项：'+r.excluded,style:'selfAssessment'});
          content.push({text:'收藏：'+(r.favorite?'是':'否')+'　待复查：'+(r.flagged?'是':'否'),style:'selfAssessment'});
          for(const [label,value] of [['我的草稿 / 思路',r.note],['我的复盘描述',r.reflection]])if(value) {
            content.push({text:label,style:'label',margin:[24,12,0,5]},{text:value,fontSize:11,margin:[24,0,0,7]});
          }
          if(r.explanation)content.push({text:'参考解析',style:'label',margin:[24,12,0,5]},{stack:blocks(r.explanation,11),margin:[24,0,0,6]});
        }
        content.push({canvas:[{type:'line',x1:0,y1:0,x2:500,y2:0,lineWidth:.35,lineColor:'#c8d1c8'}],margin:[0,16,0,4]});
      });
    });
    const def={pageSize:'A4',pageMargins:[46,48,46,45],defaultStyle:{font:'Exam',fontSize:12,lineHeight:1.45,color:'#202720'},
      info:{title:documents.length===1?documents[0].title:'行测复盘报告',author:'行测练习室'},
      styles:{title:{fontSize:18,bold:true,alignment:'center',margin:[0,0,0,16]},meta:{fontSize:10,color:'#555f55',margin:[0,0,0,12]},
        summary:{fontSize:10.5,margin:[0,2,0,3]},type:{fontSize:15,bold:true,margin:[0,22,0,12]},label:{fontSize:11,bold:true,margin:[0,8,0,5]},
        result:{fontSize:10.5,bold:true,margin:[24,14,0,7]},selfAssessment:{fontSize:10.5,color:'#505b50',margin:[24,2,0,5]}},
      footer:(current,total)=>({text:current+' / '+total,alignment:'center',fontSize:9,color:'#626b62',margin:[0,10,0,0]}),
      pageBreakBefore:(node,following)=>!!node.style&&['type','label'].includes(node.style)&&following.length===0,
      content};
    return new Promise((resolve,reject)=>{
      try {root.pdfMake.createPdf(def).getBuffer(bytes=>resolve(bytes));}catch(e){reject(e);}
    });
  }
  const api={html,pdf,imageOptions};
  root.DocumentExport=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
