/* Cardiologist phone: the approved cardiologist screens (round 2 design language, round 3 v0.2 connected version),
   now connected to the platform server. Sources: prototype cardio/js/1-core.js … 5-app.js. */
(()=>{'use strict';
/* ---------- basics ---------- */
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- the clock: the server's time, set when the live link opens ---------- */
let T0=Date.now(),base=Date.now();
const now=()=>T0+(Date.now()-base);
const p2=n=>String(n).padStart(2,'0');
const hm=t=>{const d=new Date(t);return p2(d.getHours())+':'+p2(d.getMinutes())};
const hms=t=>{const d=new Date(t);return hm(t)+':'+p2(d.getSeconds())};
const dur=ms=>{ms=Math.max(0,ms);const s=Math.floor(ms/1000),m=Math.floor(s/60);return m>=60?Math.floor(m/60)+':'+p2(m%60)+':'+p2(s%60):m+':'+p2(s%60)};
const SEC=1000,MIN=60000;
/* a running counter: the text is filled by ticks(), so a re-render with the same content never replaces it */
const tick=t=>`<span class="mono" data-tick="since" data-t="${t}"></span>`;
const ticks=()=>{const n=now();document.querySelectorAll('[data-tick="since"]').forEach(el=>{const v=dur(n-+el.dataset.t);if(el.textContent!==v)el.textContent=v})};

/* ---------- icons ---------- */
const S=p=>`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${p}</svg>`;
const IC={
 check:S('<path d="M5 12.6l4.3 4.3L19.2 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'),
 person:S('<circle cx="12" cy="8.2" r="3.7" fill="currentColor"/><path d="M4.6 20c.8-3.8 3.7-5.9 7.4-5.9s6.6 2.1 7.4 5.9z" fill="currentColor"/>'),
 info:S('<circle cx="12" cy="6.8" r="1.7" fill="currentColor"/><path d="M12 10.6v7.4" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>'),
 warn:S('<path d="M12 3.3L21.8 20.4H2.2z" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"/><path d="M12 9.6v5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.35" fill="currentColor"/>'),
 bang:S('<path d="M12 5.6v8.2" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><circle cx="12" cy="18.2" r="1.9" fill="currentColor"/>'),
 slash:S('<circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="2.3"/><path d="M6.3 17.7L17.7 6.3" stroke="currentColor" stroke-width="2.3"/>'),
 stop:S('<rect x="7" y="7" width="10" height="10" rx="1.4" fill="currentColor"/>'),
 div:S('<path d="M6 19v-6.2a4 4 0 0 1 4-4h8" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round"/><path d="M14.2 4.6l4.2 4.2-4.2 4.2" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>'),
 phone:S('<path d="M6.6 3.5h3l1.5 4.2-2.1 1.5a11.5 11.5 0 0 0 5.8 5.8l1.5-2.1 4.2 1.5v3a1.6 1.6 0 0 1-1.7 1.6A16.5 16.5 0 0 1 5 5.2a1.6 1.6 0 0 1 1.6-1.7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'),
 list:S('<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="4.5" cy="6.5" r="1.4" fill="currentColor"/><circle cx="4.5" cy="12" r="1.4" fill="currentColor"/><circle cx="4.5" cy="17.5" r="1.4" fill="currentColor"/>'),
 ecg:S('<path d="M2 13h4l2-5 3 10 2.5-13 2.5 8h6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
 hosp:S('<path d="M4 20V7.2l8-3.2 8 3.2V20z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 8.5v6.5M8.8 11.7h6.4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
 board:S('<rect x="3.5" y="4.5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 9.5h17M9 9.5v10" stroke="currentColor" stroke-width="2"/>'),
 plus:S('<path d="M12 4.5v15M4.5 12h15" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>'),
 minus:S('<path d="M4.5 12h15" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>'),
 expand:S('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
 close:S('<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'),
 back:S('<path d="M19 12H6M11.5 6.5L6 12l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'),
 tl:S('<path d="M7 4v16" stroke="currentColor" stroke-width="2"/><circle cx="7" cy="7" r="2.3" fill="currentColor"/><circle cx="7" cy="16" r="2.3" fill="currentColor"/><path d="M11.5 7h8M11.5 16h8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
 cmp:S('<rect x="3" y="5" width="8" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="13" y="5" width="8" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/>')
};
const GL={done:IC.check,ack:IC.person,info:IC.info,warn:IC.warn,fail:IC.bang,nv:IC.slash,stop:IC.stop,div:IC.div};
const G=k=>`<span class="g g-${k}" aria-hidden="true">${GL[k]||''}</span>`;
const nye=t=>`<span class="nye"><i></i>${t||'Not yet entered'}</span>`;
IC.bell=S('<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.6 2H4.4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>');
IC.spk=S('<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>');

/* ---------- who is looking: the on-duty cardiologist of the provisional receiving PCI hospital (fictional) ---------- */
let CAD='',EPOCH='';
/* the unit and crew come from the case record; the cardiologist is the logged-in test user (cardio@test.local, fictional) */
let UNIT='',EMIRATE='',CREW='',CREWT='';
const AU=window.APP.user,ME=AU.name,MET=`${AU.name}, ${AU.title}${AU.org?', '+AU.org:''}`;
const HN={A:'PCI Hospital A',B:'PCI Hospital B',C:'PCI Hospital C'};
const HETA={A:18,B:26,C:34};
const NOT_REASONS=['No acute ischaemic changes','Old changes / known LBBB','Pericarditis pattern','Other (free text)'];
const REP_REASONS=['Repeat due to ongoing symptoms','Poor ECG quality','Dynamic changes suspected','Additional lead clarification'];
const MDL={age:'Age',sex:'Sex',complaint:'Presenting complaint',onset:'Symptom onset',bp:'BP',hr:'HR',spo2:'SpO₂',gcs:'GCS'};
const RECL=[['Treatment given',['asp','Aspirin'],['gtn','GTN'],['ana','Analgesia'],['otx','Other treatment']],['Condition and comments',['cond','Patient condition'],['cmt','Crew comments'],['pain','Pain assessment']],['Risks',['anti','Anticoagulants'],['all','Allergies']],['History',['pmh','Past medical history'],['hx','Clinical history'],['fmc','First medical contact']],['Other observations',['rr','Respiratory rate'],['tmp','Temperature']]];

/* ---------- prototype state: R is the shared record as the platform last delivered it; U is this device's own view state ---------- */
let SC={ids:false,dev:'phone'},DEV='phone';
let R=null,NET={up:false,last:null},layer=null,timers=[],opSeq=0;
const setT=(ms,fn)=>{const id=setTimeout(()=>{timers=timers.filter(x=>x!==id);fn()},ms);timers.push(id);return id};
const clearTimers=()=>{timers.forEach(clearTimeout);timers=[]};
let U=null;
const newU=()=>({scr:'queue',ecg:1,img:{},zoom:1,sx:0,sy:0,src:null,cmp:{n:[1,2],imgs:{},focus:'all'},hideAI:false,newDec:false,views:{},seen:{},alertShown:false,ackAt:null});

/* ---------- talking to the platform ---------- */
let LIVE=null;
const post=()=>{};
const rid=()=>Math.random().toString(36).slice(2,10);
/* every action goes to the server at once; o.p resolves true only when the server has stored it */
function op(k,data,t){
 if(!NET.up)return null;
 const o={id:'d'+rid()+'-'+(++opSeq),cad:CAD,k,data:data||{},t:t==null?now():t};
 o.p=LIVE.send([o]).then(r=>{const x=(r.results||[])[0];if(x&&!x.ok){toast(x.error||'The platform did not accept this action');return false}return true},()=>false);
 return o;
}

/* ---------- reading the record ---------- */
const sub=()=>!!(R&&R.sub);
const lastEcg=()=>R.ecgs[R.ecgs.length-1];
const ecgN=n=>R.ecgs[n-1];
const priImg=e=>e.imgs.find(x=>x.i===e.pri)||e.imgs[0];
const imgOf=(e,i)=>e.imgs.find(x=>x.i===i)||priImg(e);
const imgName=(e,x)=>x.i===e.pri?'Primary image':'Image '+x.i;
const viewedAt=(n,i)=>U.views[n+'|'+i]||(R.views&&R.views[n+'|'+i])||null;
const seenEcg=e=>e.imgs.some(x=>viewedAt(e.n,x.i));
const cur=k=>{const a=R.pt[k];return a&&a.length?a[a.length-1]:null};
const lastDec=()=>R.dec.length?R.dec[R.dec.length-1]:null;
/* ACKNOWLEDGE & OPEN is shown at once on this device; the platform's record follows within milliseconds */
const ackAt=()=>R&&(R.ack||U.ackAt)||null;
const acked=()=>!!ackAt();
const alertOn=()=>!!(R&&R.alert&&!acked());
/* NEW marks what arrives after the cardiologist opened the case; everything before is the case as first opened */
const updSeen=u=>!!(u.seen||U.seen[u.id]||(ackAt()&&u.at<=ackAt()));
const unseen=()=>R.upd.filter(u=>!updSeen(u));
const unseenFor=f=>R.upd.filter(u=>!updSeen(u)&&f(u));
const destCur=()=>R.dest.length?R.dest[R.dest.length-1]:null;
const etaCur=()=>R.eta.length?R.eta[R.eta.length-1]:null;
const caseRef=()=>'CAD #'+CAD;
function ptLine(){
 const a=cur('age'),s=cur('sex'),c=cur('complaint'),p=[];
 if(a)p.push(a.raw&&a.raw.nv?'Age unknown':a.v);
 if(s)p.push(s.v);
 if(c)p.push(String(c.v).split(' · ')[0]);
 return p.join(' · ')||'Patient details pending';
}
function mode(){
 const d=lastDec();
 if(!d||U.newDec)return 'review';
 if(d.k==='repeat')return R.ecgs.some(e=>e.rcv>d.at)?'review':'repeat';
 return d.k;
}
/* a decision covers the latest ECG, which must have been viewed first (I-7) */
const latestSeen=()=>seenEcg(lastEcg());

const ECG=window.ECG,{AIROWS,AIST,aiVal,aiStLine}=window.AIX;
const FOCUS=[['all','Whole ECG'],['i3','I to III'],['avr','aVR to aVF'],['v13','V1 to V3'],['v46','V4 to V6'],['rhy','Rhythm strip']];
const FOCUSL=Object.fromEntries(FOCUS);

/* ---------- shared view parts ---------- */
const idTag=id=>SC.ids&&id?`<button class="idtag" data-note="${id}" title="Show the spec for ${id}">${id}</button>`:'';
function scrId(){
 if(layer){const t=layer.t;if(t==='decide'||t==='confirm'||t==='not')return 'D-03';if(t==='repeat')return 'D-05'}
 if(!R||!sub()||alertOn()||U.scr==='queue')return 'D-01';
 if(U.scr==='cmp'&&R.ecgs.length>1)return 'D-06';
 const m=mode();
 if(m==='repeat')return 'D-05';
 if(m==='confirm'||m==='not')return 'D-03';
 return 'D-02';
}
/* LIVE — CONNECTED with the last update time, or CONNECTION LOST */
const netHtml=()=>NET.up?`<span class="tb-net"><span class="dot"></span><span class="nt"><b>LIVE — CONNECTED</b><small data-tick="sync">Last update ${NET.last?hms(NET.last):'–'}</small></span></span>`:`<span class="tb-net off"><span class="dot"></span><span class="nt"><b>CONNECTION LOST</b><small>Attempting to reconnect</small></span></span>`;
function topbar(){
 const nav=[['queue',IC.list,'Review queue',U.scr==='queue']];
 if(acked())nav.push(['case',IC.ecg,'Case',U.scr!=='queue']);
 return `<header class="tb"><nav class="tb-nav" aria-label="Main">${nav.map(([k,ic,l,on])=>`<button data-act="nav" data-k="${k}"${on?' aria-current="page"':''}>${ic}<span>${l}</span></button>`).join('')}</nav><span class="tb-app">Unified STEMI Platform</span><span class="sp">${idTag(scrId())}</span><span class="tb-me">${ME}<small>Cardiologist · ${HN.A}</small></span><span class="tb-duty"><i></i>On duty</span>${netHtml()}<span class="tb-clock mono" data-tick="clock">${hm(now())}</span></header>`;
}
const lostBand=()=>NET.up?'':`<div class="pband pb-amb lostband" role="alert">${G('warn')}<b class="t">CONNECTION LOST · Attempting to reconnect</b><span class="sub">What you see may no longer be current${NET.last?` · last update ${hms(NET.last)}`:''}</span><span class="sub">A decision cannot be sent until the connection returns</span></div>`;
const STATEC={'AWAITING CARDIOLOGIST':['c-neutral','pend'],'UNDER REVIEW':['c-acc','ack'],'CONFIRMED STEMI':['c-red',''],'NOT STEMI':['c-neutral','done'],'REPEAT ECG REQUESTED':['c-acc','info']};
function caseState(){
 const d=lastDec(),m=mode();
 if(d&&m!=='review')return {confirm:'CONFIRMED STEMI',not:'NOT STEMI',repeat:'REPEAT ECG REQUESTED'}[d.k];
 if(d&&d.k==='confirm')return 'CONFIRMED STEMI';
 return acked()?'UNDER REVIEW':'AWAITING CARDIOLOGIST';
}
function stateChip(){const s=caseState(),m=STATEC[s];return `<span class="chip ${m[0]}">${m[1]?G(m[1]):''}${s}</span>`}
function destLine(){
 const d=destCur();if(!d)return 'Destination being recommended';
 return `${HN[d.hosp]} · ${d.st==='rec'?'provisional':d.st==='chg'?'changed':'confirmed'}`;
}
function etaLine(){
 const e=etaCur(),d=destCur();
 if(e)return `${e.dep?`Departed ${hm(e.dep)} · `:''}ETA ${e.min} min · about ${hm((e.dep||e.t)+e.min*MIN)}`;
 return d?`On scene · ETA ${HETA[d.hosp]} min once departed`:'On scene';
}
function caseHeader(){
 return `<div class="ch" id="r-head"><div class="ch-id"><div class="ch-l1"><span>${caseRef()}</span>${stateChip()}</div><div class="ch-l2"><b>${esc(ptLine())}</b><span>${UNIT} · ${EMIRATE}</span><span>Submitted ${hms(R.sub.send)}</span><span>${esc(destLine())}</span><span>${esc(etaLine())}</span></div></div><div class="ch-r"><button class="btn btn-q" data-act="timeline">${IC.tl}<span>Timeline</span></button></div></div>`;
}
const band=(k,g,t,subs)=>`<div class="pband pb-${k}">${G(g)}<b class="t">${t}</b>${(subs||[]).filter(Boolean).map(s=>`<span class="sub">${s}</span>`).join('')}</div>`;
const crewDlv=d=>d.crewAck?`Crew acknowledged ${hms(d.crewAck)}`:d.dlv?`Shown on the crew tablet ${hms(d.dlv)} · awaiting acknowledgement`:'Delivering to the crew';
/* the platform knows when the crew tablet stops reaching it: the cardiologist is told, so no news is not read as no change */
const crewOff=()=>!!(R.presence&&R.presence.crew&&R.presence.crew.up===false);
/* a case that reached the platform only after the crew had started the STEMI downtime route (C-08) */
const lateLine=()=>`The crew was already using the STEMI downtime route${R.downtime?` from ${hms(R.downtime.at)}`:''}`;
function bandsHtml(){
 const late=R.sub&&R.sub.late?band('amb','warn','DOWNTIME CASE · delivered late',[lateLine(),'The case may already have been discussed by phone']):'';
 const off=crewOff()?band('info','warn',`CREW TABLET OFFLINE since ${hms(R.presence.crew.at)}`,['Anything the crew saves meanwhile arrives here, in order, when the tablet reconnects','Call the crew if it cannot wait']):'';
 return late+off+decBand();
}
function decBand(){
 const d=lastDec(),m=mode();if(!d)return '';
 if(d.k==='confirm')return band('red','fail','STEMI CONFIRMED',[`${MET} · ${hms(d.at)}`,crewDlv(d),'Hospital activation: next design phase']);
 if(d.k==='not'&&m!=='review')return band('info','done','NOT STEMI',[`${hms(d.at)}`,d.reason?`reason: ${esc(d.reason)}`:'',crewDlv(d)]);
 if(d.k==='repeat'&&m==='repeat')return band('info','info',`REPEAT ECG REQUESTED — awaiting ECG ${R.ecgs.length+1}`,[`sent ${hms(d.at)}`,crewDlv(d),`waiting ${tick(d.at)}`]);
 return '';
}

/* ---------- D-01: the new-case alert (audible alarm until ACKNOWLEDGE & OPEN) and the review queue ---------- */
/* the queue shows the AI status only, never the interpretation */
function aiQueue(e){return !e.ai?'Starting':({proc:'Processing',ok:'Analysis completed',lim:'Interpretation limited',wh:'Interpretation limited',down:'Interpretation unavailable'})[e.ai.st]}
function qrow(){
 const L=lastEcg(),d=lastDec(),n=unseen().length;
 let st;
 if(!acked())st=`<span class="q-state">${G('pend')}<span>NOT YET ACKNOWLEDGED</span></span>`;
 else if(d&&mode()!=='review')st=`<span class="q-state">${stateChip()}</span>`;
 else st=`<span class="q-state">${G('ack')}<span>ACKNOWLEDGED · UNDER REVIEW<small>${ME} · ${hm(ackAt())}</small></span></span>`;
 const marks=[];
 if(!acked())marks.push('<span class="chip c-red">NEW CASE</span>');
 if(acked()&&n)marks.push(`<span class="chip c-acc">${n} NEW update${n>1?'s':''}</span>`);
 if(L.n>1&&!seenEcg(L))marks.push(`<span class="chip c-acc">NEW · ECG ${L.n}</span>`);
 if(R.sub.late)marks.push(`<span class="chip c-warn">${G('warn')}Delivered late · downtime route in use</span>`);
 R.alert&&R.alert.esc.forEach(x=>marks.push(`<span class="chip c-warn">${G('warn')}Escalated: ${esc(x.to)} · ${hm(x.t)}</span>`));
 return `<article class="qrow${!acked()?' urgent':' opened'}">
  <div class="q-st">${st}${!acked()?`<span class="q-wait"><small>Waiting</small>${tick(R.alert?R.alert.at:R.sub.rcv)}</span>`:''}</div>
  <div class="q-f"><span class="l">Case</span><b>${caseRef()}</b><span>${esc(ptLine())}</span><span>${UNIT} · ${EMIRATE}</span></div>
  <div class="q-f"><span class="l">ECG received</span><b>ECG ${L.n} · ${hms(L.rcv)}</b><span class="l">Destination and ETA</span><span>${esc(destLine())} · ${esc(etaLine())}</span></div>
  <div class="q-marks">${marks.join('')}<span class="q-ai"><span class="g g-ai">AI</span>${aiQueue(L)}</span></div>
  <div class="q-go"><button class="btn btn-p" data-act="${acked()?'open':'ack'}"${!acked()&&!NET.up?' disabled':''}>${acked()?'Open case':'ACKNOWLEDGE &amp; OPEN'}</button></div>
 </article>`;
}
function vQueue(){
 let h=topbar()+`<div id="r-lost">${lostBand()}</div>`;
 h+=`<main class="qwrap" data-keep="q"><h2 class="q-h">Needs your review</h2>${sub()&&mode()==='review'?qrow():'<div class="q-empty">No cases waiting for review</div>'}`;
 h+=`<h2 class="q-h">Ongoing</h2>${sub()&&mode()!=='review'?qrow():'<div class="q-empty">No other active cases</div>'}</main>`;
 return h;
}
function vAlert(){
 const a=R.alert,L=R.ecgs[0];
 const extra=a.rem.map((t,i)=>`<li>${G('info')}<span>Reminder ${i+1} sent · ${hms(t)}</span></li>`).join('')+a.esc.map(x=>`<li>${G('warn')}<span>Escalated: ${esc(x.to)} alerted · ${hms(x.t)}</span></li>`).join('');
 return `<div class="nca-wrap"><div class="alert nca" role="alertdialog" aria-modal="true" aria-labelledby="nca-t" aria-describedby="nca-d">${idTag('D-01')}
  <div class="alert-b"><div class="nca-h">${IC.bell}<b id="nca-t">NEW CARDIAC CASE</b></div><span class="nca-snd">${IC.spk}Audible alarm · it stops only when you acknowledge</span></div>
  <div class="alert-c" id="nca-d"><dl>
   <dt>Case</dt><dd class="mono nca-cad">${caseRef()}</dd>
   <dt>Unit</dt><dd>${UNIT} · ${EMIRATE}</dd>
   <dt>ECG received</dt><dd><span class="mono nca-t">${hm(L.rcv)}</span> <small class="muted">${hms(L.rcv)}</small></dd>
   <dt>Patient</dt><dd>${esc(ptLine())}</dd>
   <dt>Waiting</dt><dd>${tick(a.at)}</dd>
  </dl>${R.sub.late?`<p class="nca-late">${G('warn')}<span><b>Delivered late.</b> ${lateLine()}.</span></p>`:''}${extra?`<ul class="nca-x">${extra}</ul>`:''}</div>
  <div class="alert-f"><button class="btn btn-lg btn-p nca-go" data-act="ack"${NET.up?'':' disabled'}>ACKNOWLEDGE &amp; OPEN</button>
   <p class="nca-n">${NET.up?'Records that you have received and opened this case. It is not a STEMI decision.':`${G('warn')}No connection: your acknowledgement cannot reach the platform yet, so the alarm continues.`}</p></div></div></div>`;
}

/* ---------- D-02: the live case workspace ---------- */
/* NEW — item — HH:MM, the time it reached this screen; a clock time at the end of the item that repeats it is dropped */
const nline=u=>{const t=hm(u.at),x=String(u.text).replace(new RegExp(' · '+t+'$'),'');return `NEW — ${esc(x)} — ${t}`};
function stripHtml(){
 const L=unseen();if(!acked()||!L.length)return '';
 const btn=u=>u.kind==='ecg'?`<button class="btn btn-q" data-act="ecg" data-n="${u.ref.n}">View ECG ${u.ref.n}</button>`:u.kind==='img'?`<button class="btn btn-q" data-act="img-go" data-n="${u.ref.n}" data-i="${u.ref.i}">View image</button>`:`<button class="btn btn-q" data-act="seen" data-id="${u.id}">Seen</button>`;
 const info=L.filter(u=>u.kind!=='ecg'&&u.kind!=='img').length;
 return `<div class="nstrip" role="status" aria-live="polite"><div class="ns-h"><b>${L.length} NEW since you opened the case</b><span>Silent updates: no alarm. ECGs and images clear when you view them.</span>${info>1?'<button class="btn btn-q" data-act="seen-all">Mark all information as seen</button>':''}</div><ul>${L.slice().reverse().map(u=>`<li class="k-${u.kind}"><span class="nl">${nline(u)}</span>${btn(u)}</li>`).join('')}</ul></div>`;
}
/* in the comparison the ECGs keep the room: new items show as one line */
function stripMini(){
 const L=unseen();if(!acked()||!L.length)return '';
 return `<div class="nmini" role="status"><span class="newtag">${L.length} NEW</span><span class="nl">${L.slice().reverse().map(u=>esc(nline(u).replace(/^NEW — /,''))).join(' · ')}</span><button class="btn btn-q" data-act="cmp-back">See in the case</button></div>`;
}
function vCase(){
 const ecgRg=`<div class="rg-h">Original ECG<span class="sp"></span><small>As photographed by the crew</small></div><div class="rg-b" id="r-ecg">${ecgBody()}</div>`;
 const cliRg=`<div class="rg-h">Clinical information<span class="sp"></span><small>Live from the crew · read only</small></div><div class="rg-b" id="r-cli">${cliBody()}</div>`;
 const aiRg=`<div class="rg-h"><span class="g g-ai">AI</span>AI ECG interpretation<span class="sp"></span><small>Decision support only</small></div><div class="rg-b" id="r-ai">${aiBody()}</div>`;
 let h=topbar()+`<div id="r-lost">${lostBand()}</div>`+caseHeader()+`<div id="r-bands">${bandsHtml()}</div>`;
 /* the NEW list sits at the top of the clinical column, so the original ECG keeps its full height */
 const strip=`<div id="r-strip">${stripHtml()}</div>`;
 if(DEV==='phone')h+=`${strip}<div class="rv" data-keep="rv"><section class="rg">${ecgRg}</section><section class="rg">${cliRg}</section><section class="rg ai-col">${aiRg}</section></div><div class="pbar" id="r-act">${actHtml()}</div>`;
 else if(DEV==='tablet')h+=`<div class="rv"><div class="col ecgcol" data-keep="c1"><section class="rg">${ecgRg}</section><div id="r-act">${actHtml()}</div></div><div class="col" data-keep="c2">${strip}<section class="rg">${cliRg}</section><section class="rg ai-col">${aiRg}</section></div></div>`;
 else h+=`<div class="rv"><div class="col ecgcol" data-keep="c1"><section class="rg">${ecgRg}</section><div id="r-act">${actHtml()}</div></div><div class="col" data-keep="c2">${strip}<section class="rg">${cliRg}</section></div><div class="col ai-col" data-keep="c3"><section class="rg">${aiRg}</section></div></div>`;
 return h;
}
function coversText(){
 const L=lastEcg(),also=R.ecgs.filter(g=>g.n<L.n&&seenEcg(g)).map(g=>'ECG '+g.n);
 return `A decision now covers ECG ${L.n} · ${hm(L.acq)}, the latest ECG${also.length?`, with ${also.join(' and ')} recorded as also reviewed`:''}.`;
}
function actHtml(){
 const m=mode(),call=`<button class="btn btn-s btn-call" data-act="call">${IC.phone}CALL CREW</button>`,off=!NET.up?' disabled':'';
 const offNote=NET.up?'':'<p class="dnote warnn">No connection: a decision cannot be sent. Call the crew if it cannot wait.</p>';
 if(DEV==='phone'){
  if(m==='review')return `<button class="icon-btn" data-act="call" aria-label="Call crew">${IC.phone}</button><button class="btn btn-p" data-act="decide"${off}>Decide</button>`;
  if(m==='confirm')return `<button class="btn btn-s" data-act="call">${IC.phone}Call crew</button>`;
  return `<button class="btn btn-s" data-act="call">${IC.phone}Call crew</button><button class="btn btn-q" data-act="newdec"${off}>New decision</button>`;
 }
 if(m==='review')return `<div class="dbar" role="group" aria-label="Clinical decision"><div class="dec"><button class="btn btn-red" data-act="d-confirm"${off}>CONFIRMED STEMI</button><button class="btn btn-q" data-act="d-not"${off}>NOT STEMI</button><button class="btn btn-q" data-act="d-repeat"${off}>UNCLEAR / REQUEST REPEAT ECG</button></div><span class="gap"></span>${call}<p class="dnote">${coversText()} Acknowledging the case was not a decision.</p>${offNote}</div>`;
 if(m==='confirm')return `<div class="dbar"><div class="acts"><button class="btn btn-s" data-act="call">${IC.phone}Call crew</button></div><p class="dnote">Activation of the receiving hospital is designed in the next phase. New information from the crew keeps arriving here, silently.</p></div>`;
 return `<div class="dbar"><div class="acts"><button class="btn btn-s" data-act="call">${IC.phone}Call crew</button><button class="btn btn-q" data-act="newdec"${off}>Record a new decision</button></div>${m==='repeat'?'<p class="dnote">When the repeat ECG arrives it appears here as NEW, with no alarm, and the decision buttons return.</p>':''}${offNote}</div>`;
}

/* ---------- the original ECG: always dominant, never covered by AI ---------- */
function markSeen(e,x){
 if(!acked()||viewedAt(e.n,x.i))return;
 U.views[e.n+'|'+x.i]=now();op('viewed',{n:e.n,i:x.i});
 R.upd.forEach(u=>{if((u.kind==='ecg'&&u.ref.n===e.n)||(u.kind==='img'&&u.ref.n===e.n&&u.ref.i===x.i))U.seen[u.id]=now()});
}
const isNewImg=(e,x)=>R.upd.some(u=>u.kind==='img'&&u.ref.n===e.n&&u.ref.i===x.i&&!updSeen(u));
function ecgBody(){
 const e=ecgN(U.ecg)||lastEcg(),x=imgOf(e,U.img[e.n]);
 markSeen(e,x);
 const L=lastEcg(),unv=L.n>1&&!seenEcg(L);
 let h='';
 if(unv)h+=`<div class="newecg nsoft" role="status">${G('info')}<div class="t"><b>NEW — ECG ${L.n} received — ${hm(L.rcv)}</b>Acquired ${hms(L.acq)}. Its own ECG, not an image of ECG ${L.n-1}.</div><button class="btn btn-p" data-act="ecg" data-n="${L.n}">View ECG ${L.n}</button><button class="btn btn-q" data-act="cmp">Compare</button></div>`;
 h+=`<div class="etabs" role="group" aria-label="ECGs in this case">${[...R.ecgs].reverse().map(g=>`<button class="etab" data-act="ecg" data-n="${g.n}" aria-pressed="${g.n===e.n}">ECG ${g.n} · ${hm(g.acq)}${g.n===L.n&&R.ecgs.length>1?' <small>Latest</small>':''}${!seenEcg(g)?' <span class="newtag">NEW</span>':''}</button>`).join('')}${R.ecgs.length>1?`<button class="etab" data-act="cmp">${IC.cmp}Compare ${R.ecgs.length>2?'ECGs':`ECG 1 | ECG 2`}</button>`:''}</div>`;
 if(e.imgs.length>1)h+=`<div class="itabs" role="group" aria-label="Images of ECG ${e.n}">${e.imgs.map(g=>`<button class="itab" data-act="img" data-i="${g.i}" aria-pressed="${g.i===x.i}">${g.i===e.pri?'<span class="pm">Primary</span> image':'Image '+g.i}<small>${hms(g.at)}</small>${isNewImg(e,g)?'<span class="newtag">NEW</span>':viewedAt(e.n,g.i)?`<span class="vw" title="Viewed ${hms(viewedAt(e.n,g.i))}">${IC.check}</span>`:''}</button>`).join('')}</div>`;
 const src=x.url;
 h+=`<div class="ev"><div class="ev-scroll"><img src="${src}" alt="ECG ${e.n}, ${imgName(e,x)}, as photographed by the crew" style="--z:${U.zoom}" draggable="false"></div><span class="ev-z">${Math.round(U.zoom*100)}%</span><div class="ev-tools"><button data-act="zoom" data-d="-1" aria-label="Zoom out"${U.zoom<=1?' disabled':''}>${IC.minus}</button><button data-act="zoom" data-d="1" aria-label="Zoom in"${U.zoom>=3?' disabled':''}>${IC.plus}</button><button data-act="fs">${IC.expand}Full screen</button></div></div>`;
 h+=`<div class="ev-cap"><b>${caseRef()}</b><span>${UNIT}</span><span>ECG ${e.n} · ${imgName(e,x)}${e.imgs.length>1?` of ${e.imgs.length}`:''}</span><span>acquired ${hms(e.acq)}</span><span>photo ${hms(x.at)}</span>${x.after?`<span>added after sending · ${hms(x.rcv)}</span>`:''}</div>`;
 return h;
}

/* ---------- clinical information: live, in place. A changed value never replaces the old one on this screen ---------- */
const KINDL={sent:'sent with ECG 1',update:'new reading',correct:'correction',clarify:'clarification',new:'',change:'changed'};
function newTag(us){
 if(!us.length)return '';
 const u=us[us.length-1];
 return `<button class="newtag nbtn" data-act="seen-ids" data-ids="${us.map(x=>x.id).join(',')}" title="Mark as seen">NEW · ${hm(u.at)}</button>`;
}
function crow(l,v,us,hist){
 const n=us.length>0;
 return `<div class="cr${n?' isnew':''}"><span class="l">${l}</span><span class="v">${v}${newTag(us)}</span>${hist?`<span class="hist">${hist}</span>`:''}</div>`;
}
function ptRow(k,showTime){
 const a=R.pt[k]||[],c=a[a.length-1];
 if(!c)return crow(MDL[k],nye(),[]);
 const us=unseenFor(u=>u.kind==='md'&&u.ref.k===k);
 const nv=c.raw&&c.raw.nv;
 let v=nv?`<span class="nvv">${G('nv')}${esc(c.v)}</span>`:esc(c.v);
 if(showTime&&!nv)v+=` <small>${hm(c.t)}</small>`;
 if(c.kind==='correct')v+=` <small class="kc">corrected ${hm(c.rcv)}</small>`;
 else if(c.kind==='clarify')v+=` <small class="kc">clarified ${hm(c.rcv)}</small>`;
 const hist=a.length>1?'Earlier: '+a.slice(0,-1).reverse().map(x=>`${esc(x.v)} <span class="mono">${hm(x.t)}</span> <i>${KINDL[x.kind]}</i>`).join(' · ')+(c.kind==='correct'?' · corrected by '+esc(c.by):''):'';
 return crow(MDL[k],v,us,hist);
}
function recRow(k,l){
 const r=R.rec[k];if(!r)return '';
 const vs=r.vers,c=vs[vs.length-1],us=unseenFor(u=>u.kind==='rec'&&u.ref.k===k);
 const multi=k==='cmt'||k==='cond';
 const v=multi?vs.slice().reverse().map((x,i)=>`<span class="mline${i?' older':''}">${esc(x.v)} <small>${hm(x.rcv)}</small></span>`).join(''):`${esc(c.v)}`;
 const hist=!multi&&vs.length>1?'Earlier: '+vs.slice(0,-1).reverse().map(x=>`${esc(x.v)} <span class="mono">${hm(x.rcv)}</span>`).join(' · '):'';
 return crow(l,v,us,hist);
}
function cliBody(){
 const g=(t,rows)=>{const r=rows.filter(Boolean).join('');return r?`<div class="cg"><h3>${t}</h3>${r}</div>`:''};
 const d=destCur(),dus=unseenFor(u=>u.kind==='dest'),eus=unseenFor(u=>u.kind==='eta');
 const dh=R.dest.length>1?'Earlier: '+R.dest.slice(0,-1).reverse().map(x=>`${HN[x.hosp]} (${x.st==='rec'?'recommended':x.st==='chg'?'changed':'confirmed'} ${hm(x.t)})`).join(' · '):'';
 const eh=R.eta.length>1?'Earlier: '+R.eta.slice(0,-1).reverse().map(x=>`${x.min} min (${hm(x.rcv)})`).join(' · '):'';
 let out=g('Patient',[ptRow('age'),ptRow('sex'),ptRow('complaint'),ptRow('onset')])
  +g('Vital signs',[ptRow('bp',1),ptRow('hr',1),ptRow('spo2',1),ptRow('gcs',1)]);
 RECL.forEach(([t,...its])=>{out+=g(t,its.map(([k,l])=>recRow(k,l)))});
 const tr=[crow('Unit',`${UNIT} · ${EMIRATE} <small>${CREWT}</small>`,[]),crow('Destination',d?`${HN[d.hosp]} <small>${d.st==='rec'?'provisional · destination engine':d.st==='chg'?`changed by the crew${d.why?' · '+esc(d.why):''}`:'confirmed by the crew'} · ${hm(d.t)}</small>`:nye('Being recommended'),dus,dh),crow('ETA',esc(etaLine()),eus,eh)];
 out+=g('Transport',tr);
 const none=!Object.keys(R.rec).length;
 return out+(none?'<p class="muted cnote">Treatment, history and comments appear here the moment the crew saves them.</p>':'');
}

/* ---------- AI ECG interpretation: its own region, never over the ECG, never blocking, never sounding.
   The platform makes one analysis per ECG; the crew tablet shows the same analysis (Hamad, 3 Oct 2026, 12:07) ---------- */
function corrText(e){
 const on=cur('onset'),bp=cur('bp'),an=R.rec.anti,pm=R.rec.pmh,p=[];
 if(on&&!(on.raw&&on.raw.nv))p.push(`Onset ${on.v}`);
 if(bp)p.push(`BP ${bp.v} at ${hm(bp.t)}`);
 p.push(an?`anticoagulants: ${an.vers[an.vers.length-1].v}`:'anticoagulants not yet entered');
 if(pm)p.push(`history: ${pm.vers[pm.vers.length-1].v}`);
 return p.join('; ');
}
const aiGlyph=a=>!a?G('prog'):({proc:G('prog'),ok:G('done'),lim:G('warn'),wh:G('warn'),down:G('nv')})[a.st];
function air(e,k,l,v,src,lim,imp){
 const open=U.src===k,ms=`ECG model measurements at J+60 ms, ECG ${e.n}.`;
 const det={q:`Quality gate on ECG ${e.n}, ${imgName(e,priImg(e))}.`,ste:ms,std:ms,ser:e.n>1?`Serial comparison of the Primary images of ECG ${e.n} and ECG ${e.n-1}.`:'No earlier ECG in this case.',corr:'Crew entries as they stand now, read from the live record. Shown on this screen only: it is not part of the ECG analysis.',imp:'Rules engine applied to the ECG model’s findings. The rule set is to be approved. The crew tablet shows the same text.'}[k]||'ECG model output.';
 return `<button class="air${lim?' lim':''}${imp?' imp':''}" data-act="src" data-k="${k}" aria-expanded="${open}"><span class="l">${l}</span><span class="v">${esc(v)}</span><span class="src">${src}${open?' · hide':' · show source'}</span>${open?`<span class="srcx">${esc(det)}</span>`:''}</button>`;
}
/* the platform's rows, in the shared order; the clinical correlation (this screen only) sits before the impression */
function aiRows(e){
 const a=e.ai,src={q:'Quality gate',ser:'Serial comparison',imp:'Rules engine and model',conf:'Model'};
 const rows=AIROWS.map(([k,l])=>[k,l,aiVal(a,e.n,k),src[k]||'ECG model',!!(a.lim&&a.lim[k]),k==='imp']);
 rows.splice(rows.findIndex(r=>r[0]==='imp'),0,['corr','Clinical correlation',corrText(e),'Report writer · live crew entries']);
 return rows.map(r=>air(e,...r)).join('');
}
/* which ECG the analysis read, when it was acquired, when the analysis finished and its status: "ECG 2 — 14:35" */
function aiMeta(e){
 return `<div class="ai-meta"><b class="ai-ecg">ECG ${e.n} — ${hm(e.acq)}</b>${e.n>1?`<span class="ai-newan">New ECG analysis · ECG ${e.n-1}’s analysis is kept</span>`:''}<span class="ai-st">${aiGlyph(e.ai)}<span>${aiStLine(e.ai)}</span></span></div>`;
}
function aiBody(){
 const e=ecgN(U.ecg)||lastEcg(),a=e.ai,L=lastEcg();
 let body='';
 if(!a||a.st==='proc')body=`<div class="ai-rows">${['ECG quality','Rhythm','ST elevation','AI impression'].map(l=>`<div class="air"><span class="l">${l}</span><span class="v">${nye('Pending')}</span></div>`).join('')}</div>`;
 else if(a.st==='down')body=`<div class="ai-down">${G('nv')}<div><b>Continue clinical review using the original ECG and patient information.</b><br><small>The case is not affected. The failure is logged.</small></div></div>`;
 else if(a.st==='wh')body=`<div class="ai-q"><b>${esc(a.q)}</b>No interpretation is given for this ECG. The original ECG is here for your review as normal.</div>`;
 else body=(a.st==='lim'?'<div class="ai-q"><b>Glare over limb leads I, II and III</b>Only what could be assessed is reported.</div>':'')+`<div class="ai-rows">${aiRows(e)}</div>`;
 const us=unseenFor(u=>u.kind==='ai'&&u.ref.n===e.n);
 /* viewing an earlier ECG: its own analysis stays here, and the newer analysis is one tap away, never swapped in silently */
 const newer=L.n>e.n?`<div class="ai-newer">${G('info')}<span class="t">ECG ${L.n} has its own analysis${L.ai&&L.ai.st!=='proc'?`: ${AIST[L.ai.st]}`:L.ai?': processing':''}.</span><button class="btn btn-q" data-act="ecg" data-n="${L.n}">View ECG ${L.n}</button></div>`:'';
 const foot=!a||a.st==='proc'?`<div class="ai-foot">The alert did not wait for the AI, and your review does not need it.</div>`:`<div class="ai-foot">Shown the same on the crew tablet${e.imgs.length>1?' · Primary image analysed':''} · ${esc(a.ver||'')}</div>`;
 return `<div class="ai"><div class="ai-top"><div class="ai-title"><span class="g g-ai">AI</span>AI ECG INTERPRETATION${newTag(us)}</div><div class="ai-sub">AI interpretation is decision support only. Final STEMI decision: Cardiologist.</div></div>${newer}${aiMeta(e)}${body}${foot}</div>`;
}

/* ---------- D-06: serial comparison, ECG 1 | ECG 2 and later ECG 1 | ECG 2 | ECG 3 ---------- */
function pane(n){
 /* lead focus crops the fictional test printout; an uploaded file is shown whole */
 const e=ecgN(n),x=imgOf(e,U.cmp.imgs[n]),f=U.cmp.focus,focus=f!=='all'&&x.kind==='full'&&x.src!=='file',nofocus=f!=='all'&&!focus;
 markSeen(e,x);
 const src=focus?ECG.crop(e.variant,x.q,e.acq,f):x.url;
 return `<div class="pane"><div class="pane-t"><b>ECG ${e.n}</b><span>acquired ${hms(e.acq)}${e.n===lastEcg().n?' · Latest':''}</span></div>
  ${e.imgs.length>1?`<div class="itabs" role="group" aria-label="Image of ECG ${e.n}">${e.imgs.map(g=>`<button class="itab" data-act="pane-img" data-n="${e.n}" data-i="${g.i}" aria-pressed="${g.i===x.i}">${g.i===e.pri?'<span class="pm">Primary</span>':'Image '+g.i}</button>`).join('')}</div>`:''}
  <div class="pane-img${focus?' crop':''}"><img src="${src}" alt="ECG ${e.n}, ${imgName(e,x)}" draggable="false"></div>
  <div class="ev-cap"><b>ECG ${e.n} · ${imgName(e,x)}</b><span>photo ${hms(x.at)}</span>${nofocus?'<span>Lead focus is not available for this image (uploaded file, test build): whole ECG shown</span>':''}</div></div>`;
}
/* the serial comparison is part of each later ECG's analysis: the same words as in the case view and on the crew tablet */
function cmpAi(ns){
 const rows=ns.slice(1).map(n=>{
  const a=ecgN(n).ai;let x;
  if(!a||a.st==='proc')x={h:'AI analysis processing',t:`The analysis of ECG ${n} has not finished. Compare the original images.`};
  else if(a.st==='down')x={h:'AI interpretation unavailable',t:'Continue clinical review using the original ECG and patient information.'};
  else if(a.st==='wh'||!a.ser)x={h:'AI interpretation limited — ECG quality insufficient',t:`ECG ${n} was not suitable for analysis. Compare the original images.`};
  else x=a.ser;
  return `<div class="air imp"><span class="l">ECG ${n} vs ECG ${n-1}</span><span class="v"><b>${esc(x.h)}.</b> ${esc(x.t)}</span></div>`;
 }).join('');
 return `<div class="ai"><div class="ai-top"><div class="ai-title"><span class="g g-ai">AI</span>AI SERIAL ECG COMPARISON</div><div class="ai-sub">AI interpretation is decision support only. Final STEMI decision: Cardiologist. The ECGs stay in full view; the crew tablet shows the same comparison.</div></div><div class="ai-rows">${rows}</div></div>`;
}
const cmpSets=()=>{const n=R.ecgs.length;return n<3?[[1,2]]:n===3?[[1,2,3],[1,2],[2,3]]:[[n-2,n-1,n],[n-1,n]]};
function cmpHead(){
 const ns=U.cmp.n.join(','),sets=cmpSets();
 return `<button class="btn btn-q" data-act="cmp-back">${IC.back}Back to case</button><span class="t">Serial ECG comparison</span>${sets.length>1?`<div class="lf" role="group" aria-label="ECGs to compare">${sets.map(x=>`<button data-act="cmp-set" data-s="${x.join(',')}" aria-pressed="${x.join(',')===ns}">${x.map(n=>'ECG '+n).join(' | ')}</button>`).join('')}</div>`:''}<div class="lf" role="group" aria-label="Lead focus">${FOCUS.map(([k,l])=>`<button data-act="focus" data-k="${k}" aria-pressed="${U.cmp.focus===k}">${l}</button>`).join('')}</div><span class="sp"></span><button class="btn btn-q" data-act="hide-ai">${U.hideAI?'Show AI':'Hide AI'}</button>`;
}
function cmpBody(){
 const ns=U.cmp.n.filter(n=>ecgN(n));
 return `<div class="panes p${ns.length}">${ns.map(pane).join('')}</div>${U.hideAI?'<div class="ai-hidden">AI serial comparison hidden. <button class="lnk" data-act="hide-ai">Show AI</button></div>':cmpAi(ns)}`;
}
const cmpDec=()=>mode()==='review'?actHtml():'';
function vCmp(){
 let h=topbar()+`<div id="r-lost">${lostBand()}</div>`+caseHeader()+`<div id="r-bands">${bandsHtml()}</div><div id="r-strip">${stripMini()}</div>`;
 h+=`<div class="cmp"><div class="cmp-h" id="r-cmph">${cmpHead()}</div><div class="cmp-b" data-keep="cmpb" id="r-cmpb">${cmpBody()}</div><div class="${DEV==='phone'?'pbar':'cmp-dec'}" id="r-cmpd">${cmpDec()}</div></div>`;
 return h;
}

/* ---------- which screen ---------- */
function vDoc(){
 if(!R||!sub()||!acked()||U.scr==='queue')return vQueue();
 if(U.scr==='cmp'&&R.ecgs.length>1)return vCmp();
 U.scr='case';return vCase();
}

/* ---------- dialogs, drawer and full-screen viewer. On a phone a dialog is a bottom sheet ---------- */
const dlg=(body,cls,label)=>`<div class="scrim" data-act="close"></div><div class="dlg${cls?' '+cls:''}" tabindex="-1" role="dialog" aria-modal="true"${label?` aria-label="${label}"`:''}>${body}</div>`;
const cancelBtn='<button class="btn btn-q" data-act="close">Cancel</button>';
const opt=(act,k,label,on,multi)=>`<button class="opt${multi?' multi':''}" data-act="${act}" data-k="${esc(k)}" aria-pressed="${!!on}"><span class="box2">${multi&&on?IC.check:''}</span>${esc(label)}</button>`;
/* a decision covers the latest ECG, which must have been viewed first; and it cannot be sent without a connection */
function guardFoot(btn){
 const L=lastEcg();
 if(!latestSeen())return cancelBtn+`<button class="btn btn-s" data-act="view-latest">New ECG received: view ECG ${L.n} first</button>`;
 if(!NET.up)return cancelBtn+`<span class="offn">${G('warn')}No connection: the decision cannot be sent yet</span>`;
 return cancelBtn+btn;
}
function sinceOpened(){
 const o=ackAt();if(!o)return [];
 return R.upd.filter(u=>u.at>o).map(u=>({t:u.at,text:u.text,fresh:!updSeen(u)}));
}
const alsoSeen=()=>{const L=lastEcg();return R.ecgs.filter(g=>g.n<L.n&&seenEcg(g)).map(g=>g.n)};
function confirmDyn(){
 const e=lastEcg(),also=alsoSeen(),since=sinceOpened(),d=destCur();
 return `<div class="box"><b>Decision on ECG ${e.n} · acquired ${hm(e.acq)}</b>${also.length?`<span>${also.map(n=>'ECG '+n).join(' and ')} also reviewed</span>`:''}</div>
  <div class="box"><b>The crew’s tablet shows CONFIRMED STEMI at once</b><span>Activating the receiving hospital (cath lab, ED pre-alert and ACC) is connected in the next design phase, not in this update.</span></div>
  <div class="box"><b>Destination: ${d?`${HN[d.hosp]} · ${d.st==='rec'?'provisional':d.st==='chg'?'changed by the crew':'confirmed by the crew'}`:'being recommended'} · ${esc(etaLine())}</b></div>
  <div class="box new"><b>Since you opened the case at ${hm(ackAt())}</b>${since.length?since.map(i=>`<span>${i.fresh?'<span class="newtag">NEW</span> ':''}${hm(i.t)} · ${esc(i.text)}</span>`).join(''):'<span>Nothing new has arrived.</span>'}</div>`;
}
const aiUsable=()=>{const a=lastEcg().ai;return !!a&&(a.st==='ok'||a.st==='lim')};
const LAYERS={
 decide:()=>{const L=lastEcg();return dlg(`<h2>Decide on ECG ${L.n} · ${hm(L.acq)}</h2><p class="muted">Acknowledging the case was not a decision. Choose one.</p><div class="dec3"><button class="btn btn-red" data-act="d-confirm">CONFIRMED STEMI</button><button class="btn btn-q" data-act="d-not">NOT STEMI</button><button class="btn btn-q" data-act="d-repeat">UNCLEAR / REQUEST REPEAT ECG</button></div><div class="foot">${cancelBtn}</div>`,'','Decide')},
 confirm:L=>dlg(`<h2 class="red">Record CONFIRMED STEMI?</h2><div class="dyn" id="ldyn">${confirmDyn()}</div>
  <label class="lab" for="cnote">Note to the crew (optional)</label><textarea class="tin" id="cnote" rows="2">${esc(L.note)}</textarea>
  ${aiUsable()?`<span class="lab">The AI report (optional)</span><div class="rowb">${['Agree','Disagree','Did not use'].map(v=>opt('c-ai',v,v,L.ai===v)).join('')}</div>`:''}
  <div class="foot" id="lfoot">${guardFoot('<button class="btn btn-red" data-act="c-go">Confirm STEMI</button>')}</div>`,'wide','Confirmed STEMI'),
 not:L=>{const e=lastEcg();return dlg(`<h2>Record NOT STEMI for this case?</h2><div class="box"><b>Decision on ECG ${e.n} · acquired ${hm(e.acq)}</b></div>
  <span class="lab">Reason (required)</span><div class="opts">${NOT_REASONS.map(r=>opt('n-why',r,r,L.why===r)).join('')}</div>
  ${L.why==='Other (free text)'?`<textarea class="tin" id="nother" rows="2" placeholder="Describe the reason">${esc(L.other)}</textarea>`:''}
  <label class="lab" for="nadv">Advice to the crew (optional)</label><textarea class="tin" id="nadv" rows="2">${esc(L.adv)}</textarea>
  <div class="box">The crew continues standard care. The case stays open, and a new ECG can still be sent.</div>
  <div class="foot" id="lfoot">${guardFoot(`<button class="btn btn-p" data-act="n-go"${notOk(L)?'':' disabled'}>Confirm NOT STEMI</button>`)}</div>`,'wide','Not STEMI')},
 repeat:L=>dlg(`<h2>Unclear: request a repeat ECG</h2><div class="box"><b>Current ECG: ECG ${lastEcg().n} · ${hm(lastEcg().acq)}</b><span>The crew’s tablet shows the request at once. The repeat arrives here as ECG ${R.ecgs.length+1}, silently.</span></div>
  <span class="lab">Reason (optional, one or more)</span><div class="opts">${REP_REASONS.map(r=>opt('r-why',r,r,L.why.includes(r),true)).join('')}</div>
  <label class="lab" for="rins">Instruction to the crew (optional)</label><textarea class="tin" id="rins" rows="2" placeholder="For example: add V7 to V9">${esc(L.ins)}</textarea>
  <span class="lab">Repeat within (optional)</span><div class="stepper"><button data-act="r-min" data-d="-5" aria-label="Five minutes less">−</button><span class="sv">${L.within?L.within+' min':'Not set'}</span><button data-act="r-min" data-d="5" aria-label="Five minutes more">+</button></div>
  <div class="foot" id="lfoot">${guardFoot('<button class="btn btn-p" data-act="r-go">Send repeat ECG request</button>')}</div>`,'wide','Request a repeat ECG'),
 call:L=>dlg(`<h2>Calling ${UNIT} · ${CREW}</h2><p>Through the approved call route.</p><div class="box"><b class="mono" style="font-size:24px">${tick(L.at)}</b><span>Call start and end are logged. A call never changes the case state and is not a decision.</span></div><div class="foot"><span></span><button class="btn btn-slate" data-act="call-end">End call</button></div>`,'','Call'),
 tl:()=>{
  const items=R.audit.filter(e=>e.kind!=='view'&&e.t<=now()+1500).sort((x,y)=>x.t-y.t||x.i-y.i);
  return `<div class="scrim" data-act="close"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Case timeline"><div class="dr-h"><h2>Case timeline · ${caseRef()}</h2><button class="icon-btn" data-act="close" aria-label="Close">${IC.close}</button></div><div class="dr-b"><ol class="tl">${items.map(e=>`<li><span class="tm mono">${hms(e.t)}</span><span>${esc(e.text)}${e.who?`<small>${esc(e.who)}</small>`:''}</span></li>`).join('')}</ol></div></aside>`;
 },
 fs:L=>{
  const e=ecgN(L.n),x=imgOf(e,L.i);
  markSeen(e,x);
  const src=x.url;
  return `<div class="fs" role="dialog" aria-modal="true" aria-label="Full-screen ECG"><div class="fs-h">${R.ecgs.length>1?`<div class="etabs">${R.ecgs.map(g=>`<button class="etab" data-act="fs-ecg" data-n="${g.n}" aria-pressed="${g.n===e.n}">ECG ${g.n} · ${hm(g.acq)}</button>`).join('')}</div>`:`<b>ECG ${e.n} · ${hm(e.acq)}</b>`}${e.imgs.length>1?`<div class="itabs">${e.imgs.map(g=>`<button class="itab" data-act="fs-img" data-i="${g.i}" aria-pressed="${g.i===x.i}">${g.i===e.pri?'<span class="pm">Primary</span> image':'Image '+g.i}</button>`).join('')}</div>`:''}<span class="sp"></span><button class="icon-btn" data-act="fs-z" data-d="-1" aria-label="Zoom out"${L.z<=1?' disabled':''}>${IC.minus}</button><button class="icon-btn" data-act="fs-z" data-d="1" aria-label="Zoom in"${L.z>=3?' disabled':''}>${IC.plus}</button><button class="icon-btn" data-act="close" aria-label="Close full screen">${IC.close}</button></div>
  <div class="fs-b"><img src="${src}" alt="ECG ${e.n}, ${imgName(e,x)}" style="width:${L.z*100}%" draggable="false"></div>
  <div class="fs-f">${caseRef()} · ${UNIT} · ${esc(ptLine())} · ECG ${e.n} · ${imgName(e,x)} · photo ${hms(x.at)}${DEV==='phone'?' · Turn the phone sideways for a larger view':''}</div></div>`;
 }
};
const notOk=L=>!!L.why&&(L.why!=='Other (free text)'||!!L.other.trim());
function renderLayer(){
 const el=$('#layer');
 el.innerHTML=layer&&LAYERS[layer.t]?LAYERS[layer.t](layer):'';
 ticks();syncNote();
 const f=el.querySelector('.dlg,.drawer .icon-btn,.fs .icon-btn[data-act="close"]');
 if(f&&!el.contains(document.activeElement))f.focus({preventScroll:true});
}
/* live updates while a dialog is open change only its dynamic parts, so typing is never interrupted */
function layerDyn(){
 if(!layer)return;
 if(layer.t==='confirm'){const d=$('#ldyn');if(d)d.innerHTML=confirmDyn();const f=$('#lfoot');if(f)f.innerHTML=guardFoot('<button class="btn btn-red" data-act="c-go">Confirm STEMI</button>')}
 if(layer.t==='not'){const f=$('#lfoot');if(f)f.innerHTML=guardFoot(`<button class="btn btn-p" data-act="n-go"${notOk(layer)?'':' disabled'}>Confirm NOT STEMI</button>`)}
 if(layer.t==='repeat'){const f=$('#lfoot');if(f)f.innerHTML=guardFoot('<button class="btn btn-p" data-act="r-go">Send repeat ECG request</button>')}
 if(layer.t==='tl'){const b=$('#layer .dr-b'),st=b?b.scrollTop:0;renderLayer();const b2=$('#layer .dr-b');if(b2)b2.scrollTop=st}
 if(layer.t==='fs'&&layer.nE!==R.ecgs.length){layer.nE=R.ecgs.length;renderLayer()}
}

/* ---------- the NEW CARDIAC CASE alert: its own layer above everything, until ACKNOWLEDGE & OPEN ---------- */
function renderAlert(){
 const el=$('#alertl');if(!el)return;
 const on=alertOn(),h=on?vAlert():'';
 if(el._h===h)return;
 const first=on&&!el._h;
 el.innerHTML=h;el._h=h;ticks();
 if(first){const b=el.querySelector('.nca-go');if(b)b.focus({preventScroll:true})}
}

/* ---------- rendering: the case workspace is patched region by region, so the ECG keeps its zoom and position ---------- */
let lastSig='',lastScr='';
const sigNow=()=>`${DEV}|${!R||!sub()||!acked()||U.scr==='queue'?'queue':U.scr==='cmp'&&R.ecgs.length>1?'cmp':'case'}`;
function patch(id,html){const el=document.getElementById(id);if(el&&el._h!==html){el.innerHTML=html;el._h=html}}
function swap(sel,html){const el=$(sel);if(el&&el._h!==html){el.outerHTML=html;const n=$(sel);if(n)n._h=html}}
function render(){
 const v=$('#view');if(!v)return;
 const sig=sigNow();
 if(sig===lastSig&&!sig.endsWith('queue')&&$('#r-head')){patchCase(sig.endsWith('cmp'));after();return}
 const same=sig===lastSig,keep={};
 if(same)$$('[data-keep]',v).forEach(el=>keep[el.dataset.keep]=el.scrollTop);
 v.innerHTML=vDoc();lastSig=sigNow();
 if(same)$$('[data-keep]',v).forEach(el=>{if(keep[el.dataset.keep])el.scrollTop=keep[el.dataset.keep]});
 restoreEv();after();
}
function patchCase(cmp){
 swap('#view .tb',topbar());
 patch('r-lost',lostBand());
 swap('#r-head',caseHeader());
 patch('r-bands',bandsHtml());patch('r-strip',cmp?stripMini():stripHtml());
 if(cmp){patch('r-cmph',cmpHead());patch('r-cmpb',cmpBody());patch('r-cmpd',cmpDec())}
 else{patch('r-ecg',ecgBody());patch('r-cli',cliBody());patch('r-ai',aiBody());patch('r-act',actHtml())}
 restoreEv();
}
/* at 100% the whole ECG fits the viewer; zoom multiplies that. Measured here, because the viewer's height depends on what sits above it */
function fitEv(s){if(DEV==='phone')return;const i=s.querySelector('img'),w=s.offsetWidth,h=s.offsetHeight;if(!i||!w||!h)return;const px=Math.round(Math.min(w,h*1600/1050)*U.zoom)+'px';if(i.style.width!==px)i.style.width=px}
function restoreEv(){const s=$('#r-ecg .ev-scroll');if(s){fitEv(s);s.scrollLeft=U.sx||0;s.scrollTop=U.sy||0}}
function after(){ticks();renderAlert();syncNote();layerDyn();syncAlarm()}
/* the screen in view goes to the page, which shows its spec beside the device */
function syncNote(){const id=scrId();if(id!==lastScr){lastScr=id;post({t:'screen',id})}}
const ZL=[1,1.5,2,3];
function zoom(d){
 const i=Math.max(0,Math.min(ZL.length-1,ZL.indexOf(U.zoom)+d)),nz=ZL[i],old=U.zoom;if(nz===old)return;
 const s=$('#r-ecg .ev-scroll'),cx=s?(s.scrollLeft+s.clientWidth/2)/old:0,cy=s?(s.scrollTop+s.clientHeight/2)/old:0;
 U.zoom=nz;patch('r-ecg',ecgBody());
 const s2=$('#r-ecg .ev-scroll');if(s2){fitEv(s2);s2.scrollLeft=cx*nz-s2.clientWidth/2;s2.scrollTop=cy*nz-s2.clientHeight/2;U.sx=s2.scrollLeft;U.sy=s2.scrollTop}
}
function toEcgTop(){if(DEV!=='phone')return;const rv=$('#view .rv');if(rv)rv.scrollTop=0}
function openCmp(){
 const n=R.ecgs.length;if(n<2)return;
 U.cmp.n=cmpSets()[0];U.scr='cmp';
 op('compare',{ns:U.cmp.n});
}
let toastT=null;
function toast(msg){const t=$('#toast');if(!t)return;t.className='toast';t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>{t.hidden=true},3200)}

/* ---------- ACKNOWLEDGE & OPEN: the only thing that stops the alarm. It is not a STEMI decision ---------- */
function acknowledge(){
 if(!R||!alertOn()||!NET.up)return;
 const t=now();
 const o=op('ack',{},t);if(!o)return;
 U.ackAt=t;
 /* the alarm stops at once on this phone; if the platform did not record the acknowledgement it starts again */
 o.p.then(ok=>{if(!ok&&!(R&&R.ack)){U.ackAt=null;U.scr='queue';render();toast('ACKNOWLEDGE did not reach the platform. The alarm continues: press ACKNOWLEDGE & OPEN again.')}});
 layer=null;renderLayer();
 U.scr='case';U.ecg=lastEcg().n;U.zoom=1;U.sx=U.sy=0;
 render();toEcgTop();
}
function markUpdSeen(ids){
 const t=now(),fresh=ids.filter(id=>{const u=R.upd.find(x=>x.id===id);return u&&!updSeen(u)});
 if(!fresh.length)return;
 fresh.forEach(id=>{U.seen[id]=t});
 op('seen',{ids:fresh},t);
 render();
}
/* a decision goes to the platform, which delivers it to the crew; the screen updates when the record comes back */
function decide(k,extra){
 if(!NET.up||!latestSeen())return false;
 const L=lastEcg();
 const o=op('decision',{k,on:L.n,also:alsoSeen(),...extra});if(!o)return false;
 o.p.then(ok=>{if(!ok)toast('Your decision did NOT reach the platform and the crew has not received it. Record it again.')});
 U.newDec=false;layer=null;renderLayer();
 toast(k==='confirm'?'CONFIRMED STEMI sent to the crew':k==='not'?'NOT STEMI sent to the crew':'Repeat ECG request sent to the crew');
 return true;
}

/* ---------- actions inside the device ---------- */
function act(a,el){
 const d=(el&&el.dataset)||{},t=now();
 switch(a){
  case 'close':if(layer&&layer.t==='call')return endCall();layer=null;renderLayer();return;
  case 'nav':U.scr=d.k==='case'&&acked()?(U.last==='cmp'&&R.ecgs.length>1?'cmp':'case'):'queue';if(U.scr!=='queue')U.last=U.scr;render();return;
  case 'ack':acknowledge();return;
  case 'open':U.scr=U.last==='cmp'&&R.ecgs.length>1?'cmp':'case';render();return;
  case 'timeline':layer={t:'tl'};renderLayer();return;
  case 'ecg':U.ecg=+d.n;U.sx=U.sy=0;U.zoom=1;U.scr='case';U.last='case';render();toEcgTop();return;
  case 'img':U.img[U.ecg]=+d.i;U.sx=U.sy=0;U.zoom=1;render();return;
  case 'img-go':U.ecg=+d.n;U.img[U.ecg]=+d.i;U.sx=U.sy=0;U.zoom=1;U.scr='case';U.last='case';render();toEcgTop();return;
  case 'zoom':zoom(+d.d);return;
  case 'fs':{const e=ecgN(U.ecg)||lastEcg();layer={t:'fs',n:e.n,i:U.img[e.n]||e.pri,z:1,nE:R.ecgs.length};renderLayer();return}
  case 'cmp':openCmp();U.last='cmp';render();return;
  case 'cmp-back':U.scr='case';U.last='case';render();return;
  case 'cmp-set':U.cmp.n=d.s.split(',').map(Number);op('compare',{ns:U.cmp.n});render();return;
  case 'focus':U.cmp.focus=d.k;render();return;
  case 'hide-ai':U.hideAI=!U.hideAI;op('note',{text:`AI serial comparison ${U.hideAI?'hidden':'shown'} by ${ME}`});render();return;
  case 'pane-img':U.cmp.imgs[+d.n]=+d.i;render();return;
  case 'src':U.src=U.src===d.k?null:d.k;patch('r-ai',aiBody());return;
  case 'seen':markUpdSeen([d.id]);return;
  case 'seen-ids':markUpdSeen(d.ids.split(','));return;
  case 'seen-all':markUpdSeen(unseen().filter(u=>u.kind!=='ecg'&&u.kind!=='img').map(u=>u.id));return;
  case 'decide':layer={t:'decide'};renderLayer();return;
  case 'd-confirm':layer={t:'confirm',ai:null,note:''};renderLayer();return;
  case 'd-not':layer={t:'not',why:null,other:'',adv:''};renderLayer();return;
  case 'd-repeat':layer={t:'repeat',why:[],ins:'',within:null};renderLayer();return;
  case 'c-ai':layer.ai=layer.ai===d.k?null:d.k;renderLayer();return;
  case 'c-go':decide('confirm',{note:layer.note.trim(),ai:layer.ai});return;
  case 'view-latest':layer=null;renderLayer();U.ecg=lastEcg().n;U.img[U.ecg]=null;U.scr='case';U.last='case';render();toEcgTop();return;
  case 'n-why':layer.why=d.k;renderLayer();return;
  case 'n-go':if(!notOk(layer))return;decide('not',{reason:layer.why==='Other (free text)'?layer.other.trim():layer.why,adv:layer.adv.trim()});return;
  case 'r-why':{const i=layer.why.indexOf(d.k);if(i<0)layer.why.push(d.k);else layer.why.splice(i,1);renderLayer();return}
  case 'r-min':layer.within=Math.max(0,(layer.within||0)+(+d.d))||null;renderLayer();return;
  case 'r-go':decide('repeat',{reasons:layer.why.slice(),instr:layer.ins.trim(),within:layer.within});return;
  case 'newdec':U.newDec=true;render();return;
  case 'call':layer={t:'call',at:t};op('call',{});renderLayer();return;
  case 'call-end':endCall();return;
  case 'fs-ecg':layer.n=+d.n;layer.i=ecgN(layer.n).pri;renderLayer();U.ecg=layer.n;render();return;
  case 'fs-img':layer.i=+d.i;renderLayer();U.img[layer.n]=layer.i;render();return;
  case 'fs-z':{
   const b=$('#layer .fs-b'),cx=b?(b.scrollLeft+b.clientWidth/2)/b.scrollWidth:.5,cy=b?(b.scrollTop+b.clientHeight/2)/b.scrollHeight:.5;
   layer.z=ZL[Math.max(0,Math.min(ZL.length-1,ZL.indexOf(layer.z)+(+d.d)))];renderLayer();
   const b2=$('#layer .fs-b');if(b2){b2.scrollLeft=cx*b2.scrollWidth-b2.clientWidth/2;b2.scrollTop=cy*b2.scrollHeight-b2.clientHeight/2}return;
  }
 }
}
function endCall(){if(layer&&layer.t==='call')op('call',{end:true,len:dur(now()-layer.at)});layer=null;renderLayer()}

/* ---------- the demonstration driver asks this device to do what Dr X would do ---------- */
function cmd(k){
 if(!R||!sub())return;
 switch(k){
  case 'ack':acknowledge();return;
  case 'compare':
   if(!acked())acknowledge();
   if(R.ecgs.length<2)return;
   layer=null;renderLayer();openCmp();U.last='cmp';render();return;
  case 'decide':
   if(!acked())acknowledge();
   if(mode()!=='review')return;
   layer=null;renderLayer();
   U.ecg=lastEcg().n;U.scr='case';U.last='case';render();toEcgTop();
   act('d-confirm');
   setT(2000,()=>{if(layer&&layer.t==='confirm'&&aiUsable()){layer.ai='Agree';renderLayer()}
    setT(1100,()=>{if(layer&&layer.t==='confirm')act('c-go')})});
   return;
 }
}

/* ---------- the link to the platform ---------- */
function onSnap(rec,at){
 R=rec;NET.last=at;
 if(R){UNIT=R.unit;EMIRATE=R.emirate;CREWT=R.crew;CREW=String(R.crew||'').split(',')[0]}
 render();
 /* the alert has reached this device and is on screen: the platform starts the alarm from this moment */
 if(alertOn()&&!R.alert.dlv&&!U.alertShown&&NET.up&&op('shown'))U.alertShown=true;
}
function onMsg(m){
 switch(m.t){
  case 'init':{clearTimers();T0=m.T0;base=m.base;CAD=m.cad||CAD;EPOCH=m.epoch||'';R=null;U=newU();layer=null;lastSig='';lastScr='';NET.last=null;NET.up=true;$('#layer').innerHTML='';const al=$('#alertl');al.innerHTML='';al._h='';render();break}
  case 'clock':T0=m.T0;base=m.base;break;
  case 'cfg':{
   const ids=!!m.sim.ids;
   if(ids!==SC.ids){SC.ids=ids;lastSig='';render();const al=$('#alertl');al._h='';renderAlert();if(layer)renderLayer()}
   break;
  }
  case 'snap':onSnap(m.rec,m.at);break;
  case 'hb':NET.last=m.at;$$('[data-tick="sync"]').forEach(el=>el.textContent='Last update '+hms(NET.last));break;
  case 'net':if(NET.up!==!!m.up){NET.up=!!m.up;render();if(layer)renderLayer()}break;
 }
}

/* ---------- events ---------- */
$('#device').addEventListener('click',e=>{
 const t=e.target.closest('[data-act],[data-note]');if(!t||t.disabled)return;
 if(t.dataset.note){post({t:'note',id:t.dataset.note});return}
 act(t.dataset.act,t);
});
$('#device').addEventListener('input',e=>{
 const id=e.target.id,v=e.target.value;if(!layer)return;
 const k={cnote:'note',nother:'other',nadv:'adv',rins:'ins'}[id];if(!k)return;
 layer[k]=v;
 if(layer.t==='not'){const b=$('[data-act="n-go"]');if(b)b.disabled=!notOk(layer)}
});
$('#device').addEventListener('scroll',e=>{const s=e.target;if(s.classList&&s.classList.contains('ev-scroll')){U.sx=s.scrollLeft;U.sy=s.scrollTop}},true);
let drag=null,devScale=1;
$('#device').addEventListener('pointerdown',e=>{const s=e.target.closest('.ev-scroll,.fs-b');if(!s||e.button!==0||e.target.closest('button'))return;drag={s,x:e.clientX,y:e.clientY,l:s.scrollLeft,t:s.scrollTop,k:devScale||1};try{s.setPointerCapture(e.pointerId)}catch(_){}});
$('#device').addEventListener('pointermove',e=>{if(!drag)return;drag.s.scrollLeft=drag.l-(e.clientX-drag.x)/drag.k;drag.s.scrollTop=drag.t-(e.clientY-drag.y)/drag.k});
const endDrag=()=>{drag=null};
$('#device').addEventListener('pointerup',endDrag);$('#device').addEventListener('pointercancel',endDrag);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&layer){act('close')}});

/* ---------- ticking clocks and counters ---------- */
setInterval(()=>{
 const n=now();
 $$('[data-tick="clock"]').forEach(el=>{const v=hm(n);if(el.textContent!==v)el.textContent=v});
 ticks();
},500);

/* ---------- device fit: the device is drawn at its design size and scaled to the frame ---------- */
/* a phone gets the approved phone layout filling its screen (portrait or landscape); a larger screen gets the tablet
   or workstation layout at its design size, scaled to the window. ?dev=phone|tablet|ws forces one for testing */
const DEVS={phone:[390,844],tablet:[1180,820],ws:[1440,900]};
function pickDev(){
 const q=new URLSearchParams(location.search).get('dev');if(DEVS[q])return q;
 return Math.min(screen.width,screen.height)<600?'phone':innerWidth>=1500?'ws':'tablet';
}
function fit(){
 const nd=pickDev();if(nd!==DEV){DEV=nd;SC.dev=nd;lastSig=''}
 const st=$('#stage'),dv=$('#device');
 dv.className='device dev-'+DEV;
 document.body.classList.toggle('app-phone',DEV==='phone');
 if(DEV==='phone'){devScale=1;dv.style.transform='';dv.style.left='';st.style.height='';return}
 const [dw,dh]=DEVS[DEV],w=document.documentElement.clientWidth,h=innerHeight;
 const s=Math.min(w/dw,h/dh);devScale=s;
 dv.style.transform=`scale(${s})`;dv.style.left=Math.max(0,(w-dw*s)/2)+'px';st.style.height=Math.ceil(dh*s)+'px';
}
addEventListener('resize',()=>{const d=DEV;fit();if(d!==DEV){render();const al=$('#alertl');al._h='';renderAlert();if(layer)renderLayer()}});

/* ---------- the audible NEW CARDIAC CASE alarm (Web Audio in this page). It sounds only while a new case is on this
   screen and not yet acknowledged; ACKNOWLEDGE & OPEN is the only thing that stops it. Nothing else ever sounds.
   Production must not rely on browser sound: managed push and background notification are required (see docs). ---------- */
let AC=null,alarmT=null;
function ensureAC(){
 try{
  /* Safari 17+: play even when the ring/silent switch is on silent */
  if(navigator.audioSession&&navigator.audioSession.type!=='playback')navigator.audioSession.type='playback';
  if(!AC)AC=new (window.AudioContext||window.webkitAudioContext)();
  if(AC.state!=='running')AC.resume().then(syncAlarm,()=>{});
 }catch(_){}
}
function beep(f,t0,d){const o=AC.createOscillator(),g=AC.createGain();o.type='square';o.frequency.value=f;g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(.16,t0+.012);g.gain.setValueAtTime(.16,t0+d-.03);g.gain.linearRampToValueAtTime(0,t0+d);o.connect(g);g.connect(AC.destination);o.start(t0);o.stop(t0+d+.02)}
function pattern(){if(!AC||AC.state!=='running')return;const t=AC.currentTime+.03;[[988,0],[740,.2],[988,.4],[740,.6]].forEach(([f,d])=>beep(f,t+d,.17))}
const alarmWanted=()=>!!(R&&sub()&&alertOn());
function syncAlarm(){
 const want=alarmWanted();
 if(want&&!alarmT){pattern();alarmT=setInterval(pattern,1600)}
 if(!want&&alarmT){clearInterval(alarmT);alarmT=null}
 const w=$('#sndwarn');if(w)w.hidden=!(want&&(!AC||AC.state!=='running'));
}
/* iOS suspends sound in a page that went to the background: any tap brings it back */
document.addEventListener('pointerdown',ensureAC,true);
document.addEventListener('touchend',ensureAC,true);
document.addEventListener('keydown',ensureAC,true);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&AC&&AC.state!=='running')AC.resume().then(syncAlarm,()=>{});syncAlarm()});
setInterval(syncAlarm,1000);
/* the start screen: one tap allows the alarm sound on this phone (browsers block sound until the user taps) */
$('#gate-go').addEventListener('click',()=>{ensureAC();setTimeout(()=>{pattern()},80);$('#gate').hidden=true;syncAlarm()});

U=newU();
fit();render();
LIVE=Live({onMsg});

})();
