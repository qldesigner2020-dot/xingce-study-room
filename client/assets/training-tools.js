(function(root){
  'use strict';
  function rng(seed){let s=seed>>>0||1;return()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return(s>>>0)/4294967296;};}
  function shuffled(items,random){const a=items.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
  function allocate(ids,capacities,weights,total){
    const n=ids.map(id=>Math.max(0,capacities[id]||0)),out=ids.map(()=>0);
    let left=Math.min(Math.max(0,Math.floor(total||0)),n.reduce((a,b)=>a+b,0));
    while(left){
      const eligible=ids.map((id,i)=>({i,w:Math.max(0,weights[id]||0)})).filter(x=>out[x.i]<n[x.i]);
      if(!eligible.length)break;
      let sum=eligible.reduce((s,x)=>s+x.w,0);
      if(!sum){for(const x of eligible)x.w=1;sum=eligible.length;}
      const portions=eligible.map(x=>({...x,quota:left*x.w/sum}));let given=0;
      for(const x of portions){const take=Math.min(n[x.i]-out[x.i],Math.floor(x.quota));out[x.i]+=take;given+=take;}
      left-=given;
      for(const x of portions.sort((a,b)=>(b.quota%1)-(a.quota%1)||a.i-b.i)) {
        if(!left)break;if(out[x.i]<n[x.i]){out[x.i]++;left--;}
      }
    }
    return Object.fromEntries(ids.map((id,i)=>[id,out[i]]));
  }
  function scope(index,catalog,options){
    const years=new Set(options.years||[]),region=options.region||'';
    const papers=catalog.papers.filter(p=>(!years.size||years.has(String(p.year)))&&(!region||p.region===region));
    const ids=new Set(papers.map(p=>p.id)),buckets={},counts={},weights={};
    for(const r of index.records){
      const source=r.src.filter(s=>ids.has(s[0]));if(!source.length)continue;
      (buckets[r.leaf]||=[]).push({...r,src:source});weights[r.leaf]=(weights[r.leaf]||0)+source.length;
    }
    for(const [leaf,records] of Object.entries(buckets))counts[leaf]=new Set(records.map(r=>r.qid)).size;
    return {papers,buckets,counts,weights,uniqueCount:new Set(Object.values(buckets).flat().map(r=>r.qid)).size};
  }
  function plan(index,catalog,options){
    const info=scope(index,catalog,options),selected=new Set(options.selected||[]),ids=index.groups.flatMap(g=>g.leaves.map(t=>t.id)).filter(id=>selected.has(id));
    const used=new Set(),capacities={},buckets={};
    // Answer storage is keyed by qid. Even recalled variants cannot occur twice
    // in one exercise, or answering one would accidentally answer the other.
    for(const id of ids){buckets[id]=(info.buckets[id]||[]).filter(r=>{if(used.has(r.qid))return false;used.add(r.qid);return true;});capacities[id]=buckets[id].length;}
    const allocations=allocate(ids,capacities,info.weights,options.total);
    return {...info,ids,capacities,buckets,allocations,total:Object.values(allocations).reduce((a,b)=>a+b,0),max:used.size};
  }
  function sample(index,catalog,options,seed,seen=new Set()){
    const result=plan(index,catalog,options),random=rng(seed),picked=[],used=new Set();
    for(const id of result.ids){
      const records=shuffled(result.buckets[id],random);
      if(options.preferUnseen)records.sort((a,b)=>Number(a.src.some(s=>seen.has(s[3]||a.qid)))-Number(b.src.some(s=>seen.has(s[3]||b.qid))));
      let wanted=result.allocations[id];
      for(const r of records){
        if(!wanted)break;
        const sources=r.src.filter(s=>!used.has(s[3]||r.qid));if(!sources.length)continue;
        const source=sources[Math.floor(random()*sources.length)],qid=source[3]||r.qid;
        used.add(qid);wanted--;
        picked.push({qid,src:'p',key:source[0],no:source[1],materialNo:source[2],type:r.t,leaf:id});
      }
    }
    const groupOf=new Map(index.groups.flatMap(g=>g.leaves.map(t=>[t.id,g])));
    const moduleOrder=catalog.modules,groups=new Map();
    // Keep questions sharing a data passage together, with their source order.
    for(const ref of shuffled(picked,random)){
      const module=groupOf.get(ref.leaf).module;
      const key=module==='资料分析'&&ref.materialNo?module+'|'+ref.key+'|'+ref.materialNo:module+'|'+ref.qid;
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push({...ref,module,specialty:groupOf.get(ref.leaf).leaves.find(t=>t.id===ref.leaf).label});
    }
    const refs=[...groups.values()].sort((a,b)=>moduleOrder.indexOf(a[0].module)-moduleOrder.indexOf(b[0].module)).flatMap(a=>a[0].module==='资料分析'?a.sort((x,y)=>x.no-y.no):a);
    return {...result,refs,total:refs.length};
  }
  root.TrainingTools={allocate,scope,plan,sample};
})(typeof window==='object'?window:globalThis);
