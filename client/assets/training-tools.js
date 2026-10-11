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
  function allocateExam(ids,capacities,weights,total,random){
    if(!random)return allocate(ids,capacities,weights,total);
    const targets={},out=Object.fromEntries(ids.map(id=>[id,0]));
    let eligible=ids.filter(id=>capacities[id]>0),left=Math.min(Math.max(0,Math.floor(total||0)),eligible.reduce((s,id)=>s+capacities[id],0));
    // Cap continuous shares first, then round with one random offset. Each
    // uncapped share rounds to floor or ceil, with its fractional probability.
    while(eligible.length){
      let sum=eligible.reduce((s,id)=>s+Math.max(0,weights[id]||0),0),equal=!sum;if(equal)sum=eligible.length;
      const shares=Object.fromEntries(eligible.map(id=>[id,left*(equal?1:Math.max(0,weights[id]||0))/sum]));
      const capped=eligible.filter(id=>shares[id]>=capacities[id]);
      if(!capped.length){Object.assign(targets,shares);break;}
      for(const id of capped){targets[id]=capacities[id];left-=capacities[id];}
      eligible=eligible.filter(id=>!capped.includes(id));
    }
    let cumulative=0;const offset=random();
    for(const id of shuffled(ids,random)){
      const target=targets[id]||0,base=Math.floor(target),before=Math.floor(cumulative+offset);
      cumulative+=target-base;
      out[id]=base+Math.floor(cumulative+offset)-before;
    }
    return out;
  }
  function paperExam(paper){
    const aliases={national:'national',provincial:'provincial',institution:'institution','国考':'national','省考':'provincial','事业编':'institution','事业单位':'institution'};
    const name=String(paper.name||'').normalize('NFKC');
    const type=aliases[paper.examType]||(/事业单位|事业编|职业能力倾向测验|职测/.test(name)?'institution':paper.region==='国考'||/国家公务员|中央机关/.test(name)?'national':'provincial');
    // A provincial A/B paper is not an institution A/B/C category.
    const raw=String(paper.examClass||'').normalize('NFKC').toUpperCase().replace(/类$/,'');
    const examClass=type==='institution'?(/^[ABC]$/.test(raw)?raw:(name.match(/([ABC])\s*类/i)?.[1]||'').toUpperCase()):'';
    return {examType:type,examClass};
  }
  function examLabel(type,examClass=''){
    return ({national:'国考',provincial:'省考',institution:'事业编'}[type]||'全部考试')+(type==='institution'&&/^[ABC]$/.test(examClass)?' '+examClass+'类':'');
  }
  function paperMatches(paper,options={}){
    const exam=paperExam(paper),years=new Set(options.years||[]);
    return (!options.examType||exam.examType===options.examType)&&
      (options.examType!=='institution'||!options.examClass||exam.examClass===options.examClass)&&
      (!options.year||String(paper.year)===String(options.year))&&(!years.size||years.has(String(paper.year)))&&
      (!options.region||paper.region===options.region);
  }
  function scope(index,catalog,options){
    const papers=catalog.papers.filter(p=>paperMatches(p,options));
    const ids=new Set(papers.map(p=>p.id)),buckets={},counts={},weights={},qualifierSets={},facetSets={};
    const leafGroups=new Map(index.groups.flatMap(g=>g.leaves.map(t=>[t.id,g.id])));
    const kinds={auxiliary:'辅助考点',method:'解题方法',form:'题面形式'};
    for(const r of index.records){
      const source=r.src.filter(s=>ids.has(s[0]));if(!source.length)continue;
      for(const qualifier of r.filters||[])(qualifierSets[qualifier]||=new Set()).add(r.qid);
      const group=leafGroups.get(r.leaf),filters=options.groupFilters?.[group]||{},labels=new Set(r.filters||[]);
      // Facet choices count candidates with the other two conditions applied.
      // A blank-count filter belongs to its group, never to the whole exercise.
      for(const [field,kind] of Object.entries(kinds)){
        if(Object.keys(kinds).some(other=>other!==field&&filters[other]&&!labels.has(filters[other])))continue;
        for(const id of labels)if(id.startsWith(kind+'::')){
          const choices=((facetSets[group]||={})[field]||={});(choices[id]||=new Set()).add(r.qid);
        }
      }
      if(options.qualifier&&!(r.filters||[]).includes(options.qualifier))continue;
      if(Object.keys(kinds).some(field=>filters[field]&&!labels.has(filters[field])))continue;
      (buckets[r.leaf]||=[]).push({...r,src:source});weights[r.leaf]=(weights[r.leaf]||0)+source.length;
    }
    for(const [leaf,records] of Object.entries(buckets))counts[leaf]=new Set(records.map(r=>r.qid)).size;
    const facetCounts=Object.fromEntries(Object.entries(facetSets).map(([g,fields])=>[g,Object.fromEntries(Object.entries(fields).map(([field,choices])=>[field,Object.fromEntries(Object.entries(choices).map(([id,qs])=>[id,qs.size]))]))]));
    return {papers,buckets,counts,weights,facetCounts,qualifierCounts:Object.fromEntries(Object.entries(qualifierSets).map(([k,v])=>[k,v.size])),uniqueCount:new Set(Object.values(buckets).flat().map(r=>r.qid)).size};
  }
  function plan(index,catalog,options){
    const automatic=options.workflow==='exam',modules=new Set(options.selectedModules||[]);
    // Automatic practice never inherits hidden filters from focused practice.
    const info=scope(index,catalog,automatic?{...options,groupFilters:{},qualifier:''}:options);
    const selected=new Set(automatic?index.groups.filter(g=>modules.has(g.module)).flatMap(g=>g.leaves.map(t=>t.id)):options.selected||[]);
    const groups=index.groups.filter(g=>g.leaves.some(t=>selected.has(t.id))),ids=groups.flatMap(g=>g.leaves.map(t=>t.id)).filter(id=>selected.has(id));
    const used=new Set(),capacities={},buckets={};
    // Answer storage is keyed by qid. Even recalled variants cannot occur twice
    // in one exercise, or answering one would accidentally answer the other.
    for(const id of ids){buckets[id]=(info.buckets[id]||[]).filter(r=>{if(used.has(r.qid))return false;used.add(r.qid);return true;});capacities[id]=buckets[id].length;}
    const groupCapacity={},groupWeights={},moduleCapacity={},moduleWeights={};
    for(const g of groups){
      const leaves=g.leaves.filter(t=>selected.has(t.id));
      groupCapacity[g.id]=leaves.reduce((s,t)=>s+capacities[t.id],0);
      groupWeights[g.id]=leaves.reduce((s,t)=>s+(info.weights[t.id]||0),0);
      moduleCapacity[g.module]=(moduleCapacity[g.module]||0)+groupCapacity[g.id];
      moduleWeights[g.module]=(moduleWeights[g.module]||0)+groupWeights[g.id];
    }
    let allocations={},groupAllocations={},moduleAllocations={};
    if(automatic){
      const random=Number.isFinite(options.allocationSeed)?rng(options.allocationSeed):null;
      moduleAllocations=allocateExam(Object.keys(moduleCapacity),moduleCapacity,moduleWeights,options.total,random);
      for(const module of Object.keys(moduleCapacity)){
        const children=groups.filter(g=>g.module===module);
        Object.assign(groupAllocations,allocateExam(children.map(g=>g.id),groupCapacity,groupWeights,moduleAllocations[module],random));
        for(const g of children)Object.assign(allocations,allocateExam(g.leaves.map(t=>t.id).filter(id=>selected.has(id)),capacities,info.weights,groupAllocations[g.id],random));
      }
    }else{
      allocations=allocate(ids,capacities,info.weights,options.total);
      for(const g of groups){
        groupAllocations[g.id]=g.leaves.reduce((s,t)=>s+(allocations[t.id]||0),0);
        moduleAllocations[g.module]=(moduleAllocations[g.module]||0)+groupAllocations[g.id];
      }
    }
    const basis=automatic?'按所选年份、地区的回忆版真题收录次数，先分配模块与题型，再按各题型内主考点的出现频率抽题；整数配额按比例小幅浮动，容量不足时在已选范围内补足':'按所选回忆版真题中匹配主考点与题型内筛选条件的出现次数分配；容量不足时在所选考点内补足';
    return {...info,ids,capacities,buckets,allocations,groupAllocations,moduleAllocations,basis,allocationSeed:options.allocationSeed,total:Object.values(allocations).reduce((a,b)=>a+b,0),max:used.size};
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
        picked.push({qid,src:'p',key:source[0],no:source[1],materialNo:source[2],type:r.t,leaf:id,classification:r.classification});
      }
    }
    const groupOf=new Map(index.groups.flatMap(g=>g.leaves.map(t=>[t.id,g])));
    const moduleOrder=catalog.modules,groupOrder=new Map(index.groups.map((g,i)=>[g.id,i])),groups=new Map();
    // Keep questions sharing a data passage together, with their source order.
    for(const ref of shuffled(picked,random)){
      const module=groupOf.get(ref.leaf).module;
      const key=module==='资料分析'&&ref.materialNo?module+'|'+ref.key+'|'+ref.materialNo:module+'|'+ref.qid;
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push({...ref,module,specialty:groupOf.get(ref.leaf).leaves.find(t=>t.id===ref.leaf).label});
    }
    const refs=[...groups.values()].sort((a,b)=>moduleOrder.indexOf(a[0].module)-moduleOrder.indexOf(b[0].module)||(a[0].module==='资料分析'?0:groupOrder.get(groupOf.get(a[0].leaf).id)-groupOrder.get(groupOf.get(b[0].leaf).id))).flatMap(a=>a[0].module==='资料分析'?a.sort((x,y)=>x.no-y.no):a);
    return {...result,refs,total:refs.length};
  }
  function migrateSelection(index,selected,qualifier=''){
    const valid=new Set(index.groups.flatMap(g=>g.leaves.map(t=>t.id))),out=new Set(),forms=[];
    for(const id of selected||[]){
      if(valid.has(id))out.add(id);
      else if(index.legacyLeaves?.[id]){for(const replacement of index.legacyLeaves[id])if(valid.has(replacement))out.add(replacement);}
      else if(/^逻辑填空::(?:单空填空|双空填空|三空及以上)$/.test(id)){
        index.groups.find(g=>g.id==='逻辑填空')?.leaves.forEach(t=>out.add(t.id));forms.push(id.split('::')[1]);
      }
    }
    if(qualifier&&!index.qualifiers?.some(q=>q.id===qualifier))qualifier='';
    if(forms.length===1&&!qualifier)qualifier=index.qualifiers?.find(q=>q.kind==='题面形式'&&q.group==='逻辑填空'&&q.label===forms[0])?.id||'';
    return {selected:[...out],qualifier};
  }
  function migratePreferences(index,prefs={}){
    const migrated=migrateSelection(index,prefs.selected,prefs.qualifier),groups=index.groups;
    const chosen=groups.filter(g=>g.leaves.some(t=>migrated.selected.includes(t.id)));
    const legacy=index.qualifiers?.find(q=>q.id===migrated.qualifier);
    const activeModule=groups.some(g=>g.module===prefs.activeModule)?prefs.activeModule:
      chosen[0]?.module||groups.find(g=>g.id===legacy?.group)?.module||'数量关系';
    const groupFilters={};
    const kindFields={'辅助考点':'auxiliary','解题方法':'method','题面形式':'form'};
    for(const group of groups){
      const filters={};
      for(const [field,id] of Object.entries(prefs.groupFilters?.[group.id]||{})){
        const qualifier=index.qualifiers?.find(q=>q.id===id&&kindFields[q.kind]===field);
        if(qualifier&&index.records.some(r=>group.leaves.some(t=>t.id===r.leaf)&&(r.filters||[]).includes(id)))filters[field]=id;
      }
      if(Object.keys(filters).length)groupFilters[group.id]=filters;
    }
    if(legacy){
      // Old global filters migrate only to compatible groups, including methods
      // used by several data-analysis groups. Other groups regain their questions.
      for(const group of groups)if(index.records.some(r=>group.leaves.some(t=>t.id===r.leaf)&&(r.filters||[]).includes(legacy.id))){
        if(group.id===legacy.group||chosen.includes(group))(groupFilters[group.id]||={})[kindFields[legacy.kind]]=legacy.id;
      }
    }
    const activeGroup=groups.find(g=>g.id===prefs.activeGroup&&g.module===activeModule)||
      groups.find(g=>g.id===legacy?.group&&g.module===activeModule)||chosen.find(g=>g.module===activeModule)||groups.find(g=>g.module===activeModule);
    const mode=prefs.mode==='combined'||(!prefs.mode&&chosen.length>1)?'combined':'single';
    let selected=migrated.selected;
    if(mode==='single'){
      selected=selected.filter(id=>activeGroup.leaves.some(t=>t.id===id));
      if(!selected.length&&!prefs.mode)selected=activeGroup.leaves.map(t=>t.id);
    }
    const validModules=new Set(groups.map(g=>g.module));
    const selectedModules=Array.isArray(prefs.selectedModules)?[...new Set(prefs.selectedModules.filter(m=>validModules.has(m)))]:
      chosen.length?[...new Set(chosen.map(g=>g.module))]:[validModules.has(prefs.activeModule)?prefs.activeModule:'判断推理'];
    const examType=['national','provincial','institution'].includes(prefs.examType)?prefs.examType:'';
    const examClass=examType==='institution'&&['A','B','C'].includes(prefs.examClass)?prefs.examClass:'';
    return {workflow:prefs.workflow==='targeted'?'targeted':'exam',selectedModules,examType,examClass,region:examType==='national'?'':prefs.region||'',mode,activeModule,activeGroup:activeGroup.id,selected,groupFilters,qualifier:''};
  }
  root.TrainingTools={allocate,paperExam,paperMatches,examLabel,scope,plan,sample,migrateSelection,migratePreferences};
})(typeof window==='object'?window:globalThis);
