import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const exportSource=fs.readFileSync('client/assets/export-tools.js','utf8');
const documentSource=fs.readFileSync('client/assets/document-export.js','utf8');
const fontSource=fs.readFileSync('client/assets/vendor/pdf-font-coverage.js','utf8');
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
const pdf=sandbox({document:{fonts:{add(){}},createElement:()=>({getContext:()=>({measureText:()=>({width:12})})})},
  DOMParser:class{parseFromString(){return {body:{childNodes:[]}};}}});
vm.runInNewContext(exportSource,pdf.box);vm.runInNewContext(fontSource,pdf.box);
let builds=0,rejectNext=false;const definitions=[];
pdf.root.pdfMake={fonts:{},addVirtualFileSystem(){},createPdf(def,layout,fonts,vfs){
  assert.equal(Object.keys(fonts).length,1);
  for(const file of Object.values(fonts[def.defaultStyle.font]))assert.ok(vfs[file],'each export must bind its own font bytes');
  if(rejectNext){rejectNext=false;throw new Error('generation failed');}
  builds++;definitions.push(def);return {getStream(){const events={};return {
    on(name,fn){events[name]=fn;},end(){setTimeout(()=>{events.data(new Uint8Array([builds]));events.end();},0);}};}};
}};
const loads=[];
const loader=async src=>{loads.push(src);const data={'Exam-Regular.woff':'test-normal','Exam-Bold.woff':'test-bold'};
  if(src.endsWith('pdf-fonts-lite.js'))pdf.root.QB_PDF_LITE_FONTS=data;else pdf.root.QB_PDF_FONTS=data;};
vm.runInNewContext(documentSource,pdf.box);
const docs=[{title:'行测练习',questions:[{type:'逻辑判断',stem:'题目',options:[],result:{reflection:'复盘',favorite:false}}]}];
const a=pdf.root.DocumentExport.pdf(docs,{},loader),b=pdf.root.DocumentExport.pdf(docs,{},loader);
assert.equal(a,b);await a;
await pdf.root.DocumentExport.pdf(docs,{},loader);assert.equal(builds,1);
assert.deepEqual(loads,['assets/vendor/pdf-fonts-lite.js']);
docs[0].questions[0].result.reflection='修改复盘';await pdf.root.DocumentExport.pdf(docs,{},loader);
docs[0].questions[0].result.favorite=true;await pdf.root.DocumentExport.pdf(docs,{},loader);
assert.equal(builds,3,'exported assessment changes must invalidate cache');
const changed=[{title:'失败重试',questions:[]}];rejectNext=true;
await assert.rejects(pdf.root.DocumentExport.pdf(changed,{},loader),/generation failed/);
await pdf.root.DocumentExport.pdf(changed,{},loader);assert.equal(builds,4);
const inRanges=(cp,ranges)=>{let lo=0,hi=ranges.length-1;
  while(lo<=hi){const mid=(lo+hi)>>1,[a,b]=ranges[mid];if(cp<a)hi=mid-1;else if(cp>b)lo=mid+1;else return true;}return false;};
const coverage=pdf.root.QB_PDF_FONT_COVERAGE;
const rare=coverage.full.flatMap(([a,b])=>[a,b]).find(cp=>!inRanges(cp,coverage.subset));
assert.ok(rare);await pdf.root.DocumentExport.pdf([{title:String.fromCodePoint(rare),questions:[]}],{},loader);
assert.equal(definitions.at(-1).defaultStyle.font,'ExamFull');assert.equal(loads.at(-1),'assets/vendor/pdf-fonts.js');
await pdf.root.DocumentExport.pdf([{title:'常用字',questions:[]}],{},loader);
assert.equal(definitions.at(-1).defaultStyle.font,'ExamLite');
// The subset must start downloading before the PDF library finishes loading.
const parallel=sandbox();vm.runInNewContext(fontSource,parallel.box);vm.runInNewContext(documentSource,parallel.box);
const parallelLoads=[];let finishLibrary;
const preparing=parallel.root.DocumentExport.preparePdf([{title:'练习',questions:[]}],async src=>{
  parallelLoads.push(src);
  if(src.endsWith('pdfmake.min.js'))await new Promise(resolve=>finishLibrary=()=>{parallel.root.pdfMake={fonts:{}};resolve();});
  else if(src.endsWith('pdf-fonts-lite.js'))parallel.root.QB_PDF_LITE_FONTS={'Exam-Regular.woff':'test-normal','Exam-Bold.woff':'test-bold'};
});
await tick();assert.ok(parallelLoads.includes('assets/vendor/pdf-fonts-lite.js'));finishLibrary();await preparing;
// Every existing bank character supported by the original font must be retained.
const missing=new Set();
for(const directory of ['client/data/papers','client/data/pools','client/assets']) {
  for(const file of fs.readdirSync(directory).filter(f=>f.endsWith('.js'))) {
    const text=fs.readFileSync(directory+'/'+file,'utf8').replace(/\\u([0-9a-fA-F]{4})/g,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
    for(const char of new Set(text)) {const cp=char.codePointAt(0);if(inRanges(cp,coverage.full)&&!inRanges(cp,coverage.subset))missing.add(char);}
  }
}
assert.equal(missing.size,0,`Regenerate PDF fonts: ${[...missing].slice(0,20).join('')}`);
assert.ok(fs.statSync('client/assets/vendor/pdf-fonts-lite.js').size<5*1024*1024);
console.log('PDF cache invalidation, font coverage/fallback, parallel images and offline export passed');
