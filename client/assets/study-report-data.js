(function(root){
  'use strict';
  const utf8=new TextEncoder();
  const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?utf8.encode(value):value))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const text=h=>String(h||'').normalize('NFKC').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  const paths=q=>[...new Set([q?.material,q?.stem,...(q?.options||[]).map(o=>o.t)].flatMap(h=>[...String(h||'').matchAll(/src=["'](assets\/img\/[^"']+)["']/g)].map(m=>m[1])))];
  const sourceId=r=>[r.src,r.key,r.qid,r.no??''].join(':');
  const median=values=>{const v=values.filter(n=>Number.isFinite(n)&&n>0).sort((a,b)=>a-b);return v.length?(v[(v.length-1)>>1]+v[v.length>>1])/2:null;};
  const wilson=(right,n)=>{if(!n)return null;const z=1.96,p=right/n,c=(p+z*z/(2*n))/(1+z*z/n),d=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/(1+z*z/n);return [Math.max(0,c-d),Math.min(1,c+d)];};
  function summary(rows){
    const answered=rows.filter(r=>r.a.pick),valid=answered.filter(r=>r.correct!=null),first=valid.filter(r=>r.first&&r.a.review?.familiarity!=='remember');
    const recent=valid.slice().sort((a,b)=>a.at-b.at).slice(-100),unique=new Map();for(const r of rows)unique.set(r.contentId,r);
    const times=answered.map(r=>r.a.ms).filter(n=>Number.isFinite(n)&&n>0);
    const right=valid.filter(r=>r.correct).length,firstRight=first.filter(r=>r.correct).length;
    return {occurrences:rows.length,answered:answered.length,unanswered:rows.length-answered.length,unique:unique.size,graded:valid.length,right,accuracy:valid.length?right/valid.length:null,
      firstN:first.length,firstRight,firstAccuracy:first.length?firstRight/first.length:null,interval:wilson(firstRight,first.length),sample:first.length<10?'样本不足':first.length<30?'初步观察':'样本较充分',
      recentN:recent.length,recentRight:recent.filter(r=>r.correct).length,recentNew:recent.filter(r=>r.first&&r.a.review?.familiarity!=='remember').length,recentRepeat:recent.filter(r=>!r.first||r.a.review?.familiarity==='remember').length,
      meanMs:times.length?times.reduce((s,n)=>s+n,0)/times.length:null,medianMs:median(times),timedN:times.length,
      pending:answered.length-valid.length,missingQuestion:rows.filter(r=>!r.q).length,missingTime:answered.length-times.length,
      guessCorrect:valid.filter(r=>r.correct&&r.a.review?.confidence==='guess').length,hesitant:answered.filter(r=>r.a.review?.confidence==='hesitant').length,
      remembered:answered.filter(r=>r.a.review?.familiarity==='remember').length,unreviewed:answered.filter(r=>!r.a.review?.confidence).length,
      clearCorrect:valid.filter(r=>r.correct&&r.a.review?.confidence==='clear'&&r.a.review?.familiarity!=='remember').length,
      consolidate:[...unique.values()].filter(needs).length};
  }
  const needs=r=>r.correct===false||r.a.review?.confidence==='guess'||r.a.review?.confidence==='hesitant'||r.a.review?.familiarity==='remember'||r.a.flagged||r.a.answerDoubt;
  function group(rows,keys){const groups=new Map();for(const r of rows){const labels=keys.map(k=>r[k]),id=labels.join('\u001f');if(!groups.has(id))groups.set(id,{id,labels,rows:[]});groups.get(id).rows.push(r);}return [...groups.values()].map(g=>({...g,...summary(g.rows)}));}
  function matches(r,f={}){
    return (!f.examType||r.examType===f.examType)&&(!f.examClass||r.examClass===f.examClass)&&(!f.year||String(r.year)===String(f.year))&&(!f.region||r.region===f.region)&&(!f.kind||r.session.kind===f.kind)&&(!f.module||r.module===f.module)&&
      (!f.type||r.type===f.type)&&(!f.concept||r.concept===f.concept)&&(!f.from||r.at>=f.from)&&(!f.to||r.at<=f.to);
  }
  function trends(rows,mode='week',series='new'){
    const valid=rows.filter(r=>r.correct!=null&&r.a.pick&&(series==='new'?r.first&&r.a.review?.familiarity!=='remember':!r.first||r.a.review?.familiarity==='remember')).sort((a,b)=>a.at-b.at);
    const bins=new Map();for(let i=0;i<valid.length;i++){const r=valid[i],date=new Date(r.at);date.setHours(0,0,0,0);date.setDate(date.getDate()-(date.getDay()+6)%7);const key=mode==='50'?'第 '+(Math.floor(i/50)+1)+' 组':date.toLocaleDateString('sv-SE');if(!bins.has(key))bins.set(key,[]);bins.get(key).push(r);}
    return [...bins].map(([label,items])=>{const stats=summary(items),enough=items.length>=(mode==='50'?50:10);return {label,n:items.length,right:stats.right,accuracy:enough?stats.accuracy:null,meanMs:enough?stats.meanMs:null};});
  }
  const reasons={all:()=>true,wrong:r=>r.correct===false,guess:r=>r.correct===true&&r.a.review?.confidence==='guess',hesitant:r=>r.a.review?.confidence==='hesitant',remember:r=>r.a.review?.familiarity==='remember',pending:r=>!!r.a.pick&&r.correct==null,favorite:r=>r.favorite,doubt:r=>!!r.a.answerDoubt,flagged:r=>r.a.flagged,consolidate:needs};
  function select(data,filters={}){const rows=data.rows.filter(r=>matches(r,filters));return {rows,overall:summary(rows),modules:group(rows,['module']),types:group(rows,['module','type']),concepts:group(rows,['module','type','concept']),trends:trends(rows,filters.trendMode,filters.series)};}
  async function build(sessions,{loadQuestion,catalog={papers:[]},favorites={},favoriteKey,hashImage,onProgress=()=>{},signal}={}){
    const papers=new Map(catalog.papers.map(p=>[p.id,p])),questions=new Map(),identities=new Map(),imageHashes=new Map(),rows=[],issues=[];
    const sorted=sessions.filter(s=>s.submitted!==false).slice().sort((a,b)=>(a.submittedAt||a.createdAt||0)-(b.submittedAt||b.createdAt||0));
    const total=sorted.reduce((n,s)=>n+s.refs.length,0);let done=0;
    for(const session of sorted)for(let i=0;i<session.refs.length;i++){
      if(signal?.aborted)throw new DOMException('已取消','AbortError');
      const ref=session.refs[i],sid=sourceId(ref),a=session.answers?.[ref.qid]||{},snapshot=session.evidence?.[ref.qid];let q=snapshot?.question||questions.get(sid)||null;
      if(!q){try{q=await loadQuestion(ref);questions.set(sid,q);}catch(error){issues.push({kind:'question',sourceId:sid,error:error.message});}}
      const signature=q?JSON.stringify([q.material||'',q.stem||'',q.options||[],q.answer||'',q.answerStatus||'',q.sourceText?.stem||'',q.sourceText?.options||[]]):sid;
      let identity=identities.get(signature);if(identity&&!identity.complete)identity=null;
      if(!identity){
        let complete=!!q;const hashes={};for(const p of paths(q)){
          if(!imageHashes.has(p)){try{imageHashes.set(p,await hashImage(p));}catch(error){imageHashes.set(p,null);issues.push({kind:'image',path:p,error:error.message});}}
          hashes[p]=imageHashes.get(p);if(!hashes[p])complete=false;
        }
        const normalize=h=>text(String(h||'').replace(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/g,(_,p)=>' IMAGE:'+hashes[p]+' '));
        const canonical=q?[normalize(q.material),normalize(q.stem),(q.options||[]).map(o=>[o.k,normalize(o.t)]),q.answer||'',q.answerStatus||'',q.original?q.sourceText?.stem||'':'']:sid;
        identity={id:'q-'+(await hash(JSON.stringify(complete?canonical:[sid,canonical]))),complete};identities.set(signature,identity);
      }
      const p=papers.get(ref.src==='p'?ref.key:q?.pid)||null,exam=p?(root.TrainingTools?.paperExam(p)||{examType:p.examType||'unknown',examClass:p.examClass||''}):{examType:session.training?.examType||'unknown',examClass:session.training?.examClass||''};
      const gradeable=q&&!!q.answer&&!['missing','unknown','unverified'].includes(q.answerStatus);
      const at=session.submittedAt||session.createdAt||0;
      rows.push({attemptId:session.id+'-'+String(i+1).padStart(4,'0'),order:i+1,contentId:identity.id,identityComplete:identity.complete,sourceId:sid,session,ref,q,a,at,dateKnown:!!session.submittedAt,correct:a.pick&&gradeable?a.pick===q.answer:null,
        module:q?.module||ref.module||'未分类',type:q?.classification?.group||q?.type||ref.type||'未分类',concept:q?.classification?.tag||'未细分',
        examType:exam.examType,examClass:exam.examClass,year:p?.year||null,region:p?.region||session.training?.region||'未知',paperName:p?.name||session.title,paperId:p?.id||null,
        provenance:snapshot?'交卷时保存的题目版本':'历史题目未存快照，使用当前题库',favorite:!!q&&!!favorites[favoriteKey?.(q)],first:false});
      onProgress(++done,total);if(done%40===0)await new Promise(r=>setTimeout(r,0));
    }
    // Establish first scoreable attempt against ALL history before date/exam filters.
    const first=new Set();for(const row of rows){if(!row.a.pick||row.correct==null)continue;if(!first.has(row.contentId)){row.first=true;first.add(row.contentId);}}
    return {version:2,rows,issues,imageHashes:Object.fromEntries(imageHashes),createdAt:Date.now(),sessionCount:sorted.length};
  }
  root.StudyReportData={hash,paths,sourceId,summary,group,matches,trends,select,build,reasons,needs,wilson,text};
})(typeof window==='undefined'?globalThis:window);
