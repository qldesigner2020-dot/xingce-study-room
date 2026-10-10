import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const exportSource=fs.readFileSync('client/assets/export-tools.js','utf8');
const documentSource=fs.readFileSync('client/assets/document-export.js','utf8');
const fontSource=fs.readFileSync('client/assets/pdf-text-layer.js','utf8');
function sandbox(extra={}) {
  const root={};const box={window:root,TextEncoder,Uint8Array,DataView,atob,btoa,setTimeout,clearTimeout,...extra};
  return {root,box};
}
const tick=()=>new Promise(r=>setImmediate(r));
// Hosted images: four concurrent requests, shared pending reads, retry failures.
const {root,box}=sandbox();root.CloudSync={};root.location={protocol:'https:'};
const calls=[],pending=[];
box.fetch=path=>{calls.push(path);return new Promise(resolve=>pending.push({path,resolve}));};
vm.runInNewContext(exportSource,box);
const md=Array.from({length:6},(_,i)=>`![](assets/img/${i}.png)`).join('\n');
const first=root.ExportTools.images(md),duplicate=root.ExportTools.images('![](assets/img/0.png)');
assert.equal(calls.length,4);
function finish(request,ok=true) {request.resolve({ok,headers:{get:()=> 'image/png'},arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer});}
pending.splice(0,4).forEach(r=>finish(r));await tick();
assert.equal(calls.length,6);pending.splice(0).forEach(r=>finish(r));
assert.equal(Object.keys(await first).length,6);await duplicate;
await root.ExportTools.images(md);assert.equal(calls.length,6);
const fail=root.ExportTools.images('![](assets/img/retry.png)');finish(pending.shift(),false);
await assert.rejects(fail,/图片读取失败/);
const retry=root.ExportTools.images('![](assets/img/retry.png)');finish(pending.shift());await retry;
assert.equal(calls.filter(p=>p.endsWith('retry.png')).length,2);
// file:// still uses ordinary image-pack scripts.
const offline=sandbox();offline.root.location={protocol:'file:'};vm.runInNewContext(exportSource,offline.box);
const scripts=[];
await offline.root.ExportTools.images('![](assets/img/a.png)',async src=>{
  scripts.push(src);
  if(src.endsWith('index.js'))offline.root.QB_EXPORT_IMAGE_INDEX={'assets/img/a.png':'pack'};
  else offline.root.QB_EXPORT_IMAGES={'assets/img/a.png':'AQID'};
});
assert.deepEqual(scripts,['data/export-images/index.js','data/export-images/pack.js']);
const bitmapPaints=[],bitmapDraws=[];
const context={measureText:text=>({width:text.length*64}),fillText:text=>bitmapPaints.push(text)};
const pdf=sandbox({document:{createElement:()=>({getContext:()=>context,toDataURL:()=> 'data:image/png;base64,'+btoa(bitmapPaints.at(-1)||'')})},
  DOMParser:class{parseFromString(){return {body:{childNodes:[]}};}}});
vm.runInNewContext(exportSource,pdf.box);vm.runInNewContext(fontSource,pdf.box);
let builds=0,rejectNext=false,renderPages=[];const definitions=[];
pdf.root.pdfMake={fonts:{},addVirtualFileSystem(){},createPdf(def,layout,fonts,vfs){
  assert.equal(Object.keys(fonts).length,1);
  for(const file of Object.values(fonts[def.defaultStyle.font]))assert.ok(vfs[file],'each export must bind its own font bytes');
  if(rejectNext){rejectNext=false;throw new Error('generation failed');}
  builds++;definitions.push(def);return {getStream(){const events={};return {_pdfMakePages:renderPages,
    switchToPage(){},save(){return this;},opacity(){return this;},restore(){return this;},image(uri){bitmapDraws.push(uri);return this;},
    on(name,fn){events[name]=fn;},end(){setTimeout(()=>{events.data(new Uint8Array([builds]));events.end();},0);}};}};
}};
const loads=[];
const loader=async src=>{loads.push(src);throw new Error('Unexpected resource download: '+src);};
vm.runInNewContext(documentSource,pdf.box);
const docs=[{title:'行测练习',questions:[{type:'逻辑判断',stem:'题目',options:[],result:{reflection:'复盘',favorite:false}}]}];
const sharedMaterial=[{title:'资料专项',questions:[
  {type:'增长',material:'同一份统计材料',stem:'第一题',options:[],specialty:'增长率计算',source:'海南 2026 <回忆版>'},
  {type:'比重',material:'同一份统计材料',stem:'第二题',options:[],specialty:'现期比重'}]}];
const sharedHtml=pdf.root.DocumentExport.html(sharedMaterial,{},'资料专项');
assert.equal((sharedHtml.match(/同一份统计材料/g)||[]).length,1,'adjacent questions share a passage across type headings');
assert.ok(sharedHtml.includes('专项考点：增长率计算'));
assert.ok(sharedHtml.includes('海南 2026 &lt;回忆版&gt;'),'source metadata is escaped and retained');
const a=pdf.root.DocumentExport.pdf(docs,{},loader),b=pdf.root.DocumentExport.pdf(docs,{},loader);
assert.equal(a,b);await a;
await pdf.root.DocumentExport.pdf(docs,{},loader);assert.equal(builds,1);
assert.deepEqual(loads,[],'system-font export must not download a font');
docs[0].questions[0].result.reflection='修改复盘';await pdf.root.DocumentExport.pdf(docs,{},loader);
docs[0].questions[0].result.favorite=true;await pdf.root.DocumentExport.pdf(docs,{},loader);
assert.equal(builds,3,'exported assessment changes must invalidate cache');
const changed=[{title:'失败重试',questions:[]}];rejectNext=true;
await assert.rejects(pdf.root.DocumentExport.pdf(changed,{},loader),/generation failed/);
await pdf.root.DocumentExport.pdf(changed,{},loader);assert.equal(builds,4);
await pdf.root.DocumentExport.pdf([{title:'少见字丂与表情😀',questions:[]}],{},loader);
assert.equal(definitions.at(-1).defaultStyle.font,'TextLayer');assert.deepEqual(loads,[]);
assert.ok(!documentSource.includes('FontFace'),'do not install or fetch a CJK typeface');
assert.ok(!documentSource.includes('pdf-fonts.js'));
assert.ok(fs.statSync('client/assets/pdf-text-layer.js').size<20*1024);
renderPages=[{items:[{type:'line',item:{x:10,y:20,getAscenderHeight:()=>14,
  inlines:[{text:'AA',width:24,fontSize:12,x:0,font:{name:'PDFTextMap'},color:'#202720'}]}}]}];
await pdf.root.DocumentExport.pdf([{title:'字形复用验证',questions:[]}],{},loader);
assert.deepEqual(bitmapPaints,['A'],'repeated letters must share one native-font bitmap');
assert.equal(bitmapDraws.length,2);
await pdf.root.DocumentExport.pdf(sharedMaterial,{},loader);
const questionBlock=definitions.at(-1).content.find(b=>b.stack?.some(n=>n.text==='专项考点：增长率计算'));
assert.ok(questionBlock?.unbreakable,'metadata and stem must stay in the same page block');
assert.ok(questionBlock.stack.some(n=>n.text==='真题来源：海南 2026 <回忆版>'));
assert.ok(questionBlock.stack.some(n=>n.columns),'the kept block contains the question stem');
console.log('PDF system fonts, cache invalidation, parallel images and offline export passed');
