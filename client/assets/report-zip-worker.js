/* Incremental stored ZIP writer. No giant contiguous archive on the UI thread. */
'use strict';
const enc=new TextEncoder(),chunks=[],directory=[],files=[];let offset=0;
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=bytes=>{let crc=0xffffffff;for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;};
async function add(name,data){
  if(!/^[^\\]+$/.test(name)||name.startsWith('/')||name.split('/').includes('..'))throw new Error('Unsafe file path');
  const bytes=typeof data==='string'?enc.encode(data):new Uint8Array(data),n=enc.encode(name),crc=crc32(bytes);
  if(files.some(f=>f.path===name))throw new Error('Duplicate export path '+name);
  if(bytes.length+offset>=0xffffffff)throw new Error('单包超过 ZIP 容量，请减小分包大小');
  const head=new Uint8Array(30+n.length),h=new DataView(head.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint16(12,33,true);h.setUint32(14,crc,true);h.setUint32(18,bytes.length,true);h.setUint32(22,bytes.length,true);h.setUint16(26,n.length,true);head.set(n,30);
  const dir=new Uint8Array(46+n.length),d=new DataView(dir.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true);d.setUint32(16,crc,true);d.setUint32(20,bytes.length,true);d.setUint32(24,bytes.length,true);d.setUint16(28,n.length,true);d.setUint32(42,offset,true);dir.set(n,46);
  chunks.push(new Blob([head,bytes]));directory.push(dir);offset+=head.length+bytes.length;
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');files.push({path:name,bytes:bytes.length,sha256:digest,crc32:crc});
}
self.onmessage=async e=>{const {id,type,name,data,manifest}=e.data;try{
  if(type==='add'){await add(name,data);self.postMessage({id});return;}
  if(type==='finish'){
    await add('manifest.json',JSON.stringify({...manifest,files,manifestHashNote:'文件校验表不包含 manifest.json 自身'},null,2));
    if(files.length>65535)throw new Error('单包文件数过多，请减小分包大小');
    const size=directory.reduce((n,d)=>n+d.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);
    self.postMessage({id,blob:new Blob([...chunks,...directory,end],{type:'application/zip'})});
  }
}catch(error){self.postMessage({id,error:error.message});}};
