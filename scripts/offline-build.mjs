import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';

export function buildOffline(dist) {
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
  const files=walk(dist).map(p=>path.relative(dist,p).replaceAll('\\','/')).filter(p=>
    p!=='sw.js'&&p!=='offline-manifest.json'&&p!=='.nojekyll'&&!/assets\/vendor\/(pdf-font|NotoSerif)/.test(p));
  const resources=files.sort().map(url=>{
    const bytes=fs.readFileSync(path.join(dist,url));
    return {url,bytes:bytes.length,integrity:'sha256-'+crypto.createHash('sha256').update(bytes).digest('base64'),
      group:/^(data\/(papers|pools)\/(?!index)|assets\/img\/)/.test(url)?'data':'core'};
  });
  const available=new Set(files),context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(dist,'data/catalog.js'),'utf8'),context);
  const papers=context.window.QB_CATALOG.papers.map(p=>{
    const url=`data/papers/${p.id}.js`,ctx={window:{}};
    vm.runInNewContext(fs.readFileSync(path.join(dist,url),'utf8'),ctx);
    const text=JSON.stringify(ctx.window.QB_PAPERS[p.id]);
    const images=[...new Set([...text.matchAll(/assets\/img\/[^\s"\\<>]+/g)].map(m=>m[0]))];
    for(const image of images)if(!available.has(image))throw new Error('Offline image missing: '+image);
    return {id:p.id,name:p.name,year:p.year,files:[url,...images]};
  });
  const version=crypto.createHash('sha256').update(JSON.stringify(resources)).update(fs.readFileSync(path.join(dist,'sw.js'))).digest('hex').slice(0,20);
  const manifest={version,files:resources,papers,questions:context.window.QB_CATALOG.papers.reduce((n,p)=>n+p.count,0)};
  const source=fs.readFileSync(path.join(dist,'sw.js'),'utf8');
  fs.writeFileSync(path.join(dist,'sw.js'),source.replace('/* OFFLINE_PACKAGE */ null',JSON.stringify(manifest)));
  fs.writeFileSync(path.join(dist,'offline-manifest.json'),JSON.stringify(manifest));
  console.log(`Offline package: ${papers.length} papers, ${resources.length} files, ${(resources.reduce((n,f)=>n+f.bytes,0)/1048576).toFixed(1)} MB; no downloaded fonts`);
  return manifest;
}
