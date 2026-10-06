/* Portable exports, including file://. Image bytes arrive through lazy ordinary scripts. */
(function (root) {
  'use strict';
  const enc = new TextEncoder();
  const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const imagePaths = md => [...new Set([...md.matchAll(/!\[[^\]]*\]\((assets\/img\/[^)]+)\)/g)].map(m => m[1]))];
  function decode(value) {
    const s = atob(value); return Uint8Array.from(s, c => c.charCodeAt(0));
  }
  let table;
  function crc32(bytes) {
    if (!table) table = Array.from({length:256}, (_, n) => {
      for (let i=0;i<8;i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
      return n >>> 0;
    });
    let crc = 0xffffffff;
    for (const b of bytes) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  // Stored ZIP: UTF-8 filenames, CRC and directory offsets; no compression dependency.
  function zip(files) {
    const chunks=[], dirs=[]; let offset=0, size=0;
    for (const file of files) {
      const name=enc.encode(file.name), bytes=typeof file.data==='string' ? enc.encode(file.data) : file.data;
      const crc=crc32(bytes), head=new Uint8Array(30+name.length), h=new DataView(head.buffer);
      h.setUint32(0,0x04034b50,true); h.setUint16(4,20,true); h.setUint16(6,0x800,true);
      h.setUint16(12,33,true); h.setUint32(14,crc,true); h.setUint32(18,bytes.length,true);
      h.setUint32(22,bytes.length,true); h.setUint16(26,name.length,true); head.set(name,30);
      const dir=new Uint8Array(46+name.length), d=new DataView(dir.buffer);
      d.setUint32(0,0x02014b50,true); d.setUint16(4,20,true); d.setUint16(6,20,true);
      d.setUint16(8,0x800,true); d.setUint16(14,33,true); d.setUint32(16,crc,true);
      d.setUint32(20,bytes.length,true); d.setUint32(24,bytes.length,true); d.setUint16(28,name.length,true);
      d.setUint32(42,offset,true); dir.set(name,46);
      chunks.push(head,bytes); dirs.push(dir); offset+=head.length+bytes.length; size+=dir.length;
    }
    const end=new Uint8Array(22), e=new DataView(end.buffer);
    e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true);
    e.setUint32(12,size,true); e.setUint32(16,offset,true);
    const out=new Uint8Array(offset+size+22); let pos=0;
    for(const chunk of [...chunks,...dirs,end]) {out.set(chunk,pos);pos+=chunk.length;}
    return out;
  }
  async function images(md, loadScript) {
    const paths=imagePaths(md); if(!paths.length) return {};
    if(root.CloudSync && /^https?:$/.test(root.location?.protocol||'')) {
      // Hosted builds read the original same-origin images; no duplicate base64 packs.
      const out={};
      for(const path of paths) {
        const response=await fetch(path,{credentials:'same-origin',cache:'force-cache'});
        if(!response.ok||response.headers.get('content-type')?.includes('text/html'))
          throw new Error('图片读取失败，请重新登录后重试：'+path);
        const bytes=new Uint8Array(await response.arrayBuffer());
        let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        out[path]=btoa(binary);
      }
      return out;
    }
    if(!root.QB_EXPORT_IMAGE_INDEX) await loadScript('data/export-images/index.js');
    const index=root.QB_EXPORT_IMAGE_INDEX;
    for(const path of paths) if(!index[path]) throw new Error('图片导出索引缺失：'+path);
    const packs=[...new Set(paths.map(path=>index[path]))];
    for(const pack of packs) {
      if(!paths.filter(path=>index[path]===pack).every(path=>root.QB_EXPORT_IMAGES?.[path]))
        await loadScript('data/export-images/'+pack+'.js');
    }
    return Object.fromEntries(paths.map(path=>{
      const data=root.QB_EXPORT_IMAGES?.[path];
      if(!data) throw new Error('图片数据缺失：'+path);
      return [path,data];
    }));
  }
  function markdownHtml(md, images={}) {
    function inline(text) {
      return escape(text).replace(/!\[([^\]]*)\]\((assets\/img\/[^)]+)\)/g, (_,alt,path)=>{
        if(!images[path]) throw new Error('图片未打包：'+path);
        const ext=path.split('.').pop().toLowerCase();
        const mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',svg:'image/svg+xml',webp:'image/webp'}[ext]||'image/png';
        return '<img alt="'+alt+'" src="data:'+mime+';base64,'+images[path]+'">';
      }).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\x60([^\x60]+)\x60/g,'<code>$1</code>');
    }
    const out=[]; let inTable=false, list=false;
    function close(){if(inTable){out.push('</tbody></table>');inTable=false;}if(list){out.push('</ul>');list=false;}}
    for(const line of md.split('\n')){
      if(/^\|/.test(line)){
        if(list){out.push('</ul>');list=false;}
        if(/^\|[- :|]+\|$/.test(line))continue;
        const cells=line.slice(1,-1).split('|');
        if(!inTable){out.push('<table><tbody>');inTable=true;}
        out.push('<tr>'+cells.map(c=>'<td>'+inline(c.trim())+'</td>').join('')+'</tr>');continue;
      }
      if(inTable){out.push('</tbody></table>');inTable=false;}
      if(/^- /.test(line)){if(!list){out.push('<ul>');list=true;}out.push('<li>'+inline(line.slice(2))+'</li>');continue;}
      close();
      const heading=line.match(/^(#{1,6}) (.*)/);
      if(heading){out.push('<h'+heading[1].length+'>'+inline(heading[2])+'</h'+heading[1].length+'>');continue;}
      if(line==='---'){out.push('<hr>');continue;}
      if(/^>/.test(line)){out.push('<blockquote>'+inline(line.replace(/^> ?/,''))+'</blockquote>');continue;}
      if(line.trim())out.push('<p>'+inline(line)+'</p>');
    }
    close();return out.join('\n');
  }
  function documentHtml(md, images, title) {
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>'+escape(title)+'</title><style>'+
      'body{margin:0;background:#eaf0eb;color:#25362c;font:16px/1.8 "Microsoft YaHei",sans-serif}main{max-width:900px;margin:32px auto;padding:40px;background:#f5f7f3}h1{font-size:26px}h2{font-size:21px}h3{font-size:18px}p,li,blockquote{white-space:pre-wrap}img{max-width:100%;height:auto;vertical-align:middle}p img,li img{margin:6px 4px}table{border-collapse:collapse;width:100%;font-size:13px}td{border:1px solid #d6dfd5;padding:6px}blockquote{margin:4px 0;padding-left:16px;border-left:3px solid #bdd0c1}hr{border:0;border-top:1px solid #d6dfd5;margin:30px 0}.printbar{text-align:center;padding:16px}button{font:inherit;padding:8px 24px;cursor:pointer;background:#3d6552;color:#fff;border:0;border-radius:8px}code{overflow-wrap:anywhere}'+
      '@page{size:A4;margin:16mm}@media print{body,main{background:white}main{margin:0;padding:0;max-width:none}.printbar{display:none}h2,h3{break-after:avoid}img,tr{break-inside:avoid}table{font-size:9pt}body{font-size:11pt}h1{font-size:20px}h2{font-size:16px}h3{font-size:14px}}</style></head><body><div class="printbar"><button onclick="window.print()">打印 / 保存为 PDF</button></div><main>'+markdownHtml(md,images)+'</main></body></html>';
  }
  function questionDocument(questions, images, title) {
    const embed = html => String(html || '').replace(/src=["'](assets\/img\/[^"']+)["']/g, (_, path) => {
      if (!images[path]) throw new Error('打印图片未打包：' + path);
      const ext = path.split('.').pop().toLowerCase();
      const mime = {png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',svg:'image/svg+xml',webp:'image/webp'}[ext] || 'image/png';
      return 'src="data:' + mime + ';base64,' + images[path] + '"';
    });
    let previousType = '', previousMaterial = '';
    const body = questions.map((q, i) => {
      const type = q.type || '未分类';
      const heading = type !== previousType ? '<h2>' + escape(type) + '</h2>' : '';
      const material = q.material && (q.material !== previousMaterial || heading)
        ? '<section class="material"><h3>材料</h3>' + embed(q.material) + '</section>' : '';
      // 部分图形题的选项已印在题干图片里，源数据仅用 A/B/C/D 占位。
      const imageOptions = /<img\b/i.test(q.stem) && q.options.length > 0 && q.options.every(o =>
        String(o.t).replace(/<[^>]*>/g, '').trim() === o.k);
      previousType = type; previousMaterial = q.material;
      return heading + material + '<article class="question"><div class="stem"><b class="number">' + (i + 1) + '.</b><div>' +
        embed(q.stem) + '</div></div>' + (imageOptions ? '' : '<div class="options">' + q.options.map(o =>
          '<div class="option"><b>' + escape(o.k) + '.</b><div>' + embed(o.t) + '</div></div>').join('') + '</div>') + '</article>';
    }).join('\n');
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(title) +
      '</title><style>body{margin:0;background:#eaf0eb;color:#25362c;font:17px/1.85 "SimSun","Songti SC",serif}main{max-width:760px;margin:24px auto;padding:40px;background:#f5f7f3}h1{text-align:center;font-size:24px;line-height:1.6}h2{font:700 22px/1.6 "Microsoft YaHei",sans-serif;border-bottom:2px solid #3d6552;padding-bottom:8px;margin:30px 0 18px;break-after:avoid}h3{font-size:16px;margin:0 0 8px;break-after:avoid}.sheet-info{display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between;font-size:15px;padding:14px 0;border-bottom:1px solid #bfcdbf}.material{margin:12px 0 22px}.question{margin:22px 0 30px}.stem,.option{display:flex;gap:8px}.stem>div,.option>div{flex:1;min-width:0}.stem{break-inside:avoid}.number{min-width:24px}.options{margin:12px 0 0 32px}.option{margin:8px 0;break-inside:avoid}p{margin:4px 0 10px}img{max-width:100%;height:auto;vertical-align:middle;break-inside:avoid}img.tex{max-height:1.6em;width:auto}.exam-blank{display:inline-block;min-width:4em;border-bottom:1px solid currentColor;height:1em;vertical-align:baseline}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #777;padding:4px}tr{break-inside:avoid}.printbar{text-align:center;padding:16px;font:16px/1.6 "Microsoft YaHei",sans-serif}.printbar button{font:inherit;background:#3d6552;color:white;border:0;border-radius:8px;padding:10px 24px;cursor:pointer}@page{size:A4;margin:16mm}@media(max-width:800px){main{padding:20px;margin:0}.options{margin-left:20px}}@media print{body,main{background:white;color:black}body{font-size:12pt;line-height:1.8}main{padding:0;margin:0;max-width:none}.printbar{display:none}h1{font-size:18pt}h2{font-size:16pt;border-color:#333}.sheet-info{font-size:10pt}.question{margin:18px 0 26px}img{max-height:230mm}a{color:inherit;text-decoration:none}}</style></head><body><div class="printbar"><button onclick="window.print()">打印 / 保存为 PDF</button></div><main><h1>' +
      escape(title.replace(/_空白试题$/, '')) + '</h1><div class="sheet-info"><span>共 ' + questions.length + ' 题</span><span>姓名：____________</span><span>日期：____________</span></div>' + body + '</main></body></html>';
  }
  const api={imagePaths,decode,crc32,zip,images,markdownHtml,documentHtml,questionDocument};
  root.ExportTools=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
