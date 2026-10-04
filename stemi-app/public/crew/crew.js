(()=>{
'use strict';
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const RM=matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- the clock: the server's time, set when the live link opens (T0 = server time at base = this device's time) ---------- */
let T0=Date.now();
let base=Date.now();
const now=()=>T0+(Date.now()-base);
const p2=n=>String(n).padStart(2,'0');
const hm=t=>{const d=new Date(t);return p2(d.getHours())+':'+p2(d.getMinutes())};
const hms=t=>{const d=new Date(t);return hm(t)+':'+p2(d.getSeconds())};
const dur=ms=>{ms=Math.max(0,ms);const s=Math.floor(ms/1000),m=Math.floor(s/60);return m>=60?Math.floor(m/60)+':'+p2(m%60)+':'+p2(s%60):m+':'+p2(s%60)};
const MIN=60000;
const rmin=t=>Math.floor(t/MIN)*MIN;
const ago=t=>{const m=Math.round((now()-t)/MIN);if(m<=0)return 'now';if(m<60)return m+' min ago';return Math.floor(m/60)+' h '+(m%60?m%60+' min ':'')+'ago'};

/* ---------- icons ---------- */
const S=p=>`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${p}</svg>`;
const IC={
 check:S('<path d="M5 12.6l4.3 4.3L19.2 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'),
 person:S('<circle cx="12" cy="8.2" r="3.7" fill="currentColor"/><path d="M4.6 20c.8-3.8 3.7-5.9 7.4-5.9s6.6 2.1 7.4 5.9z" fill="currentColor"/>'),
 info:S('<circle cx="12" cy="6.8" r="1.7" fill="currentColor"/><path d="M12 10.6v7.4" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>'),
 warn:S('<path d="M12 3.3L21.8 20.4H2.2z" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"/><path d="M12 9.6v5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.35" fill="currentColor"/>'),
 bang:S('<path d="M12 5.6v8.2" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><circle cx="12" cy="18.2" r="1.9" fill="currentColor"/>'),
 slash:S('<circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="2.3"/><path d="M6.3 17.7L17.7 6.3" stroke="currentColor" stroke-width="2.3"/>'),
 home:S('<path d="M3.5 11.2L12 4l8.5 7.2V20h-6v-5.5h-5V20h-6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'),
 plus:S('<path d="M12 4.5v15M4.5 12h15" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>'),
 cam:S('<path d="M4 7.5h3.2L9 5h6l1.8 2.5H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12.8" r="3.6" fill="none" stroke="currentColor" stroke-width="2"/>'),
 lock:S('<rect x="5" y="10.5" width="14" height="10" rx="1.6" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.2"/>'),
 send:S('<path d="M4 12h13M12.5 6.5L18 12l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>'),
 back:S('<path d="M19 12H6M11.5 6.5L6 12l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'),
 close:S('<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'),
 del:S('<path d="M9 6h11v12H9l-6-6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 9.5l5 5M17 9.5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
 scan:S('<path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M7.5 8.5v7M10 8.5v7M12.5 8.5v7M15.5 8.5v7" stroke="currentColor" stroke-width="1.8"/>'),
 hosp:S('<path d="M4 20V7.2l8-3.2 8 3.2V20z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 8.5v6.5M8.8 11.7h6.4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
 ecg:S('<path d="M2 13h4l2-5 3 10 2.5-13 2.5 8h6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
 light:S('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'),
 up:S('<path d="M12 16V5M7 9.5L12 4.5l5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 15v4.5h15V15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>'),
 zoom:S('<circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15 15l5 5M10.5 8v5M8 10.5h5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>')
};
const G=k=>`<span class="g g-${k}" aria-hidden="true">${({done:IC.check,ack:IC.person,info:IC.info,warn:IC.warn,fail:IC.bang,nv:IC.slash})[k]||''}</span>`;
const nvChip=t=>`<span class="nvc">${IC.slash}${esc(t)}</span>`;

/* ---------- fictional reference data ---------- */
/* the logged-in test user (crew@test.local): fictional */
const AU=window.APP.user;
const UNIT=AU.unit||'Ambulance', EMIRATE=AU.emirate||'', ME=AU.name, ROLE=AU.title;
/* the CAD number of this tablet's case. The EMT enters it manually from the MDT / dispatch information when opening the
   STEMI pathway (no CAD integration in this phase, Q-70); CADN (shared/cad.js) normalises and checks it, as the server does.
   CASE.srv is false while the case exists on this tablet only: the platform creates it under the CAD number at the first Send. */
let CAD='',EPOCH='';
const CADN=window.CADN;
const HOSP={
 A:{name:'PCI Hospital A',eta:18,doc:'Dr X'},
 B:{name:'PCI Hospital B',eta:26,doc:'Dr Z'},
 C:{name:'PCI Hospital C',eta:34,doc:'Dr W'}
};
const COMPLAINTS=[
 {id:'cp',l:'Chest pain or discomfort',s:'Chest pain'},
 {id:'sob',l:'Shortness of breath',s:'Shortness of breath'},
 {id:'epi',l:'Epigastric or upper abdominal pain',s:'Epigastric pain'},
 {id:'syn',l:'Collapse or syncope',s:'Collapse or syncope'},
 {id:'pal',l:'Palpitations',s:'Palpitations'},
 {id:'ecg',l:'Abnormal ECG on the monitor',s:'Abnormal ECG'},
 {id:'oth',l:'Other (describe)',s:'Other'}
];
const MD=[
 {k:'age',label:'Age',kind:'num',unit:'years',nv:['Unknown']},
 {k:'sex',label:'Sex',kind:'sex',nv:['Unknown']},
 {k:'complaint',label:'Presenting complaint',sub:'or reason for ECG',kind:'complaint',nv:[]},
 {k:'onset',label:'Symptom onset',kind:'time',nv:['Unknown']},
 {k:'bp',label:'Latest BP',kind:'bp',unit:'mmHg',nv:['Not obtained','Unable to obtain']},
 {k:'hr',label:'Heart rate',kind:'num',unit:'bpm',nv:['Not obtained','Unable to obtain']},
 {k:'spo2',label:'SpO₂',kind:'num',unit:'%',nv:['Not obtained','Unable to obtain']},
 {k:'gcs',label:'GCS',kind:'gcs',nv:['Unable to assess','Not obtained']}
];
const MDK=Object.fromEntries(MD.map(f=>[f.k,f]));
const QUAL={
 good:{k:'good',g:'info',t:'Suitable',body:'<p>All 12 leads, calibration pulse and rhythm strip visible.</p>',checks:[['done','12 leads visible'],['done','Calibration pulse'],['done','Readable'],['done','No glare'],['done','No leads obscured']],server:'complete'},
 glare:{k:'lim',g:'warn',t:'Limited',body:'<p><b>Glare over limb leads I, II, III.</b></p><p>The cardiologist gets the ECG as it is. The AI may report only part of it.</p>',checks:[['done','12 leads visible'],['done','Calibration pulse'],['done','Readable'],['warn','Glare: I, II, III'],['done','No leads obscured']],server:'limited',issue:'glare over limb leads I, II, III'},
 /* an image file uploaded from this computer: this test build does not check it, and says so */
 file:{k:'good',g:'info',t:'Not checked',body:'<p><b>Uploaded image file.</b></p><p>This test build does not check uploaded images. The cardiologist gets the image as it is.</p>',checks:[['info','Image check not run on uploaded files (test build)']],server:'complete'},
 cut:{k:'bad',g:'warn',t:'Not suitable',body:'<p><b>Leads V4 to V6 cut off.</b></p><p>The cardiologist still gets this ECG. The AI will not interpret it. Send now and send a repeat ECG when you can.</p>',checks:[['warn','V4 to V6 cut off'],['done','Calibration pulse'],['done','Readable'],['done','No glare'],['done','No leads obscured']],server:'withheld',issue:'leads V4 to V6 cut off'}
};

/* crew pick lists here are illustrative only (Q-56); dose defaults come from the case example in the brief */
const REC=[
 {g:'Treatments given',items:[
  {id:'asp',label:'Aspirin',ev:'Aspirin documented',opts:[
    {l:'Given',dose:'300 mg',time:1,sum:L=>`Given · ${L.dose||'dose not entered'} · ${hm(L.at)}`},
    {l:'Taken before our arrival',sum:()=>'Taken before our arrival'},
    {l:'Not given',sum:()=>'Not given'}]},
  {id:'gtn',label:'GTN',ev:'GTN documented',opts:[
    {l:'Given',dose:'0.4 mg sublingual',time:1,sum:L=>`Given · ${L.dose||'dose not entered'} · ${hm(L.at)}`},
    {l:'Not given',sum:()=>'Not given'}]},
  {id:'ana',label:'Analgesia',ev:'Analgesia documented',opts:[
    {l:'Given',text:'Drug, dose and route',time:1,need:'text',sum:L=>`Given · ${L.text} · ${hm(L.at)}`},
    {l:'Not given',sum:()=>'Not given'}]},
  {id:'otx',label:'Other medications and treatments',ev:'Treatment documented',opts:[
    {l:'Add a treatment',text:'What was given',time:1,need:'text',sum:L=>`${L.text} · ${hm(L.at)}`},
    {l:'None',sum:()=>'None'}]}
 ]},
 {g:'Risks',items:[
  {id:'anti',label:'Anticoagulants',ev:'Anticoagulants documented',opts:[
    {l:'None',sum:()=>'None'},
    {l:'Takes an anticoagulant',chips:['Warfarin','Apixaban','Rivaroxaban','Dabigatran','Edoxaban','Other'],need:'chips',sum:L=>`Takes ${[...L.chips].join(', ')}`},
    {l:'Unknown',nv:1}]},
  {id:'all',label:'Allergies',ev:'Allergies documented',opts:[
    {l:'No known allergies',sum:()=>'No known allergies'},
    {l:'Has allergies',text:'Allergies and reaction',need:'text',sum:L=>`Allergies: ${L.text}`},
    {l:'Unknown',nv:1}]}
 ]},
 {g:'Observations',items:[
  {id:'obs',label:'Full set of observations',ev:'Observations added',multi:1,hide:1,opts:[
    {l:'Add a set',vitals:1,time:1,need:'vitals',sum:L=>`BP ${L.parts[0].v}/${L.parts[1].v} · HR ${L.parts[2].v} · SpO₂ ${L.parts[3].v} % · ${hm(L.at)}`}]},
  {id:'rr',label:'Respiratory rate',ev:'RR added',opts:[
    {l:'Enter',num:'/min',time:1,need:'num',sum:L=>`${L.parts[0].v} /min · ${hm(L.at)}`},
    {l:'Not obtained',nv:1},{l:'Unable to obtain',nv:1}]},
  {id:'tmp',label:'Temperature',ev:'Temperature added',opts:[
    {l:'Enter',num:'°C',dec:1,time:1,need:'num',sum:L=>`${L.parts[0].v} °C · ${hm(L.at)}`},
    {l:'Not obtained',nv:1},{l:'Unable to obtain',nv:1}]},
  {id:'pain',label:'Pain assessment',ev:'Pain assessment added',opts:[
    {l:'Score 0 to 10',score:1,text:'Character, site, radiation (optional)',time:1,need:'score',sum:L=>`${L.score}/10${L.text?' · '+L.text:''} · ${hm(L.at)}`},
    {l:'Unable to assess',nv:1}]}
 ]},
 {g:'History',items:[
  {id:'pmh',label:'Past medical history',ev:'Past history added',opts:[
    {l:'Has conditions',chips:['Previous MI','PCI or stent','CABG','Diabetes','Hypertension','Kidney disease','Stroke','Other'],need:'chips',sum:L=>[...L.chips].join(', ')},
    {l:'None known',sum:()=>'None known'},
    {l:'Unknown',nv:1}]},
  {id:'hx',label:'Clinical history',ev:'Clinical history added',opts:[
    {l:'Write',text:'History of this episode',long:1,need:'text',def:'Central crushing chest pain with sweating and nausea. Onset about 35 minutes before our arrival.',sum:L=>L.text}]}
 ]},
 {g:'Condition and comments',items:[
  {id:'cond',label:'Patient condition',ev:'Patient condition updated',multi:1,opts:[
    {l:'Improved',text:'Details (optional)',time:1,sum:L=>`Improved${L.text?' · '+L.text:''} · ${hm(L.at)}`},
    {l:'Unchanged',text:'Details (optional)',time:1,sum:L=>`Unchanged${L.text?' · '+L.text:''} · ${hm(L.at)}`},
    {l:'Deteriorated',text:'What changed',time:1,need:'text',sum:L=>`Deteriorated · ${L.text} · ${hm(L.at)}`}]},
  {id:'cmt',label:'Comment to the cardiologist',ev:'Crew comment added',multi:1,opts:[
    {l:'Write',text:'Comment',long:1,need:'text',sum:L=>L.text}]}
 ]},
 {g:'Times',items:[
  {id:'fmc',label:'First medical contact',q:'Q-03',ev:'First medical contact recorded',opts:[
    {l:'Set time',tpick:1,sum:L=>hm(L.tm)}]}
 ]},
 {g:'Transport',items:[{id:'dst',label:'Destination and ETA',auto:'dest'}]},
 {g:'Handover',items:[{id:'ho',label:'Handover information',later:'Completed at handover'}]}
];
const RECK=Object.fromEntries(REC.flatMap(g=>g.items).map(i=>[i.id,i]));

/* ---------- state ---------- */
const SC0={online:false,related:false,quality:'good',receipt:'ok',ai:'ok',hospA:'fresh',ids:false,orient:'auto',light:false};
/* SC.online mirrors the tablet's link to the platform (set by the page's Connection control) */
let SC={...SC0};
let lastView=null, lastCase=null;
let CASE=null, view='C-01', focus='C-07', layer=null, ntab='screen', noteId='', timers=[];
const setT=(ms,fn)=>{const id=setTimeout(()=>{timers=timers.filter(x=>x!==id);fn()},ms);timers.push(id);return id};
const clearTimers=()=>{timers.forEach(clearTimeout);timers=[]};

function newCase(){
  return {openedAt:now(),savedAt:now(),cad:'',cadAt:null,cadHist:[],cadEdit:{val:'',err:'',detail:'',busy:false},cadDup:null,srv:false,cid:'t'+rid()+rid(),life:{},related:false,relBanner:false,
    md:{age:null,sex:null,complaint:null,onset:null,bp:null,hr:null,spo2:null,gcs:null},mdDone:false,mdh:{},
    ecgs:[],draft:null,state:'DRAFT',waitFrom:null,alert:null,ack:null,opened:null,esc:[],rem:[],decs:[],dest:null,rec:{},events:[],failure:null,repeatAsked:false,repeatFor:null,cancelled:false,aiSel:null,aiNew:null};
}

/* ---------- the live link to the platform: operations go up, the shared case record (SRV) comes down.
   Nothing here decides anything clinical; it only carries what the crew saved and what the platform recorded. ---------- */
let SRV=null,OUTQ=[],opSeq=0,lastSync=null;
let LIVE=null,flushing=false;
const rid=()=>Math.random().toString(36).slice(2,10);
/* actions go to the server; one that cannot be delivered waits on this tablet, in order, and is sent on reconnection */
function sendOps(ops){
  LIVE.send(ops).then(r=>{(r.results||[]).forEach(x=>{if(!x.ok)toast(esc(x.error||'The server did not accept this entry'),true)})},
    ()=>{OUTQ.unshift(...ops);saveLocal()});
}
/* entries saved before the platform has created the case wait on the tablet until it has */
const localOnly=()=>!!CASE&&CASE.srv===false;
function flush(){
  if(flushing||!OUTQ.length||!SC.online||localOnly())return;
  flushing=true;const q=OUTQ.splice(0);saveLocal();
  LIVE.send(q).then(r=>{(r.results||[]).forEach(x=>{if(!x.ok)toast(esc(x.error||'The server did not accept this entry'),true)})},()=>{OUTQ.unshift(...q)}).finally(()=>{flushing=false;saveLocal()});
}
const post=m=>{if(m.t==='op')sendOps([m.op]);else if(m.t==='ops')sendOps(m.ops)};
function op(k,data,t){if(CASE&&CASE.life&&CASE.life.closed){toast('This case is closed (handover completed): it is read-only.',true);return {id:''}}const o={id:'c'+rid()+'-'+(++opSeq),cad:CAD,k,data:data||{},t:t==null?now():t};if(SC.online&&!OUTQ.length&&!flushing&&!localOnly())post({t:'op',op:o});else OUTQ.push(o);saveLocal();return o}
const delivered=id=>!!(id&&SRV&&SRV.ops&&SRV.ops[id]);
const dlvAt=id=>SRV&&SRV.ops?SRV.ops[id]:null;
const ev=(text,who,t)=>{CASE.events.push({t:t==null?now():t,text,who:who||ME})};
const touch=()=>{if(!CASE)return;CASE.savedAt=now();if(!CASE.mdDone&&answered()===8){CASE.mdDone=true;CASE.mdAt=now();ev('Minimum dataset entered',ME)}};
const answered=()=>CASE?MD.filter(f=>CASE.md[f.k]).length:0;
const idText=()=>CAD?'CAD #'+CAD:'CAD number not entered';
/* the CAD number can be corrected until the case is sent; after Send it is locked (an authorised, audited correction
   after Send is not built in this phase). cadDup: the platform found a case under it, so it must be corrected or opened */
const cadLocked=()=>!!CASE&&(CASE.srv!==false||(CASE.ecgs.length>0&&!CASE.cadDup));
const focusCad=()=>setTimeout(()=>{const i=$('#cadin');if(i&&!i.disabled){i.focus();const n=i.value.length;try{i.setSelectionRange(n,n)}catch(_){}}},30);
const lastEcg=()=>CASE&&CASE.ecgs[CASE.ecgs.length-1];
/* several images per ECG: e.imgs=[{i,at,q,img}], e.pri = number of the Primary image, e.sel = the image shown large on C-05.
   An image keeps its number; a recapture takes the number of the image it replaces, and a new image takes the lowest free number. */
const MAXI=3; /* the prototype's maximum; the real maximum is configuration (Q-63) */
const priImg=e=>e.imgs.find(x=>x.i===e.pri)||e.imgs[0];
const selImg=e=>e.imgs.find(x=>x.i===e.sel)||priImg(e);
const freeSlot=e=>{let i=1;while(e.imgs.some(x=>x.i===i))i++;return i};
const ecgAt=e=>Math.min(...e.imgs.map(x=>x.at));
const nImgs=e=>e.imgs.length>1?` (${e.imgs.length} images)`:'';
const complaintShort=a=>{const c=COMPLAINTS.find(x=>x.id===a.v);return c?c.s:'';};
function ptSummary(){
  const m=CASE.md, parts=[];
  if(m.age)parts.push(m.age.nv?'Age unknown':(m.age.est?'≈ ':'')+m.age.v+' y');
  if(m.sex)parts.push(m.sex.nv?'Sex unknown':m.sex.v);
  if(m.complaint)parts.push(complaintShort(m.complaint));
  return parts.length?parts.join(' · '):'Patient details not entered yet';
}
function hospInfo(k){
  const h=HOSP[k], o=CASE?CASE.openedAt:now();
  if(k==='A'&&SC.hospA==='stale')return {...h,lab:'Unknown, not updated',labSub:'Last update 06:40',unk:true,cardio:'Available',path:'Active'};
  if(k==='A')return {...h,lab:'Available',labSub:`Updated ${hm(o-11*MIN)} by Coordinator`,cardio:'Available',path:'Active'};
  if(k==='B')return {...h,lab:'Available',labSub:`Updated ${hm(o-34*MIN)} by Coordinator`,cardio:'Available',path:'Active'};
  return {...h,lab:'Unknown, not updated',labSub:'Last update 08:10',unk:true,cardio:'Available',path:'Active'};
}
function recommend(){
  if(SC.hospA==='stale')return {hosp:'B',reason:'PCI Hospital A cath lab status is unknown (not updated since 06:40), so it is not treated as available. PCI Hospital B is the next nearest participating PCI centre within catchment; no diversion.'};
  return {hosp:'A',reason:'Nearest participating PCI centre within catchment; no diversion.'};
}
function completeness(){return !CASE||!Object.keys(CASE.rec).length?'Minimum dataset only':'Record in progress'}

/* ---------- ECG: the same fictional printout generator as the cardiologist's screen, so both devices show identical photos.
   Variants per ECG come from the page's simulation (findings); image 1 is the whole printout, 2 the chest leads, 3 the rhythm strip. ---------- */
const ECG=window.ECG,{AIROWS,AIST,aiVal,aiStLine}=window.AIX;
const KIND=['full','chest','rhythm'];
let SIMV={ai:'ok',find:'border',q:'good',receipt:'ok'};
const variantFor=n=>SIMV.find==='border'?(n===1?'border':'evolved'):(n===1?'clear':'clear2');
const shot=(v,i,q,acq)=>ECG.photo(v,KIND[(i-1)%3],i===1?q:'good',acq).url;
const guideSVG=()=>{
  const x1=80,x2=1520,y1=227,y2=973,c=48,col=[487,820,1153],row=[468,638,806];
  return `<svg class="vf-guide" viewBox="0 0 1600 1200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
   <g fill="none" stroke="rgba(255,255,255,.55)" stroke-width="3" stroke-dasharray="14 12">${row.map(y=>`<path d="M${x1} ${y}H${x2}"/>`).join('')}${col.map(xx=>`<path d="M${xx} ${y1}V${row[2]}"/>`).join('')}</g>
   <g fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"><path d="M${x1} ${y1+c}V${y1}H${x1+c}M${x2-c} ${y1}H${x2}V${y1+c}M${x2} ${y2-c}V${y2}H${x2-c}M${x1+c} ${y2}H${x1}V${y2-c}"/></g></svg>`;
};

/* ---------- rendering helpers ---------- */
const idTag=id=>SC.ids&&id?`<button class="idtag" data-note="${id}" title="Open the spec for ${id}">${id}</button>`:'';
const STATECLS={'TRANSPORTING':'review','ARRIVED':'review','HANDOVER IN PROGRESS':'await','HANDOVER COMPLETED':'done','DRAFT':'draft','TRANSMITTING':'tx','AWAITING CARDIOLOGIST':'await','UNDER REVIEW':'review','TRANSMISSION FAILED':'failed','DOWNTIME CASE':'downtime','CANCELLED':'cancelled','CONFIRMED STEMI':'conf','NOT STEMI':'review','REPEAT ECG REQUESTED':'await'};
function stateChip(){
  const s=CASE.state, k=STATECLS[s]||'draft';
  const gl=s==='HANDOVER COMPLETED'?G('done'):s==='TRANSPORTING'||s==='ARRIVED'||s==='HANDOVER IN PROGRESS'?G('ack'):s==='TRANSMITTING'?G('prog'):s==='UNDER REVIEW'?G('ack'):s==='TRANSMISSION FAILED'?G('fail'):s==='DOWNTIME CASE'?G('warn'):s==='AWAITING CARDIOLOGIST'?G('pend'):s==='NOT STEMI'?G('done'):s==='REPEAT ECG REQUESTED'?G('info'):'';
  return `<span class="chip st-${k}">${gl}${s}</span>`;
}
/* LIVE — CONNECTED with the time of the last update from the platform, or CONNECTION LOST */
const netHtml=()=>SC.online?`<span class="dot"></span><span class="nt"><b>LIVE — CONNECTED</b><small data-tick="sync">Last update ${lastSync?hms(lastSync):'–'}</small></span>`:`<span class="dot"></span><span class="nt"><b>CONNECTION LOST</b><small>Attempting to reconnect</small></span>`;
function topbar(){
  return `<div class="tb">
   <button class="tb-home" data-act="home" ${view==='C-01'?'aria-current="page"':''}>${IC.home}<span>My cases</span></button>
   <div class="tb-unit"><b>${UNIT}</b><span>${EMIRATE}</span></div><div class="sp"></div>
   <div class="tb-me">${ME} · ${ROLE}</div>
   <div class="tb-net ${SC.online?'on':'off'}" role="status">${netHtml()}</div>
   <div class="tb-clock mono" data-tick="clock">${hm(now())}</div></div>`;
}
function caseHeader(ws){
  const c=CASE;
  const l1=c.cad?`<span class="mono">CAD #${esc(c.cad)}</span><span class="cadsrc">${G('done')}${cadLocked()?'Entered manually · locked after send':'Entered manually'}</span>${cadLocked()?'':'<button class="lnk" data-act="cad-edit">Correct</button>'}`
    :`<span class="mono cad-none">CAD number not entered</span><button class="lnk" data-act="cad-edit">Enter CAD number</button>`;
  const l2=`<b>${esc(ptSummary())}</b>`;
  const add=ws?`<button class="btn btn-s" data-act="handover">Handover</button><button class="btn btn-s" data-act="add-ecg">${IC.ecg}New ECG</button>`:'';
  return `<div class="ch"><div class="ch-id"><div class="ch-l1">${l1}</div><div class="ch-l2">${l2}</div></div>
    <div class="ch-st">${stateChip()}<span class="ch-clock mono" data-tick="caseclock">Open ${dur(now()-c.openedAt)}</span>${add}</div></div>`;
}
const lostBanner=()=>SC.online?'':`<div class="lostb" role="alert">${G('warn')}<div><b>CONNECTION LOST · Attempting to reconnect.</b><span>Statuses on this screen may not be current${lastSync?` (last update ${hms(lastSync)})`:''}. Everything you save stays on this tablet and is sent, in order, when the connection returns.</span></div></div>`;
/* Hamad, 4 Oct 2026: Open STEMI pathway → enter the CAD number → capture or upload the ECG → minimum dataset → Send */
function stepper(cur){
  const c=CASE,n=answered(),cap=!!c.draft;
  const st=[
   {k:'CAD',l:'CAD number',done:!!c.cad,d:c.cad?`#${c.cad}${cadLocked()?' · locked':''}`:'Enter from the MDT'},
   {k:'C-04',l:'ECG',done:cap,d:cap?`ECG ${c.draft.n} captured${c.draft.imgs.length>1?` · ${c.draft.imgs.length} images`:''}`:'Not captured'},
   {k:'C-03',l:'Minimum dataset',done:n===8,d:`${n} of 8 answered`},
   {k:'C-05',l:'Send',done:false,d:!c.cad?'Enter the CAD number first':!cap?'Capture the ECG first':n<8?`${8-n} field${8-n>1?'s':''} still to answer`:'Ready to send'}];
  return `<nav class="steps" aria-label="Case steps">${st.map((x,i)=>`<button class="step ${cur===x.k||(cur==='C-04'&&x.k==='C-04')?'cur':''} ${x.done?'done':''}" data-act="step" data-k="${x.k}" ${cur===x.k?'aria-current="step"':''}${x.k==='CAD'&&cadLocked()?' disabled':''}><span class="step-n">${x.done?G('done'):i+1}</span><span class="step-t"><b>${x.l}</b><small>${x.d}</small></span></button>`).join('')}</nav>`;
}
const ab=(l,m,r)=>`<div class="ab"><div class="ab-l">${l||''}</div><div class="ab-m">${m||''}</div><div class="ab-r">${r||''}</div></div>`;
const savedLine=()=>`<span class="saved">${G('done')}Saved on this tablet <span class="mono">${hms(CASE.savedAt)}</span></span><span>${ME} · ${UNIT}, filled in automatically</span>`;
const failBar=()=>{const f=CASE&&CASE.failure;if(!f||f.late)return '';return `<div class="fbar" role="alert">${G('fail')}<div class="fb-t"><b>ECG not delivered. Use the STEMI downtime route.</b><span class="mono" data-tick="attempt">Retrying automatically · attempt ${f.attempts} · last try ${hms(f.last)}</span></div><button class="btn btn-inv" data-act="show-fail">Show instructions</button></div>`};
const banner=(k,t,b)=>`<div class="banner banner-${k}">${G(k)}<div><b class="bt">${t}</b>${b?`<span>${b}</span>`:''}</div></div>`;

/* ---------- C-01 ---------- */
function liveState(){
  const c=CASE,e=lastEcg(),d=lastDec();
  if(!e)return {k:'pend',t:'Draft, not sent',s:`${c.cad?'':'CAD number not entered · '}${answered()} of 8 answered · ECG ${c.draft?'captured':'not captured'}`};
  if(c.failure&&!c.failure.late)return {k:'fail',t:'ECG not delivered. Use the STEMI downtime route.',s:`Retrying automatically · attempt <span data-tick="attempt-n">${c.failure.attempts}</span>`};
  if(e.tx.stage==='check'||e.tx.stage==='up')return {k:'prog',t:`Uploading ECG ${e.n} · ${e.tx.pct||0}%`};
  if(d)return {k:d.k==='confirm'?'fail':'ack',t:`Decision received: ${DECL[d.k]}`,s:`${d.by} · ${hms(d.at)}`};
  if(c.opened)return {k:'ack',t:`${c.ack.who} is reviewing`,s:`Acknowledged ${hms(c.ack.at)} · opened the ECG ${hms(c.opened)}`};
  if(c.ack)return {k:'ack',t:`${c.ack.who} acknowledged`,s:`At ${hms(c.ack.at)}`};
  if(c.esc.length)return {k:'warn',t:c.esc[c.esc.length-1].t,s:`Waiting for cardiologist <span class="mono" data-tick="wait">${dur(now()-c.waitFrom)}</span>`};
  if(c.failure&&c.failure.late)return {k:'warn',t:'Delivered late – downtime route already in use',s:`Waiting for cardiologist <span class="mono" data-tick="wait">${dur(now()-c.waitFrom)}</span>`};
  if(c.waitFrom)return {k:'pend',t:`Waiting for cardiologist <span class="mono" data-tick="wait">${dur(now()-c.waitFrom)}</span>`,s:c.alert?`${c.alert.who} alerted at ${hms(c.alert.at)}`:''};
  return {k:'pend',t:'Sending'};
}
let histReq=0;
function vHome(){
  const c=CASE,active=c&&!c.cancelled&&!(c.life&&c.life.closed);
  if(HLIST===null&&!histReq){histReq=1;setTimeout(()=>{histReq=0;loadHist()},0)}
  let card='';
  if(active){
    const st=liveState(),d=c.dest;
    const dest=!d||d.st==='finding'?'Not recommended yet':`${d.st==='rec'?'Recommended':'Confirmed'}: ${HOSP[d.hosp].name}`;
    card=`<article class="card ${st.k==='fail'?'fail':''}"><div class="card-l">
      <div class="ch-l1"><span class="mono">${esc(idText())}</span><span class="cadsrc">${G('done')}${c.srv===false?'Draft on this tablet':'STEMI pathway open'}</span></div>
      <div><b>${esc(ptSummary())}</b></div>
      <div class="card-st k-${st.k}">${G(st.k)}<div><b>${st.t}</b>${st.s?`<small>${st.s}</small>`:''}</div></div>
      <dl class="card-f"><div><dt>Destination</dt><dd>${dest}</dd></div><div><dt>Record</dt><dd>${completeness()}</dd></div></dl></div>
      <button class="btn btn-p btn-xl" data-act="open-case">${c.ecgs.length?'Open case':'Continue case'}</button></article>
      <div class="newcase"><button class="btn btn-s btn-xl" data-act="new-case">${IC.ecg}New STEMI case</button></div>`;
  } else {
    /* no CAD integration in this phase: the EMT enters the CAD number of the call after opening the pathway. No temporary ID */
    card=`<article class="card inc"><div class="card-l">
      <div class="ch-l1"><span class="mono">New STEMI case</span></div>
      <div><b>You enter the CAD number of this call from the MDT / dispatch information.</b></div>
      <dl class="card-f"><div><dt>Unit</dt><dd>${UNIT}</dd></div><div><dt>Crew</dt><dd>${ME}</dd></div></dl></div>
      <button class="btn btn-p btn-xl" data-act="open-path">${IC.ecg}Open STEMI pathway</button></article>`;
  }
  return `<div class="home"><div class="home-main">
    <h1 class="h1">${active?'My active cases':'New case'}</h1>
    ${!SC.online?banner('warn','No connection.','You can still open the STEMI pathway, capture the ECG and enter the minimum dataset. If sending fails you will be told at once.'):''}
    ${card}
    ${histHtml()}
   </div>
   <footer class="home-foot">${G('info')}<span>Platform unavailable? Use the STEMI downtime route: <span class="ph">approved downtime number (Q-21)</span></span></footer></div>`;
}

/* ---------- keypad (value drawers) ---------- */
function keypad(extra){
  const ks=['1','2','3','4','5','6','7','8','9',extra||'','0','del'];
  return `<div class="kp">${ks.map(k=>k===''?'<span class="key blank"></span>':k==='del'?`<button class="key" data-key="del" aria-label="Delete">${IC.del}</button>`:`<button class="key ${k.length>1?'txt':''}" data-key="${k}">${k}</button>`).join('')}</div>`;
}

/* ---------- C-03 ---------- */
function fmtVal(k,a){
  if(k==='age')return `${a.est?'≈ ':''}${a.v} years${a.est?' <small>estimated</small>':''}`;
  if(k==='complaint')return `<span>${esc(complaintShort(a))}</span>${a.det?`<small>${esc(a.det)}</small>`:''}`;
  if(k==='onset')return `${hm(a.v)}${a.approx?' <small>approximate</small>':''} <small>${ago(a.v)}</small>`;
  if(k==='bp')return `${a.sys}/${a.dia} <small>mmHg · ${hm(a.at)}</small>`;
  if(k==='hr')return `${a.v} <small>bpm · ${hm(a.at)}</small>`;
  if(k==='spo2')return `${a.v} <small>% · ${hm(a.at)}</small>`;
  if(k==='gcs')return `${a.v}`;
  if(k==='sex')return a.v;
  return '';
}
function mdRow(f){
  const a=CASE.md[f.k],st=!a?'pend':a.nv?'nv':'done';
  let val;
  if(f.kind==='sex')val=['Male','Female'].map(s=>`<button class="cbtn ${a&&a.v===s?'on':''}" data-act="set" data-k="sex" data-v="${s}" aria-pressed="${!!(a&&a.v===s)}">${a&&a.v===s?IC.check:''}${s}</button>`).join('');
  else if(f.kind==='gcs'){const o=a&&a.v&&a.v!==15;
    val=`<button class="cbtn ${a&&a.v===15?'on':''}" data-act="set" data-k="gcs" data-v="15" aria-pressed="${!!(a&&a.v===15)}">${a&&a.v===15?IC.check:''}15 — Alert and orientated</button><button class="cbtn ${o?'on':''}" data-act="open" data-k="gcs">${o?IC.check+'GCS '+a.v:'Other score'}</button>`;}
  else if(a&&a.nv)val=`<button class="vbtn" data-act="open" data-k="${f.k}"><span class="inst">Enter a value instead</span></button>`;
  else val=`<button class="vbtn ${a?'set':''}" data-act="open" data-k="${f.k}">${a?fmtVal(f.k,a):'<span class="tap">Tap to enter</span>'}</button>`;
  const nvs=f.nv.map(n=>{const on=a&&a.nv===n;return `<button class="nvb ${on?'on':''}" data-act="nv" data-k="${f.k}" data-v="${n}" aria-pressed="${!!on}">${on?IC.slash:''}${n}</button>`}).join('');
  return `<div class="mr ${st==='pend'?'st-pend':''}">${G(st)}<div class="lab">${f.label}${f.sub?`<small>${f.sub}</small>`:''}</div><div class="val choice2">${val}</div><div class="nvs">${nvs}</div></div>`;
}
/* ---------- the CAD number, entered manually by the EMT ---------- */
function vCad(){
  const c=CASE,L=c.cadEdit,lock=cadLocked();
  return `<div class="vbody"><div class="cadv">
    <label class="cadv-lab" for="cadin">CAD NUMBER</label>
    <div class="cadv-row"><span class="cadv-pre mono" aria-hidden="true">CAD #</span><input class="tin cadv-in mono" id="cadin" value="${esc(L.val)}" ${lock?'disabled':''} autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="${CADN.EXAMPLE}" aria-describedby="caderr cadhint"${L.err?' aria-invalid="true"':''}></div>
    <div id="caderr" role="alert">${L.err?`<p class="cadv-err">${G('fail')}<span><b>${esc(L.err)}</b>${L.detail?`<small>${esc(L.detail)}</small>`:''}</span></p>`:''}</div>
    <p class="cadv-hint" id="cadhint">${lock?`Locked: the case has been sent under <b class="mono">CAD #${esc(c.cad)}</b>.`:`Enter the CAD number of this call from the MDT / dispatch information, for example <b class="mono">${CADN.EXAMPLE}</b>. “CAD#” and spaces are removed automatically.`}</p>
    <p class="cadv-src">${G('info')}<span>Entered manually by the crew, not received from dispatch. The platform checks that no case already exists under this number. You can correct it until the case is sent; after Send it is locked.</span></p>
  </div></div>`+
    ab(`<button class="btn btn-q" data-act="home">${IC.back}My cases</button>`,savedLine(),`<button class="btn btn-p btn-xl" data-act="cad-ok" ${lock||L.busy?'disabled':''}>${L.busy?'Checking…':c.draft?'Continue: check and send':'Continue: capture ECG'}</button>`);
}
/* the number is valid and has no case on the platform (or cannot be checked now: then it is checked again at Send) */
function cadAccept(c,v,unchecked){
  const prev=c.cad;
  if(v!==prev){c.cadHist.push({v,t:now()});ev(prev?`CAD number corrected before sending: CAD #${prev} → CAD #${v}`:`CAD number entered manually: CAD #${v}`,ME);c.cadAt=now()}
  c.cad=v;CAD=v;c.cadDup=null;c.cadEdit={val:v,err:'',detail:'',busy:false};
  if(!c.srv)OUTQ.forEach(o=>{o.cad=v});
  touch();saveLocal();
  if(unchecked)toast(`<b>CAD #${esc(v)} saved.</b> No connection: the platform checks it for an existing case when you send.`,true);
  /* corrected after the platform refused a retried Send: try again */
  if(c.ecgs.length&&c.srv===false){view='WS';render();if(c.failure&&!c.failure.late)late();return}
  view=c.draft?'C-05':'C-04';render();
}
function vMd(){
  const c=CASE;
  return `<div class="vbody"><div class="mdl">
    ${MD.map(mdRow).join('')}</div></div>`+
    ab(`<button class="btn btn-q" data-act="step" data-k="C-04">${IC.back}${c.draft?'Back to the ECG':'Capture ECG'}</button>`,savedLine(),`<button class="btn btn-p btn-xl" data-act="step" data-k="C-05" ${c.draft?'':'disabled'}>${c.draft?'Next: check and send':'Capture the ECG to send'}</button>`);
}

/* ---------- C-04 ---------- */
/* what the shutter will do: a new ECG, another image of the ECG being reviewed, or a recapture of one image */
function camMode(){
  const c=CASE,d=c.draft,r=c.recap;
  if(c.addTo){const e=c.ecgs[c.addTo-1];return {k:'addsent',n:e.n,i:freeSlot(e),v:e.v,acq:e.acq}}
  if(r)return {k:'recap',n:r.n,i:r.i,v:d?d.v:variantFor(r.n),acq:d?d.acq:null};
  if(d&&d.imgs.length<MAXI)return {k:'add',n:d.n,i:freeSlot(d),v:d.v,acq:d.acq};
  const n=c.nextN||c.ecgs.length+1;
  return {k:'new',n,i:1,v:variantFor(n),acq:null};
}
const vfAcq=()=>Math.floor(now()/10000)*10000;
function vCam(){
  const m=camMode(),n=m.n;
  return `<div class="cam ${SC.light?'lit':''}"><div class="vf">
    <img class="vf-img" src="${shot(m.v,m.i,SC.quality,m.acq||vfAcq())}" alt="Camera view of the monitor's 12-lead printout">
    ${guideSVG()}
    <div class="vf-top"><span class="vf-id mono">${idText()} · ECG&nbsp;${n} · Image&nbsp;${m.i}</span><span class="vf-tip">Fit the whole ECG in the frame. Include the calibration pulse.</span></div>
    <div class="vf-lock">${IC.lock}Stays in this case. Never saved to the photo gallery.</div>
    <div class="flash" id="flash"></div></div>
   ${m.k==='add'?`<p class="vf-add"><b>Adding an image to ECG ${n}.</b> A new recording from the monitor is a new ECG.</p>`:''}
   ${m.k==='addsent'?`<p class="vf-add"><b>Adding an image to ECG ${n}, already sent.</b> It goes straight to the cardiologist as part of ECG ${n}. A new recording from the monitor is a new ECG.</p>`:''}
   <div class="cam-ctl">
    <button class="cam-b" data-act="light" aria-pressed="${!!SC.light}">${IC.light}<span>Light</span></button>
    <button class="shutter" data-act="shoot" aria-label="Capture ECG ${n}, image ${m.i}"><span></span></button>
    <button class="cam-b" data-act="upload">${IC.up}<span>Upload</span></button>
    <button class="cam-b" data-act="cam-cancel">${IC.close}<span>Cancel</span></button></div></div>`;
}

/* ---------- C-05 ---------- */
function sumRow(f){
  const a=CASE.md[f.k];
  let v;
  if(!a)v='<span class="nye">Not yet entered</span>';
  else if(a.nv)v=nvChip(a.nv);
  else if(f.k==='gcs')v=String(a.v);
  else v=fmtVal(f.k,a);
  return `<dt>${f.label}</dt><dd>${v}</dd>`;
}
function stripHtml(e){
  const s=selImg(e);
  const th=e.imgs.map(x=>{const q=QUAL[x.q],on=x.i===s.i,pri=x.i===e.pri;
    return `<button class="thumb ${on?'on':''}" data-act="sel-img" data-i="${x.i}" aria-pressed="${on}" aria-label="Image ${x.i}, captured ${hms(x.at)}, image check ${q.t}${pri?', primary':''}"><span class="th-img"><img src="${x.img}" alt="">${pri?'<span class="th-pri">Primary</span>':''}</span><span class="th-l"><b>Image ${x.i}</b><span class="mono">${hms(x.at)}</span></span><span class="th-q">${G(q.g)}${q.t}</span></button>`}).join('');
  const add=e.imgs.length<MAXI?`<button class="thumb th-add" data-act="add-img">${IC.cam}<span>Add image to ECG&nbsp;${e.n}</span></button>`:'';
  const acts=e.imgs.length>1?`<div class="th-acts">${s.i!==e.pri?'<button class="btn btn-s" data-act="make-pri">Make primary</button>':'<span></span>'}<button class="btn btn-q" data-act="rm-img">Remove image</button></div>`:'';
  return `<div class="strip" role="group" aria-label="Images of ECG ${e.n}">${th}${add}</div>${acts}
      <p class="strip-note">Several photos of the same printout belong to this ECG. A new recording from the monitor is a new ECG with its own time.</p>`;
}
function vReview(){
  const c=CASE,e=c.draft,s=selImg(e),q=QUAL[priImg(e).q],miss=MD.filter(f=>!c.md[f.k]),can=!miss.length&&!!c.cad;
  const first=e.n===1;
  return `<div class="vbody" data-keep="rv"><div class="rv">
    <div class="rv-img ${e.imgs.length>1?'multi':''}"><button class="imgbtn" data-act="zoom" aria-label="Zoom into ECG ${e.n}, image ${s.i}"><img src="${s.img}" alt="Captured ECG ${e.n}, image ${s.i}, as photographed"><span class="zoomhint">${IC.zoom}Zoom</span></button>
      <div class="rv-cap"><b class="mono">ECG ${e.n} · Image ${s.i}</b> · captured <span class="mono">${hms(s.at)}</span> · <span class="mono">${idText()}</span></div>
      <div class="rv-time">ECG time <b class="mono">${hm(e.time||ecgAt(e))}</b> ${e.timeWhy?`(changed: ${esc(e.timeWhy)})`:e.imgs.length>1?'(first photo taken)':'(photo taken)'} <button class="lnk" data-act="ecg-time">Change</button></div>
      ${stripHtml(e)}</div>
    <div class="rv-side">
      ${!c.cad?`<section class="todo"><h2 class="h2">${G('warn')}Enter the CAD number to send</h2><button class="btn btn-s" data-act="cad-edit">Enter CAD number</button></section>`:''}
      ${miss.length?`<section class="todo"><h2 class="h2">${G('warn')}Answer ${miss.length} more field${miss.length>1?'s':''} to send</h2>${miss.map(mdRow).join('')}</section>`:''}
      <section class="qc qc-${q.k}"><div class="qc-h">${G(q.g)}<div><div class="qc-lab">IMAGE CHECK ON THIS TABLET · PRIMARY IMAGE</div><div class="qc-res">${q.t}</div></div></div>
        ${q.body}<ul>${q.checks.map(([k,t])=>`<li>${G(k)}${t}</li>`).join('')}</ul>
        <p class="qc-note">The final check runs on the server. This result never stops you sending.</p></section>
      <section class="sum"><h2 class="h2">${first?'Minimum dataset':'Minimum dataset, sent with ECG 1'}</h2><dl>${MD.map(sumRow).join('')}</dl></section>
    </div></div></div>`+
    ab(`<button class="btn btn-s" data-act="recapture">${IC.cam}Recapture</button>`,savedLine(),
      `<div class="sendwrap"><button class="btn btn-p btn-xl" data-act="send" ${can?'':'disabled'}>${IC.send}Send to cardiologist</button><small>${can?(first?'Alerts the on-duty cardiologist of the recommended PCI hospital.':`Goes to ${c.alert?c.alert.who:'the cardiologist'} on this case.`):!c.cad?'Enter the CAD number to send.':`Answer ${miss.length} more field${miss.length>1?'s':''} to send.`}</small></div>`);
}

/* ---------- C-07 rail: the case's live status progression, driven by the shared record ---------- */
const DECL={confirm:'CONFIRMED STEMI',not:'NOT STEMI',repeat:'UNCLEAR · REPEAT ECG REQUESTED'};
const lastDec=()=>CASE&&CASE.decs.length?CASE.decs[CASE.decs.length-1]:null;
const inTransit=e=>e&&['check','up','wait','noconn','fail'].includes(e.tx.stage);
function railHead(){
  const c=CASE,e=lastEcg(),d=lastDec(),stale=SC.online?'':`<div class="rh-sub stale">${G('warn')}Connection lost: this status may not be current</div>`;
  if(c.failure&&!c.failure.late)return `<div class="rh-big k-fail">${G('fail')}ECG not delivered</div><div class="rh-sub">Use the STEMI downtime route. Retrying automatically.</div>`;
  if(e.tx.stage==='check')return `<div class="rh-big">${G('prog')}Checking connection</div>`;
  if(e.tx.stage==='up')return `<div class="rh-big">${G('prog')}Uploading ECG ${e.n} · ${e.tx.pct}%</div><div class="bar"><i style="width:${e.tx.pct}%"></i></div>`;
  if(e.tx.stage==='wait')return `<div class="rh-big">${G('prog')}Sent · waiting for the server</div>${stale}`;
  if(d)return `<div class="rh-k">Decision received</div><div class="rh-big k-dec-${d.k}">${d.k==='confirm'?G('fail'):G('done')}${DECL[d.k]}</div><div class="rh-sub">${esc(d.by)} · ${hms(d.at)}${d.crewAck?' · acknowledged':''}</div>${stale}`;
  if(c.opened)return `<div class="rh-big">${G('ack')}${c.ack.who} is reviewing</div><div class="rh-sub">Acknowledged ${hms(c.ack.at)}, after ${dur(c.ack.at-c.waitFrom)} · decision to follow</div>${stale}`;
  if(c.ack)return `<div class="rh-big">${G('ack')}${c.ack.who} acknowledged</div><div class="rh-sub">At ${hms(c.ack.at)}, after ${dur(c.ack.at-c.waitFrom)}</div>${stale}`;
  if(c.waitFrom)return `<div class="rh-k">Waiting for cardiologist</div><span class="rh-t" data-tick="wait">${dur(now()-c.waitFrom)}</span><div class="rh-sub">Server received ECG 1 at ${hms(c.ecgs[0].tx.rcvAt)}${c.failure&&c.failure.late?' (delivered late)':''}</div>${stale}`;
  return `<div class="rh-big">${G('pend')}Sending</div>`;
}
function railRows(){
  const c=CASE,e1=c.ecgs[0],L=lastEcg(),tx=(inTransit(L)?L:e1).tx,te=inTransit(L)?L:e1,rows=[],d=lastDec();
  const R=(k,t,dsc,tm,cls)=>rows.push(`<li class="${cls||''}">${G(k)}<div><div class="t">${t}</div>${dsc?`<div class="d">${dsc}</div>`:''}${tm?`<div class="tm mono">${tm}</div>`:''}</div></li>`);
  /* sending: shown for ECG 1, and again while a later ECG is on its way */
  if(!e1.tx.rcvAt||inTransit(L)){
    if(tx.stage==='noconn')R('fail','CONNECTED','No connection when you pressed Send','','kfail');
    else if(tx.conAt)R('done','CONNECTED','Connection checked',hms(tx.conAt));
    else R('prog','CONNECTED','Checking connection','','cur');
    if(tx.stage==='up')R('prog','UPLOADING',`ECG ${te.n}${nImgs(te)}${te.n===1?' and case data':''} · ${tx.pct}%<div class="bar"><i style="width:${tx.pct}%"></i></div>`,'','cur');
    else if(tx.upAt)R('done','UPLOADING',`ECG ${te.n}${nImgs(te)}${te.n===1?' and case data':''} · 100%`,hms(tx.upAt));
    else if(tx.stage==='fail')R('fail','UPLOADING',`Stopped at ${tx.pct}%`,'','kfail');
    else R('pend','UPLOADING','');
  }
  /* Hamad's progression: ECG RECEIVED → CARDIOLOGIST ALERTED → ACKNOWLEDGED → REVIEWING → DECISION RECEIVED */
  if(e1.tx.late)R('warn','ECG RECEIVED','Delivered late – downtime route already in use',hms(e1.tx.rcvAt));
  else if(e1.tx.rcvAt)R('done','ECG RECEIVED',`The platform has the case and ECG 1${nImgs(e1)} (images stored on the server)`,hms(e1.tx.rcvAt));
  else if(e1.tx.stage==='fail'||e1.tx.stage==='noconn')R('fail','ECG RECEIVED','Not confirmed. Use the STEMI downtime route.','','kfail');
  else R('pend','ECG RECEIVED','Waiting for the server to confirm','','cur');
  const extra=c.rem.map(t=>`<div class="escl">${G('info')}<div>Reminder sent to ${c.alert.who} · <span class="mono">${hms(t)}</span></div></div>`).join('')+c.esc.map(x=>`<div class="escl">${G('warn')}<div><b>${x.t}</b><br>${x.who} · <span class="mono">${hms(x.at)}</span></div></div>`).join('');
  if(c.alert)R('done','CARDIOLOGIST ALERTED',`${c.alert.who} · on duty, ${HOSP[c.alert.hosp].name}${extra}`,hms(c.alert.at));
  else R('pend','CARDIOLOGIST ALERTED',e1.tx.rcvAt?'Alerting the on-duty cardiologist':'','',e1.tx.rcvAt?'cur':'');
  if(c.ack)R('ack','CARDIOLOGIST ACKNOWLEDGED',`${c.ack.who} acknowledged and opened the case`,hms(c.ack.at));
  else if(c.alert)R('pend','CARDIOLOGIST ACKNOWLEDGED',`Waiting for cardiologist <b class="mono" data-tick="wait">${dur(now()-c.waitFrom)}</b>`,'','cur');
  else R('pend','CARDIOLOGIST ACKNOWLEDGED','');
  if(c.opened)R(d?'done':'ack','CARDIOLOGIST REVIEWING',d?'Review complete':`${c.ack.who} is looking at the ECG and your entries. What you save now appears on that screen at once.`,hms(c.opened),d?'':'cur');
  else R('pend','CARDIOLOGIST REVIEWING',c.ack?'Opening the ECG':'','',c.ack?'cur':'');
  if(d)R(d.k==='confirm'?'fail':'done','DECISION RECEIVED',`<b>${DECL[d.k]}</b> · ${esc(d.by)}${d.crewAck?` · you acknowledged ${hms(d.crewAck)}`:' · <button class="lnk" data-act="show-dec">Show decision</button>'}`,hms(d.at),d.k==='confirm'?'kdec':'');
  else R('pend','DECISION RECEIVED',c.opened?'It will appear full screen.':'');
  /* then the journey: transport, arrival, handover (Hamad, 4 Oct 2026) */
  if(e1.tx.rcvAt){const Lf=c.life||{},dep=c.eta&&c.eta.dep;
    R(dep?'done':'pend','TRANSPORTING',dep?`Departed scene · ETA ${c.eta.min} min`:'',dep?hms(dep):'');
    R(Lf.arr?'done':'pend','ARRIVED',Lf.arr?esc(HOSP[Lf.arr.hosp].name):'',Lf.arr?hms(Lf.arr.at):'');
    R(Lf.closed?'done':Lf.arr?'prog':'pend','HANDOVER COMPLETED',Lf.closed?'Case closed · read-only':Lf.arr?'<button class="lnk" data-act="handover">Open handover</button>':'',Lf.closed?hms(Lf.closed.at):'',Lf.arr&&!Lf.closed?'cur':'');}
  return rows.join('');
}
/* the rail points to the AI ECG interpretation (C-07d); the interpretation itself is in the main column */
const rcvd=()=>CASE.ecgs.filter(e=>e.tx.rcvAt);
function aiMini(){
  const g=rcvd(),e=g[g.length-1];if(!e)return '';
  const a=e.aiR,t=!a?'AI analysis starting':a.st==='proc'?'AI analysis processing':AIST[a.st];
  return `<div class="aimini"><span class="aitag">AI</span><span>ECG ${e.n} · ${t}${CASE.aiNew?' · <b>NEW ECG ANALYSIS</b>':''}</span><button class="lnk" data-act="to-ai">View</button></div>`;
}
function railHtml(){
  const c=CASE;
  const later=c.ecgs.slice(1).map(x=>`<li class="old">${G(x.tx.rcvAt?'done':inTransit(x)&&x.tx.stage!=='fail'&&x.tx.stage!=='noconn'?'prog':'fail')}<div>ECG ${x.n}${nImgs(x)} · ${x.tx.rcvAt?`received <span class="mono">${hms(x.tx.rcvAt)}</span> · on the cardiologist's screen`:inTransit(x)?'sending':'not delivered'}</div></li>`).join('');
  const evs=c.events.slice().sort((a,b)=>b.t-a.t).map(x=>`<li><span class="tm mono">${hms(x.t)}</span><span>${esc(x.text)}<small>${esc(x.who)}</small></span></li>`).join('');
  return `${idTag('C-07')}<div class="rail-h" aria-live="polite">${railHead()}</div><ol class="cl">${railRows()}${later}</ol>${aiMini()}<div class="tl"><h3>Case timeline</h3><ol>${evs}</ol></div>`;
}

/* ---------- C-07b ---------- */
function destHtml(){
  const c=CASE,d=c.dest,tag=idTag('C-07b');
  if(!d)return `<section class="dest dest-wait" id="r-dest">${tag}${G('pend')}<div><h2 class="h2">Destination</h2><p>Recommended as soon as the server has the case.</p></div></section>`;
  if(d.st==='finding')return `<section class="dest dest-wait" id="r-dest">${tag}${G('prog')}<div><h2 class="h2">Destination</h2><p>Finding the recommended PCI destination</p></div></section>`;
  const h=hospInfo(d.hosp);
  if(d.st==='rec')return `<section class="dest dest-rec" id="r-dest">${tag}
    <div class="dest-lab">RECOMMENDED DESTINATION</div>
    <div class="dest-main"><div class="dest-name">${IC.hosp}${h.name}</div><div class="dest-eta">ETA <b class="mono">${h.eta} min</b></div></div>
    <dl class="dest-f"><div><dt>Cath lab</dt><dd class="${h.unk?'unk':''}">${h.lab}<small>${h.labSub}</small></dd></div><div><dt>Cardiologist</dt><dd>${h.cardio}<small>On duty: ${h.doc}</small></dd></div><div><dt>Pathway status</dt><dd>${h.path}</dd></div></dl>
    <p class="dest-why"><b>Reason:</b> ${esc(d.reason)}</p>
    <p class="dest-src">A recommendation, not a decision · destination engine · policy v0.1 (example) · ${hms(d.recAt)}</p>
    <div class="dest-acts"><button class="btn btn-s" data-act="dest-change">Change destination</button><button class="btn btn-p btn-xl" data-act="dest-accept">Accept ${h.name}</button></div></section>`;
  const et=c.eta,eta=et?`Departed <span class="mono">${hm(et.dep)}</span> · ETA <b class="mono">${et.min} min</b>${et.upd?` (updated ${hm(et.upd)})`:''}`:`ETA <b class="mono">${h.eta} min</b> once departed`;
  return `<section class="dest dest-conf" id="r-dest">${tag}${G('ack')}<div class="dc-t"><b>Destination confirmed · ${h.name}</b>
    <span>${eta} · ${d.by===ME?'confirmed by you':'by '+esc(d.by)} at <span class="mono">${hms(d.at)}</span>${d.from?` · changed from ${HOSP[d.from].name}, reason: ${esc(d.why)}`:''}</span>
    <small>The cardiologist and ACC see this at once.</small></div><div class="dc-acts">${et?'<button class="btn btn-s" data-act="eta">Update ETA</button>':'<button class="btn btn-s" data-act="depart">Departed scene</button>'}<button class="btn btn-q" data-act="dest-change">Change</button></div></section>`;
}

/* ---------- C-07a: the live record. Every save goes to the cardiologist at once, silently, marked NEW there ---------- */
const dlState=(id,queued)=>delivered(id)?`<span class="dl ok">On the cardiologist's screen <span class="mono">${hms(dlvAt(id))}</span></span>`:(queued||!SC.online)?`<span class="dl q">Saved on this tablet · will send when connected</span>`:`<span class="dl">Saved on this tablet · sending</span>`;
const dlGlyph=id=>delivered(id)?'done':SC.online?'prog':'warn';
function recRow(it){
  const r=CASE.rec[it.id];let v,dl='',g='pend',btn='';
  if(it.auto){const d=CASE.dest;
    if(d&&d.st==='conf'){v=`<span class="v">${HOSP[d.hosp].name} · ${CASE.eta?`departed ${hm(CASE.eta.dep)} · ETA ${CASE.eta.min} min`:`ETA ${HOSP[d.hosp].eta} min once departed`}</span>`;g='done';dl=`<span class="dl ok">From the destination card, confirmed ${hms(d.at)}</span>`}
    else v=`<span class="nye">Filled in when you confirm the destination</span>`;}
  else if(it.id==='ho'){const H=CASE.life&&CASE.life.ho;v=H?`<span class="v">Transfer of care recorded <span class="mono">${hm(H.saved)}</span></span>`:`<span class="nye">${it.later}</span>`;g=H?'done':'pend'}
  else if(it.later)v=`<span class="nye">${it.later}</span>`;
  else if(r){
    v=r.nv?nvChip(r.sum):`<span class="v">${esc(r.sum)}</span>`;
    if(r.prev&&r.prev.length)v+=`<span class="hist">Earlier: ${r.prev.map(p=>`${esc(p.sum)} <span class="mono">(${hm(p.at)})</span>`).join(' · ')}</span>`;
    if(it.multi&&r.count>1)v+=`<span class="nye">${r.count} entries sent; latest shown</span>`;
    g=dlGlyph(r.opId);dl=dlState(r.opId);
  } else v=`<span class="nye">Not yet entered</span>`;
  if(it.id==='ho')btn=`<button class="btn btn-q" data-act="handover">Open handover</button>`;
  else if(!it.auto&&!it.later)btn=`<button class="btn btn-s" data-act="rec" data-id="${it.id}">${r?(it.multi?'Add':'Change'):'Enter'}</button>`;
  else if(it.auto&&!(CASE.dest&&CASE.dest.st==='conf'))btn=`<button class="btn btn-q" data-act="to-dest">Go to destination</button>`;
  return `<div class="rr">${G(g)}<div class="rr-l">${it.label}${it.q?`<span class="qref">${it.q}</span>`:''}</div><div class="rr-v">${v}${dl}</div>${btn||'<span></span>'}</div>`;
}
/* the minimum dataset after sending: values are never overwritten. A new reading or a correction is added,
   and every earlier value stays visible with its time (Hamad, 3 Oct 2026, point 11) */
const VIT=['bp','hr','spo2','gcs'];
function mdText(k,a){
  if(!a)return '';
  if(a.nv)return a.nv;
  if(k==='age')return `${a.est?'≈ ':''}${a.v} y${a.est?' (estimated)':''}`;
  if(k==='sex')return a.v;
  if(k==='complaint')return complaintShort(a)+(a.det?` · ${a.det}`:'');
  if(k==='onset')return `${hm(a.v)}${a.approx?' (approximate)':''}`;
  if(k==='bp')return `${a.sys}/${a.dia}`;
  if(k==='hr')return `${a.v} bpm`;
  if(k==='spo2')return `${a.v} %`;
  if(k==='gcs')return String(a.v);
  return '';
}
const KINDL={sent:'sent with ECG 1',update:'new reading',correct:'correction',clarify:'clarification'};
function vitRow(f){
  const h=CASE.mdh[f.k]||[],cur=h[h.length-1],a=cur?cur.a:CASE.md[f.k];
  const val=a&&a.nv?nvChip(a.nv):`<span class="v">${esc(mdText(f.k,a))}${cur&&cur.t&&(VIT.includes(f.k)||cur.kind!=='sent')?` <small class="mono">${hm(cur.t)}</small>`:''}</span>`;
  const kind=cur?`<span class="vk k-${cur.kind}">${KINDL[cur.kind]}${cur.kind==='correct'&&h.length>1?`: was ${esc(mdText(f.k,h[h.length-2].a))}`:''}</span>`:'';
  const hist=h.length>1?`<span class="hist">Earlier: ${h.slice(0,-1).reverse().map(x=>`${esc(mdText(f.k,x.a))} <span class="mono">${hm(x.t)}</span> <span class="hk">${KINDL[x.kind]}</span>`).join(' · ')}</span>`:'';
  const dl=cur&&cur.kind!=='sent'?dlState(cur.opId):'';
  const g=cur&&cur.kind!=='sent'?dlGlyph(cur.opId):'done';
  return `<div class="rr vr">${G(g)}<div class="rr-l">${f.label}</div><div class="rr-v">${val}${kind}${hist}${dl}</div><button class="btn btn-s" data-act="mdup" data-k="${f.k}">${VIT.includes(f.k)?'Update':'Correct or clarify'}</button></div>`;
}
function vitHtml(){
  return `<section class="rec" id="r-vit">${idTag('C-07a')}<div class="rec-h"><h2 class="h2">Vital signs and minimum dataset</h2><span class="chip chip-i">Live to the cardiologist</span></div>
   <p class="rec-sub">A new value never replaces the old one: both are kept with their times. Choose <b>New reading</b> when the patient changed, or <b>Correction</b> when the earlier entry was wrong.</p>
   <div class="rg">${MD.filter(f=>VIT.includes(f.k)).map(vitRow).join('')}<div class="rr"><span></span><div class="rr-l"></div><div class="rr-v"></div><button class="btn btn-q" data-act="rec" data-id="obs">Add a full set</button></div></div>
   <div class="rg"><h3>Sent with ECG 1</h3>${MD.filter(f=>!VIT.includes(f.k)).map(vitRow).join('')}</div></section>`;
}
function recHtml(){
  const comp=completeness();
  return `<section class="rec" id="r-rec">${idTag('C-07a')}<div class="rec-h"><h2 class="h2">Complete the record</h2><span class="chip ${comp==='Minimum dataset only'?'chip-n':'chip-i'}">${comp}</span></div>
   <p class="rec-sub">Each item you save goes straight to the cardiologist's screen, marked New. No alarm sounds for it.</p>
   ${REC.map(g=>{const its=g.items.filter(i=>!i.hide);return its.length?`<div class="rg"><h3>${g.g}</h3>${its.map(recRow).join('')}</div>`:''}).join('')}</section>`;
}
/* C-07c: ECGs already sent. Another photo of the same printout is an image of that ECG; a new recording is a new ECG */
function ecgsHtml(){
  const c=CASE;
  const card=e=>{
    const imgs=e.imgs.map(x=>`<figure class="eimg"><img src="${x.img}" alt="ECG ${e.n}, image ${x.i}"><figcaption><b>Image ${x.i}${x.i===e.pri?' · Primary':''}</b><span class="mono">${hms(x.at)}</span>${x.after?(delivered(x.opId)?`<span class="dl ok">Added after sending · delivered ${hms(dlvAt(x.opId))}</span>`:`<span class="dl ${SC.online?'':'q'}">Added after sending · ${SC.online?'sending':'will send when connected'}</span>`):''}</figcaption></figure>`).join('');
    const can=e.tx.rcvAt&&e.imgs.length<MAXI;
    return `<div class="ecard"><div class="ec-h"><b>ECG ${e.n}</b><span>acquired <span class="mono">${hms(e.acq)}</span></span><span>${e.tx.rcvAt?`received <span class="mono">${hms(e.tx.rcvAt)}</span>`:inTransit(e)?'sending':'not delivered'}</span>${can?`<button class="btn btn-s" data-act="add-sent" data-n="${e.n}">${IC.plus}Add ECG image</button>`:e.imgs.length>=MAXI?`<span class="muted">${MAXI} images, the prototype's maximum</span>`:''}</div><div class="eimgs">${imgs}</div></div>`;
  };
  return `<section class="rec" id="r-ecgs">${idTag('C-07c')}<div class="rec-h"><h2 class="h2">ECGs in this case</h2><button class="btn btn-s" data-act="add-ecg">${IC.ecg}Capture new ECG (ECG ${c.ecgs.length+1})</button></div>
   <p class="rec-sub">Each ECG keeps its own acquisition time. Add an image when you photograph the same printout again; capture a new ECG for a new recording.</p>
   ${c.ecgs.map(card).join('')}</section>`;
}
/* ---------- C-07d: the AI ECG interpretation. The platform's one analysis of each ECG, the same text the cardiologist
   sees (Hamad, 3 Oct 2026, 12:07). Decision support only: the cardiologist makes the STEMI decision ---------- */
function aiSecHtml(){
  const c=CASE,got=rcvd();if(!got.length)return '';
  const L=got[got.length-1],e=got.find(x=>x.n===c.aiSel)||L,a=e.aiR,d=lastDec(),x=priImg(e);
  const tabs=got.length>1?`<div class="aitabs" role="group" aria-label="AI analysis of each ECG">${got.slice().reverse().map(g=>`<button class="aitab" data-act="ai-sel" data-n="${g.n}" aria-pressed="${g.n===e.n}">ECG ${g.n} · ${hm(g.acq)}${g.n===L.n?' <small>Latest</small>':''}${c.aiNew===g.n?' <span class="ainew">NEW ECG ANALYSIS</span>':''}</button>`).join('')}</div>`:'';
  /* the cardiologist's decision sits above the AI, so the AI is never read as the decision */
  const dec=d?`<b class="k-dec-${d.k}">${DECL[d.k]}</b><span>${esc(d.byT||d.by)} · <span class="mono">${hms(d.at)}</span></span>`:`<b>Awaited</b><span>${c.ack?`${esc(c.ack.who)} is reviewing`:c.alert?`${esc(c.alert.who)} alerted`:'Alerting the on-duty cardiologist'}</span>`;
  const earlier=got.some(g=>g.n<e.n&&g.aiR&&g.aiR.st!=='proc');
  let body;
  if(!a||a.st==='proc')body=`<div class="aiwait"><span>${earlier?`Until it finishes, the analysis of ECG ${e.n-1} stays one tap away above.`:'Nothing waits for it: the cardiologist already has the ECG.'}</span></div>`;
  else if(a.st==='down')body=`<div class="aidown">${G('nv')}<div><b>Continue clinical review using the original ECG and patient information.</b><span>The cardiologist has this ECG as normal.</span></div></div>`;
  else if(a.st==='wh')body=`<div class="aiq">${G('warn')}<div><b>${esc(a.q)}</b><span>No interpretation is given for this ECG. It went to the cardiologist as normal.</span></div></div>`;
  else body=(a.st==='lim'?`<div class="aiq">${G('warn')}<div><b>Glare over limb leads I, II and III</b><span>Only what could be assessed is reported.</span></div></div>`:'')+
    `<div class="airows">${AIROWS.map(([k,l])=>`<div class="airow${a.lim&&a.lim[k]?' lim':''}${k==='imp'?' imp':''}"><span class="l">${l}</span><span class="v">${esc(aiVal(a,e.n,k))}</span></div>`).join('')}</div>`;
  return `<section class="rec aisec" id="r-ai">${idTag('C-07d')}<div class="rec-h"><h2 class="h2"><span class="aitag">AI</span>AI ECG interpretation</h2></div>
   <div class="aidec"><span class="aidec-l">Cardiologist decision</span>${dec}</div>
   <p class="aids"><b>AI interpretation is decision support. The Cardiologist makes the final STEMI decision.</b> The AI never confirms a STEMI.</p>
   ${tabs}<div class="aimeta"><img src="${x.img}" alt="ECG ${e.n}, the image the AI analysed"><div class="aimeta-t"><b class="mono">ECG ${e.n} — ${hm(e.acq)}</b>${e.n>1?`<span class="ainewan">New ECG analysis · the analysis of ECG ${e.n-1} is kept</span>`:''}<span class="aist">${G(!a||a.st==='proc'?'prog':a.st==='ok'?'done':a.st==='down'?'nv':'warn')}${aiStLine(a)}</span></div></div>
   ${body}${a&&a.st!=='proc'?`<p class="aifoot">Shown the same on the cardiologist's screen${e.imgs.length>1?' · Primary image analysed':''} · ${esc(a.ver||'')}</p>`:''}</section>`;
}
function decBanner(){
  const d=lastDec();if(!d)return '';
  const body=d.k==='confirm'?`Continue to ${CASE.dest&&CASE.dest.hosp?HOSP[CASE.dest.hosp].name:'the receiving PCI hospital'}. The hospital and cath-lab steps are the next design phase.`:d.k==='not'?`${d.reason?'Reason: '+esc(d.reason)+'. ':''}${d.adv?'Advice: '+esc(d.adv)+'. ':''}Continue standard care. You can still send a new ECG.`:`${d.reasons.length?esc(d.reasons.join(', '))+'. ':''}${d.instr?esc(d.instr)+'. ':''}Capture and send a repeat ECG.`;
  return `<div class="decb decb-${d.k}" role="status">${idTag('C-09')}<div class="decb-l">DECISION RECEIVED</div><div class="decb-t"><b>${DECL[d.k]}</b><span>${esc(d.byT||d.by)} · <span class="mono">${hms(d.at)}</span>${d.crewAck?` · acknowledged <span class="mono">${hms(d.crewAck)}</span>`:''}</span><small>${body}</small></div>${d.crewAck?'':'<button class="btn btn-inv" data-act="show-dec">Show</button>'}</div>`;
}
function vWs(){
  const c=CASE;
  const rd=lastDec();
  const rep=c.repeatAsked&&!c.repeatSent?`<div class="rep">${G('warn')}<div class="rep-t"><b>${rd&&rd.k==='repeat'?`${esc(rd.by)} requests a repeat ECG.`:'Please obtain and submit a repeat ECG when possible.'}</b><span>${rd&&rd.k==='repeat'?(rd.reasons.length?esc(rd.reasons.join(', ')):'')+(rd.instr?' · '+esc(rd.instr):'')+(rd.within?` · within ${rd.within} min`:''):`The server check found ECG ${c.repeatFor}: ${QUAL[priImg(c.ecgs[c.repeatFor-1]).q].issue}. It went to the cardiologist as it is.`}</span></div><button class="btn btn-s" data-act="repeat">${IC.cam}Capture repeat ECG</button></div>`:'';
  return `<div class="ws"><aside class="rail" data-keep="rail" aria-label="Case status">${railHtml()}</aside>
    <div class="wmain" data-keep="wmain">${lostBanner()}${decBanner()}${rep}${destHtml()}${trHtml()}${vitHtml()}${ecgsHtml()}${aiSecHtml()}${recHtml()}</div></div>`;
}

/* ---------- transport, arrival and handover (Hamad, 4 Oct 2026) ----------
   Decision → TRANSPORTING (the existing "Departed scene") → ARRIVED → HANDOVER → COMPLETE HANDOVER & CLOSE CASE.
   Everything stays in the same CAD case; the handover page reads the shared case record, so nothing is re-entered */
function trHtml(){
  const c=CASE,e1=c.ecgs[0];if(!e1||!e1.tx.rcvAt)return '';
  const L=c.life||{},dep=c.eta&&c.eta.dep,conf=c.dest&&c.dest.st==='conf';
  const st=(done,lab,sub,btn)=>`<div class="rr">${G(done?'done':'pend')}<div class="rr-l">${lab}</div><div class="rr-v"><span class="${done?'v':'nye'}">${sub}</span></div>${btn||'<span></span>'}</div>`;
  return `<section class="rec" id="r-tr"><div class="rec-h"><h2 class="h2">Transport and handover</h2>${stateChip()}</div>
   <div class="rg">${st(!!dep,'Transporting',dep?`Departed scene <span class="mono">${hm(dep)}</span> · ETA ${c.eta.min} min`:conf?'Not started':'Confirm the destination first, then start transport',dep?'':`<button class="btn btn-s" data-act="depart" ${conf?'':'disabled'}>Start transport</button>`)}
   ${st(!!L.arr,'Arrived',L.arr?`${esc(HOSP[L.arr.hosp].name)} · <span class="mono">${hms(L.arr.at)}</span>`:'Not yet',L.arr?'':`<button class="btn btn-s" data-act="mark-arrived">Mark arrived</button>`)}
   ${st(false,'Handover',L.ho?'In progress':L.arr?'Ready to complete':'After arrival',`<button class="btn btn-p" data-act="handover">Open handover</button>`)}</div></section>`;
}
const HAREAS=['Emergency Department','Cath Lab','Resuscitation','Cardiac Unit','Other'];
const sPt=(S,k)=>lastOf(S.pt[k]);
const sRaw=(S,k)=>{const x=sPt(S,k);return x?x.raw:null};
const FVL=[['bp','BP','md'],['hr','HR','md'],['spo2','SpO₂','md'],['rr','RR','rec'],['gcs','GCS','md'],['pain','Pain score','rec']];
function lifeState(S){
  const A=lastOf(S.arr),d=lastOf(S.dec),dep=S.eta.some(x=>x.dep);
  return S.closed?'HANDOVER COMPLETED':A&&(lastOf(S.ho)||S.hopen||lastOf(S.fv))?'HANDOVER IN PROGRESS':A?'ARRIVED':d&&dep?'TRANSPORTING':d?'DECISION RECEIVED':S.opened?'CARDIOLOGIST REVIEWING':S.sub?'ECG SUBMITTED':'ACTIVE';
}
/* the handover page: a summary of the whole case from the shared record. ro: a completed case, read-only */
function hoPage(S,ro){
  const A=lastOf(S.arr),H=lastOf(S.ho),F=lastOf(S.fv),d=lastOf(S.dec),E=S.ecgs,LE=lastOf(E),D0=lastOf(S.dest),dep=S.eta.find(x=>x.dep),et=lastOf(S.eta);
  const hosp=A?A.hosp:D0?D0.hosp:null,hn=k=>k?HOSP[k].name:'Not set';
  const age=sRaw(S,'age'),sex=sRaw(S,'sex'),cp=sRaw(S,'complaint'),on=sRaw(S,'onset');
  const pt=[age?(age.nv?'Age unknown':`${age.est?'≈ ':''}${age.v} y`):null,sex?(sex.nv?'Sex unknown':sex.v):null].filter(Boolean).join(' · ')||'Not recorded';
  const state=lifeState(S),btn=(act,l,cls,extra)=>ro?'':`<button class="btn ${cls||'btn-s'}" data-act="${act}"${extra||''}>${l}</button>`;
  const row=(g,l,v,b)=>`<div class="rr">${G(g)}<div class="rr-l">${l}</div><div class="rr-v">${v}</div>${b||'<span></span>'}</div>`;
  const val=(v,t)=>v?`<span class="v">${v}${t?` <small class="mono">${t}</small>`:''}</span>`:'<span class="nye">Not entered</span>';
  const fact=(l,v)=>`<div><dt>${l}</dt><dd>${v}</dd></div>`;
  /* top */
  const top=`<section class="hotop"><dl class="card-f">${fact('CAD number',`<span class="mono">CAD #${esc(S.cad)}</span>`)}${fact('Patient',esc(pt))}${fact('Ambulance unit',esc(S.unit))}${fact('Receiving hospital',hn(hosp))}${fact('Case status',`<span class="chip st-${STATECLS[state]||'review'}">${state}</span>`)}${fact('Cardiologist decision',d?DECL[d.k]:'None recorded')}${fact('Arrival time',A?`<span class="mono">${hms(A.at)}</span>`:'Not yet')}</dl></section>`;
  const closed=S.closed?`<div class="decb decb-not" role="status"><div class="decb-l">HANDOVER COMPLETED</div><div class="decb-t"><b>Case closed · read-only</b><span>${esc(S.closed.by)} · <span class="mono">${hms(S.closed.at)}</span></span><small>Nothing in this case can be changed. A correction would need an authorised amendment (not built in this phase).</small></div></div>`:'';
  const dec=d?`<div class="decb decb-${d.k}"><div class="decb-l">CARDIOLOGIST DECISION</div><div class="decb-t"><b>${DECL[d.k]}</b><span>${esc(d.byT||d.by)} · <span class="mono">${hms(d.at)}</span> · on ECG ${d.on}</span><small>Read-only: the cardiologist's decision cannot be changed from the handover page.</small></div></div>`
    :`<div class="decb decb-not"><div class="decb-l">CARDIOLOGIST DECISION</div><div class="decb-t"><b>No decision recorded</b></div></div>`;
  /* arrival */
  const arr=`<section class="rec" id="h-arr"><div class="rec-h"><h2 class="h2">Arrival at receiving hospital</h2></div><div class="rg">
    ${row(hosp?'done':'pend','Receiving hospital',`<span class="v">${hn(hosp)}</span>${A?'':D0?`<span class="nye">From the destination (${D0.st==='rec'?'recommended':'confirmed'}); confirmed when you mark arrival</span>`:''}`,A?btn('arr-edit','Change'):'')}
    ${row(A?'done':'pend','Arrival time',A?`<span class="v mono">${hms(A.at)}</span>${S.arr.length>1?`<span class="hist">Earlier: ${S.arr.slice(0,-1).reverse().map(x=>`${hn(x.hosp)} <span class="mono">${hm(x.at)}</span>`).join(' · ')}</span>`:''}`:'<span class="nye">Not yet</span>',A?btn('arr-edit','Correct'):btn('arrive-now','MARK ARRIVED NOW','btn-p'))}</div></section>`;
  /* transfer of care */
  const area=H&&H.area?(H.area==='Other'?`Other: ${H.other}`:H.area):'';
  const toc=`<section class="rec" id="h-toc"><div class="rec-h"><h2 class="h2">Transfer of care</h2>${btn('ho-edit',H?'Change details':'Enter transfer of care','btn-p')}</div><div class="rg">
    ${row(H&&H.at?'done':'pend','Handover time',val(H&&H.at?`<span class="mono">${hms(H.at)}</span>`:''))}
    ${row(A?'done':'pend','Receiving hospital',val(A?hn(A.hosp):''))}
    ${row(area?'done':'pend','Receiving area / department',area?`<span class="v">${esc(area)}</span>`:'<span class="nye">Not entered (optional)</span>')}
    ${row(H&&H.name?'done':'pend','Receiving clinician',val(H&&H.name?esc(H.name):''))}
    ${row(H&&H.role?'done':'pend','Receiving clinician role',val(H&&H.role?esc(H.role):''))}
    ${row(H&&H.crew?'done':'pend','Crew clinician completing handover',val(H&&H.crew?esc(H.crew):''))}
    ${row(H&&H.notes?'done':'pend','Handover notes',H&&H.notes?`<span class="v">${esc(H.notes)}</span>`:'<span class="nye">None (optional)</span>')}
    ${H&&S.ho.length>1?`<p class="rec-sub">${S.ho.length} versions saved; the latest is shown. Earlier versions are kept in the case.</p>`:''}</div></section>`;
  /* final vitals */
  const V=S.vit||{},chg=Math.max(0,...Object.values(V).map(x=>x.rcv||0)),fvOk=F&&F.rcv>=chg;
  const fvAct=k=>ro?'':FVL.find(x=>x[0]===k)[2]==='md'?`<button class="btn btn-s" data-act="mdup" data-k="${k}">Update</button>`:`<button class="btn btn-s" data-act="rec" data-id="${k}">${V[k]?'Update':'Enter'}</button>`;
  const fv=`<section class="rec" id="h-fv"><div class="rec-h"><h2 class="h2">Final vitals at handover</h2><span class="chip ${fvOk?'chip-i':'chip-n'}">${fvOk?`Confirmed ${hm(F.at)}`:F?'Changed since confirmed':'Not confirmed'}</span></div>
    <p class="rec-sub">The latest recorded values are shown. An update is a new reading; earlier readings are kept. RR and pain score are optional.</p>
    <div class="rg">${FVL.map(([k,l])=>row(V[k]?'done':'pend',l,V[k]?(V[k].nv?nvChip(V[k].v):`<span class="v">${esc(V[k].v)}${V[k].t?` <small class="mono">${hm(V[k].t)}</small>`:''}</span>`):'<span class="nye">Not entered</span>',fvAct(k))).join('')}
    ${ro?'':`<div class="rr"><span></span><div class="rr-l"></div><div class="rr-v">${F?`<span class="dl ${fvOk?'ok':''}">Last confirmed ${hms(F.at)} by ${esc(F.by)}</span>`:''}</div><button class="btn btn-p" data-act="fv-confirm">${fvOk?'Confirm again':'Confirm final vitals'}</button></div>`}</div></section>`;
  /* case summary */
  const aiL=LE&&LE.ai,aiTxt=!aiL?'Not available':aiL.st==='proc'?'Processing':aiL.st==='down'?'AI interpretation unavailable':aiL.st==='wh'?'Not suitable for interpretation':aiL.imp||'';
  const tx=[];Object.entries(S.rec).forEach(([k,r])=>{if(r.group==='Treatments given')r.vers.forEach(v=>tx.push({t:v.t||v.rcv,txt:`${r.label}: ${v.v}`}))});tx.sort((a,b)=>a.t-b.t);
  const sum=`<section class="rec" id="h-sum"><div class="rec-h"><h2 class="h2">Case summary</h2></div><div class="rg">
    ${row('info','Presenting complaint',val(cp?esc(complaintShort(cp)+(cp.det?' · '+cp.det:'')):''))}
    ${row('info','Symptom onset',val(on?(on.nv?'Unknown':`${hm(on.v)}${on.approx?' (approximate)':''}`):''))}
    ${row('info','Initial ECG',val(E[0]?`ECG 1 · acquired <span class="mono">${hm(E[0].acq)}</span>`:''))}
    ${row('info','Latest ECG',val(LE?`ECG ${LE.n} · acquired <span class="mono">${hm(LE.acq)}</span>`:''))}
    ${row(d?'done':'pend','Cardiologist decision',val(d?`${DECL[d.k]} · ${esc(d.by)} · <span class="mono">${hms(d.at)}</span>`:''))}
    ${row('info',`AI interpretation · ECG ${LE?LE.n:''}`,`<span class="v">${esc(aiTxt)}</span><span class="hist">AI interpretation is decision support. The Cardiologist makes the final STEMI decision.</span>`)}
    ${row('info','Destination',val(D0?`${hn(D0.hosp)} · ${D0.st==='rec'?'recommended':'confirmed'}`:''))}
    ${row('info','ETA / arrival',val([dep?`Departed ${hm(dep.dep)} · ETA ${et.min} min`:'',A?`Arrived ${hm(A.at)}`:''].filter(Boolean).join(' · ')))}
    </div></section>`;
  /* ECGs */
  const ecg=`<section class="rec" id="h-ecg"><div class="rec-h"><h2 class="h2">ECGs</h2></div>
    <p class="aids"><b>AI interpretation is decision support. The Cardiologist makes the final STEMI decision.</b></p>
    <div class="hoecgs">${E.map(e=>{const x=e.imgs.find(i=>i.i===e.pri)||e.imgs[0],a=e.ai,ds=S.dec.filter(z=>z.on===e.n);
      return `<div class="ecard hoecg"><button class="imgbtn" data-act="ho-img" data-n="${e.n}" aria-label="Open ECG ${e.n}"><img src="${x.url}" alt="ECG ${e.n}, primary image"></button><div class="hoecg-t"><b class="mono">ECG ${e.n} — ${hm(e.acq)}</b><span>${e.imgs.length} image${e.imgs.length>1?'s':''} · received <span class="mono">${hm(e.rcv)}</span></span><span>AI: ${esc(aiStLine(a))}${a&&a.imp?` · ${esc(a.imp)}`:''}</span>${ds.map(z=>`<span class="k-dec-${z.k}"><b>${DECL[z.k]}</b> · ${esc(z.by)} · <span class="mono">${hm(z.at)}</span></span>`).join('')}<button class="btn btn-q" data-act="ho-img" data-n="${e.n}">Open ECG</button></div></div>`}).join('')}</div></section>`;
  /* treatments, chronological (each saved entry once) */
  const trt=`<section class="rec" id="h-tx"><div class="rec-h"><h2 class="h2">Treatments and medications</h2></div>
    ${tx.length?`<ol class="hotl">${tx.map(x=>`<li><span class="tm mono">${hm(x.t)}</span><span>${esc(x.txt)}</span></li>`).join('')}</ol>`:'<p class="rec-sub">None recorded.</p>'}</section>`;
  /* compact timeline of the major events, from the audit trail */
  const MAJ=/STEMI case opened|ECG \d+ acquired|Case submitted|Cardiologist alerted|Cardiologist acknowledged|STEMI confirmed|Not STEMI recorded|repeat ECG requested|ECG \d+ received by the server|Transport started|Arrived at the receiving|Arrival corrected|Final vitals at handover confirmed|Transfer of care details|Handover completed|closed by/;
  const tl=`<section class="rec" id="h-tl"><div class="rec-h"><h2 class="h2">Handover timeline</h2></div>
    <ol class="hotl">${S.audit.filter(a=>a.kind==='key'&&MAJ.test(a.text)).map(a=>`<li><span class="tm mono">${hms(a.t)}</span><span>${esc(a.text.split(' · ')[0])}</span></li>`).join('')}</ol></section>`;
  const miss=!ro&&S.hoMissing&&S.hoMissing.length?`<section class="todo homiss" id="h-miss"><h2 class="h2">${G('warn')}Complete the following before closing this case:</h2><ul>${S.hoMissing.map(m=>`<li>${esc(m)}</li>`).join('')}</ul></section>`:'';
  return closed+top+dec+arr+toc+fv+sum+ecg+trt+tl+miss;
}
function vHo(){
  const S=SRV,c=CASE;
  if(!S||!S.sub)return `<div class="vbody"><div class="cadv"><p class="cadv-hint">The handover page is available once the case has been sent.</p></div></div>`+ab(`<button class="btn btn-q" data-act="ho-back">${IC.back}Back to the case</button>`,'','');
  if(S.closed)return `<div class="vbody ho" data-keep="ho">${hoPage(S,true)}</div>`+ab(`<button class="btn btn-q" data-act="home">${IC.back}My cases</button>`,'<span>Completed case · read-only</span>','');
  if(!S.hopen&&!c.hopenSent){c.hopenSent=1;setT(0,()=>op('hopen'))}
  const can=!S.hoMissing.length&&SC.online&&!OUTQ.length;
  return `<div class="vbody ho" data-keep="ho">${hoPage(S,false)}</div>`+
    ab(`<button class="btn btn-q" data-act="ho-back">${IC.back}Back to the case</button>`,`<span>${S.hoMissing.length?`${S.hoMissing.length} item${S.hoMissing.length>1?'s':''} to complete`:!SC.online?'No connection: closing needs the platform':OUTQ.length?'Sending your latest entries…':'Ready to close'}</span>`,
      `<button class="btn btn-p btn-xl" data-act="ho-complete" ${can?'':'disabled'}>COMPLETE HANDOVER &amp; CLOSE CASE</button>`);
}
/* a completed case from the history list: the same summary, read-only */
let HREC=null,HLIST=null,HQ='',histT=null;
function vHist(){
  return `<div class="vbody ho" data-keep="hist">${HREC?hoPage(HREC,true):'<p class="rec-sub">Loading…</p>'}</div>`+ab(`<button class="btn btn-q" data-act="hist-back">${IC.back}Back to my cases</button>`,`<span>Completed case · read-only</span>`,'');
}
function histRows(){
  if(HLIST===null)return '<li class="nye">Loading…</li>';
  if(!HLIST.length)return `<li class="nye">${HQ?'No completed case matches this CAD number.':'No completed cases yet.'}</li>`;
  return HLIST.map(x=>`<li><span class="mono"><b>CAD #${esc(x.cad)}</b></span><span>${esc(x.unit||'')}${x.hosp?' · '+esc(x.hosp):''}${x.dec?' · '+DECL[x.dec]:''}</span><span class="mono">Completed ${hm(x.closedAt)}</span><button class="btn btn-s" data-act="hist-open" data-cad="${esc(x.cad)}">View</button></li>`).join('');
}
function histHtml(){
  return `<section class="hist"><h2 class="h2">Completed cases</h2><input class="tin" id="histq" value="${esc(HQ)}" placeholder="Find by CAD number" autocomplete="off" spellcheck="false" aria-label="Find a completed case by CAD number"><ul class="hist-l">${histRows()}</ul></section>`;
}
function loadHist(){
  if(!LIVE)return;
  LIVE.request('GET','/api/cases?q='+encodeURIComponent(HQ)).then(x=>{HLIST=(x.body&&x.body.cases)||[];const l=$('.hist-l');if(l)l.innerHTML=histRows()},()=>{});
}

/* ---------- layers ---------- */
function drawer(title,body,foot,wide){
  return `<div class="scrim" data-act="close"></div><div class="drawer ${wide?'wide':''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
   <div class="dr-h"><h2>${title}</h2><button class="icon-btn" data-act="close" aria-label="Close">${IC.close}</button></div>
   <div class="dr-b">${body}</div><div class="dr-f">${foot}</div></div>`;
}
function dispParts(L){
  return `<div class="disp">${L.parts.map((p,i)=>`${i&&L.slash?'<span class="slash">/</span>':''}<button class="part ${i===L.pi?'act':''}" data-act="part" data-i="${i}">${p.lab?`<small>${p.lab}</small>`:''}<span>${p.v||'–'}</span></button>`).join('')}<span class="unit">${L.unit||''}</span></div>`;
}
function timeAdj(L,lab){return `<div class="tadj"><span>${lab||'Time'} <b class="mono">${hm(L.at)}</b></span><button class="btn btn-q" data-act="at" data-d="-5">−5 min</button><button class="btn btn-q" data-act="at" data-d="0">Now</button></div>`}
function tpanel(L,quick){
  const m=Math.round((now()-L.tm)/MIN);
  return `<div class="tbig"><b>${hm(L.tm)}</b><span>${m<=0?'now':ago(L.tm)}</span></div>
   <div class="qgrid">${quick.map(([l,mn])=>`<button class="cbtn" data-act="tq" data-m="${mn}">${l}</button>`).join('')}</div>
   <div class="stepbtns"><button class="btn btn-q" data-act="tstep" data-m="-60">−1 h</button><button class="btn btn-q" data-act="tstep" data-m="-5">−5 min</button><button class="btn btn-q" data-act="tstep" data-m="5">+5 min</button><button class="btn btn-q" data-act="tstep" data-m="60">+1 h</button></div>`;
}
const tog=(on,act,label)=>`<button class="tog ${on?'on':''}" data-act="${act}" aria-pressed="${!!on}"><span class="box">${on?IC.check:''}</span>${label}</button>`;
/* plausibility checks: a value is checked once it is complete or left, and everything is checked on save */
const RULE={age:[0,120,'age'],hr:[1,300,'heart rate'],spo2:[1,100,'SpO₂'],sys:[40,300,'systolic pressure'],dia:[10,200,'diastolic pressure'],rr:[1,80,'respiratory rate'],tmp:[25,45,'temperature']};
function partsErr(L,all){
  const P=L.parts||[];
  for(let i=0;i<P.length;i++){const p=P[i];if(!p.rule||p.v==='')continue;
    if(!(all||i!==L.pi||p.v.replace('.','').length>=p.max))continue;
    const v=Number(p.v),[lo,hi,lab]=p.rule;if(!(v>=lo&&v<=hi))return `Check the ${lab}: it should be ${lo} to ${hi}.`;}
  if(L.bp!=null){const s=P[L.bp],d=P[L.bp+1];if(s.v&&d.v&&(all||L.pi!==L.bp+1||d.v.length>=d.max)&&Number(d.v)>=Number(s.v))return 'Check the blood pressure: diastolic should be below systolic.';}
  return '';
}
const filled=L=>L.parts.every(p=>p.v!=='');
const errLine=L=>{const e=partsErr(L,!!L.tried);return e?`<p class="err" role="alert">${G('warn')}${e}</p>`:''};
function layerHtml(){
  const L=layer;if(!L)return '';
  if(L.t==='md'){
    const f=MDK[L.k],pt=postTog(L),dn=L.post?'Save and send':'Done';
    if(f.kind==='sex'){
      const b=pt+`<div class="olist">${['Male','Female'].map(s=>`<button class="cbtn ${L.sel===s?'on':''}" data-act="sexpick" data-v="${s}">${L.sel===s?IC.check:''}${s}</button>`).join('')}</div>`;
      return drawer('Sex',b,f.nv.map(n=>`<button class="nvb" data-act="nvclose" data-k="sex" data-v="${n}">${n}</button>`).join('')+`<span class="sp"></span><button class="btn btn-p btn-xl" data-act="sex-done" ${L.sel?'':'disabled'}>${dn}</button>`);
    }
    if(f.kind==='num'||f.kind==='bp'){
      let b=pt+dispParts(L)+errLine(L);
      if(L.k==='age')b+=tog(L.est,'est','Estimated age');
      if(['bp','hr','spo2'].includes(L.k))b+=timeAdj(L,'Taken at');
      b+=keypad(L.k==='bp'?'/':'');
      return drawer(f.label,b,f.nv.map(n=>`<button class="nvb" data-act="nvclose" data-k="${f.k}" data-v="${n}">${n}</button>`).join('')+`<span class="sp"></span><button class="btn btn-p btn-xl" data-act="md-done" ${filled(L)?'':'disabled'}>${dn}</button>`);
    }
    if(f.kind==='time'){
      const b=pt+tpanel(L,[['Now',0],['15 min ago',15],['30 min ago',30],['45 min ago',45],['1 h ago',60],['2 h ago',120]])+tog(L.approx,'approx','Approximate');
      return drawer('Symptom onset',b,`<button class="nvb" data-act="nvclose" data-k="onset" data-v="Unknown">Unknown</button><span class="sp"></span><button class="btn btn-p btn-xl" data-act="md-done">${dn}</button>`);
    }
    if(f.kind==='complaint'){
      const b=pt+`<div class="olist">${COMPLAINTS.map(o=>`<button class="cbtn ${L.sel===o.id?'on':''}" data-act="cpick" data-v="${o.id}">${L.sel===o.id?IC.check:''}${o.l}</button>`).join('')}</div>
        <div><label class="flab" for="cdet">Details${L.sel==='oth'?' (needed for Other)':' (optional)'}</label><input class="tin" id="cdet" value="${esc(L.det)}" autocomplete="off" placeholder="For example: central, crushing, with sweating"></div>
        <p class="muted" style="margin:0;font-size:15px">Pick list is illustrative (Q-56).</p>`;
      return drawer('Presenting complaint',b,`<span class="sp"></span><button class="btn btn-p btn-xl" data-act="c-done" ${L.sel&&(L.sel!=='oth'||L.det.trim())?'':'disabled'}>${dn}</button>`);
    }
    if(f.kind==='gcs'){
      const b=pt+`<div class="gcsg">${[15,14,13,12,11,10,9,8,7,6,5,4,3].map(n=>`<button class="key" data-act="gcs" data-v="${n}">${n}</button>`).join('')}</div>`;
      return drawer('GCS',b,f.nv.map(n=>`<button class="nvb" data-act="nvclose" data-k="gcs" data-v="${n}">${n}</button>`).join(''));
    }
  }
  if(L.t==='rec'){
    const it=RECK[L.id],o=it.opts[L.opt];
    let b=`<div class="opts">${it.opts.map((x,i)=>`<button class="${x.nv?'nvb':'cbtn'} ${L.opt===i?'on':''}" data-act="ropt" data-i="${i}" aria-pressed="${L.opt===i}">${L.opt===i?(x.nv?IC.slash:IC.check):''}${x.l}</button>`).join('')}</div>`;
    if(o){
      if(o.dose!==undefined)b+=`<div><label class="flab" for="rdose">Dose</label><input class="tin" id="rdose" value="${esc(L.dose)}" autocomplete="off"></div>`;
      if(o.chips)b+=`<div class="chips">${o.chips.map(ch=>`<button class="cbtn ${L.chips.has(ch)?'on':''}" data-act="rchip" data-v="${ch}">${L.chips.has(ch)?IC.check:''}${ch}</button>`).join('')}</div>`;
      if(o.score)b+=`<div class="score">${[0,1,2,3,4,5,6,7,8,9,10].map(n=>`<button class="key ${L.score===n?'on':''}" data-act="rscore" data-v="${n}">${n}</button>`).join('')}</div>`;
      if(o.text)b+=`<div><label class="flab" for="rtext">${o.text}</label>${o.long?`<textarea class="tin" id="rtext" rows="4">${esc(L.text)}</textarea>`:`<input class="tin" id="rtext" value="${esc(L.text)}" autocomplete="off">`}</div>`;
      if(o.num||o.vitals)b+=dispParts(L)+errLine(L)+keypad(o.dec?'.':o.vitals?'Next':'');
      if(o.time)b+=timeAdj(L);
      if(o.tpick)b+=tpanel(L,[['Now',0],['5 min ago',5],['10 min ago',10],['15 min ago',15],['30 min ago',30],['1 h ago',60]]);
    }
    return drawer(it.label,b,`<span class="sp"></span><button class="btn btn-p btn-xl" data-act="rsave" ${recOk(L)?'':'disabled'}>Save and send</button>`,true);
  }
  if(L.t==='dest'){
    const cur=CASE.dest.hosp;
    const nxt=['A','B','C'].find(k=>k!==cur&&!hospInfo(k).unk);
    const cards=['A','B','C'].map(k=>{const h=hospInfo(k),tags=[];
      if(k===cur)tags.push('<span class="tagx">Current</span>');
      if(k===nxt)tags.push('<span class="tagx next">Engine: next recommended</span>');
      if(h.unk)tags.push('<span class="tagx warn">Not treated as available: status unknown</span>');
      return `<button class="hcard ${L.pick===k?'on':''}" data-act="dpick" data-v="${k}" ${k===cur?'disabled':''}><span class="hn">${h.name}</span><span class="he">ETA ${h.eta} min</span><span class="hs">Cath lab: ${h.lab} (${h.labSub}) · Cardiologist: ${h.cardio} · Pathway: ${h.path}</span>${tags.length?`<span class="ht">${tags.join('')}</span>`:''}</button>`}).join('');
    const why=['Patient condition','Hospital status or capacity','ACC instruction','Crew clinical judgement','Other'];
    let conseq='';
    if(L.pick){const n=HOSP[L.pick].name;conseq=`The change appears on ${CASE.alert?CASE.alert.who+'’s':'the cardiologist’s'} screen at once, with no alarm, and the earlier destination stays in the record. `+(CASE.ack?`${CASE.ack.who} has opened the case and will finish the review.`:`Whether an unopened alert moves to ${n}'s on-duty cardiologist is open; this prototype keeps ${CASE.alert?CASE.alert.who:'the alert'} on the case.`)+' <span class="muted">(Q-52, open)</span>';}
    const b=`<div class="hl">${cards}</div>${conseq?`<div class="conseq">${conseq}</div>`:''}
      <div><span class="flab">Reason (required)</span><div class="chips">${why.map(w=>`<button class="cbtn ${L.why===w?'on':''}" data-act="dwhy" data-v="${w}">${L.why===w?IC.check:''}${w}</button>`).join('')}</div><p class="muted" style="margin:6px 0 0;font-size:14.5px">Reasons are examples of a configured list (Q-57).</p></div>
      <div><label class="flab" for="dtext">Details${L.why==='Other'?' (needed for Other)':' (optional)'}</label><input class="tin" id="dtext" value="${esc(L.text)}" autocomplete="off"></div>`;
    return drawer('Change destination',b,`<span class="sp"></span><button class="btn btn-p btn-xl" data-act="dconfirm" ${destOk(L)?'':'disabled'}>${L.pick?'Confirm change to '+HOSP[L.pick].name:'Choose a hospital'}</button>`,true);
  }
  if(L.t==='etime'){
    const b=`<div class="tbig"><b>${hm(L.tm)}</b><span>ECG time</span></div>
      <div class="stepbtns"><button class="btn btn-q" data-act="tstep" data-m="-5">−5 min</button><button class="btn btn-q" data-act="tstep" data-m="-1">−1 min</button><button class="btn btn-q" data-act="tstep" data-m="1">+1 min</button><button class="btn btn-q" data-act="tstep" data-m="5">+5 min</button></div>
      <div><span class="flab">Reason (required)</span><div class="chips">${['Printout shows an earlier acquisition time','Other'].map(w=>`<button class="cbtn ${L.why===w?'on':''}" data-act="ewhy" data-v="${w}">${L.why===w?IC.check:''}${w}</button>`).join('')}</div></div>
      <div><label class="flab" for="etext">Details${L.why==='Other'?' (needed for Other)':' (optional)'}</label><input class="tin" id="etext" value="${esc(L.text)}" autocomplete="off"></div>`;
    return drawer('Change ECG time',b,`<span class="sp"></span><button class="btn btn-p btn-xl" data-act="esave" ${L.why&&(L.why!=='Other'||L.text.trim())?'':'disabled'}>Save time</button>`);
  }
  if(L.t==='arr'){
    const b=`<div><label class="flab">Receiving hospital</label><div class="olist">${Object.keys(HOSP).map(k=>`<button class="cbtn ${L.hosp===k?'on':''}" data-act="arr-hosp" data-v="${k}">${L.hosp===k?IC.check:''}${HOSP[k].name}</button>`).join('')}</div></div>
      <div><label class="flab">Arrival time</label>${tpanel(L,[['Now',0],['5 min ago',5],['10 min ago',10],['15 min ago',15]])}</div>
      <p class="rec-sub">A correction is added; the earlier arrival time stays in the case.</p>`;
    return drawer('Arrival at receiving hospital',b,`<span class="sp"></span><button class="btn btn-p btn-xl" data-act="arr-save" ${L.hosp?'':'disabled'}>Save arrival</button>`);
  }
  if(L.t==='ho'){
    const A=CASE.life&&CASE.life.arr;
    const b=`<p class="rec-sub">Receiving hospital: <b>${A?HOSP[A.hosp].name:'not set: mark arrival first'}</b></p>
      <div><label class="flab">Handover time</label><div class="tadj"><span><b class="mono">${L.at?hm(L.at):'Not set'}</b></span><button class="btn btn-s" data-act="ho-now">Handover now</button><button class="btn btn-q" data-act="ho-at" data-d="-5">−5 min</button><button class="btn btn-q" data-act="ho-at" data-d="5">+5 min</button></div></div>
      <div><label class="flab">Receiving area / department</label><div class="chips">${HAREAS.map(a=>`<button class="cbtn ${L.area===a?'on':''}" data-act="ho-area" data-v="${a}" aria-pressed="${L.area===a}">${L.area===a?IC.check:''}${a}</button>`).join('')}</div>${L.area==='Other'?`<input class="tin" id="hoother" value="${esc(L.other)}" placeholder="Describe the area (required for Other)" autocomplete="off">`:''}</div>
      <div><label class="flab" for="honame">Receiving clinician name</label><input class="tin" id="honame" value="${esc(L.name)}" autocomplete="off"></div>
      <div><label class="flab" for="horole">Receiving clinician role</label><input class="tin" id="horole" value="${esc(L.role)}" autocomplete="off" placeholder="For example: ED physician, cath lab nurse"></div>
      <div><label class="flab" for="hocrew">Crew clinician completing handover</label><input class="tin" id="hocrew" value="${esc(L.crew)}" autocomplete="off"></div>
      <div><label class="flab" for="honotes">Handover notes (optional)</label><textarea class="tin" id="honotes" rows="3">${esc(L.notes)}</textarea></div>`;
    return drawer('Transfer of care',b,`<span class="sp"></span><button class="btn btn-p btn-xl" data-act="ho-save" ${L.area==='Other'&&!L.other.trim()?'disabled':''}>Save</button>`,true);
  }
  if(L.t==='hoconfirm')return `<div class="scrim" data-act="close"></div><div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="hcq"><h2 class="h2" id="hcq">COMPLETE HANDOVER?</h2>
    <p>This will close the active STEMI case <b class="mono">${esc(idText())}</b>. It then becomes read-only.</p><p>Confirm that:</p>
    <ul class="hoconf"><li>Patient has arrived at the receiving hospital</li><li>Transfer of care has been completed</li><li>Receiving clinician details are recorded</li><li>Final observations have been documented</li></ul>
    ${L.err?`<p class="err" role="alert">${G('warn')}${esc(L.err)}</p>`:''}
    <div class="row"><button class="btn btn-q" data-act="close">CANCEL</button><button class="btn btn-p btn-xl" data-act="ho-close" ${L.busy?'disabled':''}>${L.busy?'Closing…':'COMPLETE HANDOVER'}</button></div></div>`;
  if(L.t==='hoimg')return `<div class="zoom" role="dialog" aria-modal="true" aria-label="ECG"><div class="zoom-h"><b>${esc(L.label)}</b><button class="icon-btn" data-act="close" aria-label="Close">${IC.close}</button></div><div class="zoom-b"><img src="${L.url}" alt="${esc(L.label)}"></div></div>`;
  if(L.t==='dup'){
    const x=L.ex||{},c=CASE,hasDraft=!!(c&&c.srv===false&&(c.draft||answered()||c.ecgs.length));
    return `<div class="scrim"></div><div class="dlg dup" role="alertdialog" aria-modal="true" aria-labelledby="dupq" aria-describedby="dupd"><h2 class="h2" id="dupq">${G('warn')}CASE ALREADY EXISTS</h2><p class="mono dup-cad">CAD #${esc(L.cad)}</p>
    <p id="dupd">A case with this CAD number is already on the platform${x.unit?` (${esc(x.unit)}`:''}${x.submittedAt?`, sent ${hms(x.submittedAt)}`:x.unit?', not sent':''}${x.unit?')':''}${x.active===false?' · closed':''}. A second case is not created and the existing case is not changed.</p>
    ${hasDraft?'<p>Opening the existing case replaces the unsent draft on this tablet. To keep the draft, correct the CAD number instead.</p>':''}
    <div class="row"><button class="btn btn-q" data-act="dup-fix">Correct the CAD number</button><button class="btn btn-p btn-xl" data-act="dup-open">OPEN EXISTING CASE</button></div></div>`;
  }
  if(L.t==='newcase'){
    const c=CASE,pend=OUTQ.length+PENDIMG.length,draft=!!(c&&c.srv===false&&(c.draft||answered()||c.cad));
    return `<div class="scrim" data-act="close"></div><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="nq"><h2 class="h2" id="nq">Open a new STEMI case?</h2>
    ${pend?`<p><b>${pend} entr${pend>1?'ies':'y'} of ${esc(idText())} still waiting to be sent.</b> Wait for the connection to return before opening a new case.</p>`:c&&c.srv!==false?`<p>The current case <b class="mono">${esc(idText())}</b> stays on the platform as it is.</p>`:draft?`<p>The unsent draft on this tablet${c.cad?` (<b class="mono">${esc(idText())}</b>)`:''} is discarded. Nothing of it has been sent.</p>`:''}
    <p>You will enter the CAD number of the new call from the MDT.</p>
    <div class="row"><button class="btn btn-q" data-act="close">Cancel</button><button class="btn btn-p btn-xl" data-act="newcase-go" ${pend?'disabled':''}>Open new STEMI case</button></div></div>`;
  }
  if(L.t==='same')return `<div class="scrim" data-act="close"></div><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dq"><h2 class="h2" id="dq">Is this a new patient?</h2><p>You already have an active case: <b class="mono">${idText()}</b> · ${esc(ptSummary())}.</p>
    <div class="col"><button class="btn btn-s btn-xl" data-act="same-ecg">Same patient: add an ECG to the open case</button><button class="btn btn-s btn-xl" data-act="same-new">New patient: open a new case</button></div><div class="row"><button class="btn btn-q" data-act="close">Cancel</button></div></div>`;
  if(L.t==='cancel')return `<div class="scrim" data-act="close"></div><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="cq"><h2 class="h2" id="cq">Cancel this case?</h2><p>The case is kept as CANCELLED with your reason. Nothing is deleted.</p>
    <div class="chips">${['Opened in error','Patient refused','Other'].map(w=>`<button class="cbtn ${L.why===w?'on':''}" data-act="cwhy" data-v="${w}">${L.why===w?IC.check:''}${w}</button>`).join('')}</div>
    <div class="row"><button class="btn btn-q" data-act="close">Keep the case</button><button class="btn btn-s" data-act="cancel-do" ${L.why?'':'disabled'}>Cancel case</button></div></div>`;
  if(L.t==='eta'){
    const b=`<div class="tbig"><b>${L.min} min</b><span>arrival about ${hm(now()+L.min*MIN)}</span></div>
      <div class="stepbtns"><button class="btn btn-q" data-act="eta-step" data-m="-5">−5 min</button><button class="btn btn-q" data-act="eta-step" data-m="-1">−1 min</button><button class="btn btn-q" data-act="eta-step" data-m="1">+1 min</button><button class="btn btn-q" data-act="eta-step" data-m="5">+5 min</button></div>`;
    return drawer('Update ETA',b,`<span class="sp"></span><button class="btn btn-p btn-xl" data-act="eta-save">Save and send</button>`);
  }
  if(L.t==='dec')return decLayer(L);
  if(L.t==='zoom'){const e=CASE.draft,s=selImg(e);
    return `<div class="zoom" role="dialog" aria-modal="true" aria-label="ECG zoom"><div class="zoom-h"><b>ECG ${e.n} · Image ${s.i} · as photographed · drag or scroll to move</b><button class="icon-btn" data-act="close" aria-label="Close">${IC.close}</button></div><div class="zoom-b"><img src="${s.img}" alt="ECG ${e.n}, image ${s.i}, at full size"></div></div>`;}
  if(L.t==='fail'){const f=CASE.failure;
    return `<div class="fail" role="alertdialog" aria-modal="true" aria-labelledby="ft">${idTag('C-08')}<div class="fail-in">
      <div class="fail-id mono">${idText()} · ECG ${f.n}</div><div class="fail-ic">${IC.bang}</div>
      <h2 id="ft">ECG not delivered.<br>Use the STEMI downtime route now.</h2>
      <div class="fail-call"><span>Call:</span><span class="ph">approved downtime number (Q-21)</span></div>
      <p class="fail-p">Your case is saved on this tablet and will keep retrying. Do not wait for it.</p>
      <p class="fail-r mono" data-tick="attempt">Retrying automatically · attempt ${f.attempts} · last try ${hms(f.last)}</p>
      <button class="btn btn-inv btn-xl" data-act="fail-ack">Downtime route in use</button></div></div>`;}
  return '';
}
/* after sending, a change to the minimum dataset says what it is: a new reading, a clarification or a correction */
function postTog(L){
  if(!L.post)return '';
  const vit=VIT.includes(L.k),opts=vit?[['update','New reading'],['correct','Correction of an earlier entry']]:[['clarify','Clarification'],['correct','Correction of an earlier entry']];
  const h=CASE.mdh[L.k]||[],cur=h[h.length-1];
  return `<div class="ptog"><span class="flab">This is</span><div class="chips">${opts.map(([k,l])=>`<button class="cbtn ${L.post===k?'on':''}" data-act="post-kind" data-v="${k}" aria-pressed="${L.post===k}">${L.post===k?IC.check:''}${l}</button>`).join('')}</div>${cur?`<p class="muted" style="margin:6px 0 0;font-size:15px">Current: <b>${esc(mdText(L.k,cur.a))}</b> · ${KINDL[cur.kind]} <span class="mono">${hm(cur.t)}</span>. It stays in the record.</p>`:''}</div>`;
}
/* C-09 minimal: the cardiologist's decision arrives full screen on the tablet (the full crew decision screens are a later round) */
function decLayer(L){
  const d=CASE.decs.find(x=>x.id===L.id);if(!d)return '';
  const h=CASE.dest&&CASE.dest.hosp?HOSP[CASE.dest.hosp].name:'the receiving PCI hospital';
  let body='';
  if(d.k==='confirm')body=`<p class="decv-p">Continue to <b>${h}</b>${CASE.dest&&CASE.dest.st==='conf'?' (destination confirmed)':' (recommended destination)'}.</p>${d.note?`<p class="decv-p">Note from ${esc(d.by)}: ${esc(d.note)}</p>`:''}<p class="decv-s">Hospital and cath-lab steps are the next design phase and are not shown here.</p>`;
  if(d.k==='not')body=`${d.reason?`<p class="decv-p">Reason: ${esc(d.reason)}</p>`:''}${d.adv?`<p class="decv-p">Advice: ${esc(d.adv)}</p>`:''}<p class="decv-s">Continue standard care. The case stays open, and you can still send a new ECG.</p>`;
  if(d.k==='repeat')body=`${d.reasons.length?`<p class="decv-p">${esc(d.reasons.join(', '))}</p>`:''}${d.instr?`<p class="decv-p">Instruction: ${esc(d.instr)}</p>`:''}${d.within?`<p class="decv-p">Within ${d.within} min</p>`:''}<p class="decv-s">Capture a new recording from the monitor. It is sent as ECG ${CASE.ecgs.length+1}.</p>`;
  return `<div class="decv decv-${d.k}" role="alertdialog" aria-modal="true" aria-labelledby="dvt">${idTag('C-09')}<div class="decv-in">
    <div class="decv-id mono">${idText()} · decision on ECG ${d.on}</div>
    <div class="decv-lab">DECISION RECEIVED</div>
    <h2 id="dvt">${DECL[d.k]}</h2>
    <p class="decv-by">${esc(d.byT||d.by)} · <span class="mono">${hms(d.at)}</span></p>${body}
    <div class="decv-acts">${d.k==='repeat'?'<button class="btn btn-inv btn-xl" data-act="dec-ack-rep">Acknowledge and capture repeat ECG</button><button class="btn btn-q btn-xl" data-act="dec-ack">Acknowledge</button>':'<button class="btn btn-inv btn-xl" data-act="dec-ack">Acknowledge</button>'}</div></div></div>`;
}
function recOk(L){
  if(L.opt==null)return false;const o=RECK[L.id].opts[L.opt];
  if(o.need==='text')return !!L.text.trim();
  if(o.need==='chips')return L.chips.size>0;
  if(o.need==='score')return L.score!=null;
  if(o.need==='num'||o.need==='vitals')return filled(L);
  return true;
}
const destOk=L=>!!L.pick&&!!L.why&&(L.why!=='Other'||!!L.text.trim());

/* ---------- render ---------- */
const VIEWS={'CAD':vCad,'C-03':vMd,'C-04':vCam,'C-05':vReview,'WS':vWs,'HO':vHo};
function render(){
  if(CASE&&CASE.recap&&view!=='C-04')endRecap();
  const scr=$('#view'),keep={},same=lastView===view&&lastCase===CASE;lastView=view;lastCase=CASE;
  const typing=document.activeElement&&document.activeElement.id==='cadin';
  if(same)$$('[data-keep]',scr).forEach(el=>keep[el.dataset.keep]=el.scrollTop);
  let h=topbar();
  if(view==='HIST')h+=`<main class="view">${vHist()}</main>`;
  else if(view==='C-01'||!CASE)h+=`<main class="view">${idTag('C-01')}${vHome()}</main>`;
  else{
    h+=caseHeader(view==='WS')+failBar();
    if(['CAD','C-03','C-05'].includes(view))h+=stepper(view);
    h+=`<main class="view">${view==='WS'||view==='CAD'||view==='HO'?'':idTag(view)}${VIEWS[view]()}</main>`;
  }
  scr.innerHTML=h;
  if(typing&&view==='CAD')focusCad();
  $$('[data-keep]',scr).forEach(el=>{if(keep[el.dataset.keep])el.scrollTop=keep[el.dataset.keep]});
  syncNote();
}
function renderTop(){const t=$('#view .tb');if(t)t.outerHTML=topbar()}
function renderRail(){
  if(view!=='WS'){if(view==='C-01')render();else renderTop();return}
  const r=$('.rail');if(!r){render();return}
  const st=r.scrollTop;r.innerHTML=railHtml();r.scrollTop=st;
  const chip=$('.ch .chip');if(chip)chip.outerHTML=stateChip();
  renderTop();
}
function renderMain(){
  if(view==='C-01'){render();return}if(view!=='WS')return;const m=$('.wmain');if(!m){render();return}
  const st=m.scrollTop;const tmp=document.createElement('div');tmp.innerHTML=vWs();
  m.innerHTML=tmp.querySelector('.wmain').innerHTML;m.scrollTop=st;
}
function renderLayer(){
  const el=$('#layer');el.innerHTML=layerHtml();
  syncNote();
  const f=el.querySelector('.decv button,.drawer .dr-b button,.dlg button,.fail button,.zoom button');if(f&&!el.contains(document.activeElement))f.focus({preventScroll:true});
}
let toastT=null;
function toast(msg,rev){const t=$('#toast');t.className='toast'+(rev?' rev':'');t.innerHTML=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>{t.hidden=true},rev?4200:2800)}

/* ---------- the page shows the spec for the screen in view ---------- */
const cur=()=>layer&&layer.t==='fail'?'C-08':layer&&layer.t==='dec'?'C-09':view==='WS'?focus:view;
let lastScr='';
function syncNote(){
  const id=cur(),loc={cap:CASE&&(CASE.draft||CASE.ecgs.length)?Math.min(...(CASE.draft||CASE.ecgs[0]).imgs.map(x=>x.at)):null,md:CASE&&CASE.mdDone?CASE.mdAt:null};
  const sig=id+'|'+loc.cap+'|'+loc.md;if(sig===lastScr)return;lastScr=sig;post({t:'screen',id,local:loc});
}

/* ---------- capture ---------- */
function fillMd(t){
  const at=t||now();
  Object.assign(CASE.md,{age:{v:54,est:false},sex:{v:'Male'},complaint:{v:'cp',det:'Central, crushing, with sweating and nausea'},onset:{v:rmin(at-36*MIN),approx:true},bp:{sys:118,dia:74,at},hr:{v:84,at},spo2:{v:96,at},gcs:{v:15}});
  touch();
}
/* Upload: a real image file from this computer, made into a JPEG of at most 2000 px before it is stored */
function pickFile(){
  /* kept in the page while the file dialog is open: some Safari versions ignore a file input that is not */
  document.querySelectorAll('input.pick-file').forEach(x=>x.remove());
  const inp=document.createElement('input');inp.type='file';inp.accept='image/jpeg,image/png,image/*';inp.className='pick-file';inp.style.display='none';
  document.body.appendChild(inp);
  inp.onchange=()=>{const f=inp.files&&inp.files[0];inp.remove();if(!f||!CASE)return;
    fileToJpeg(f).then(img=>{const c=CASE;if(!c)return;if(c.addTo){captureSent('upload',img);return}
      capture(null,img);ev(`ECG ${c.draft.n} image uploaded from a file (${f.name})`,ME);touch();view='C-05';render()},
      ()=>toast('That file could not be read as an image. Use a JPEG or PNG.',true))};
  inp.click();
}
function fileToJpeg(f){
  return new Promise((res,rej)=>{const u=URL.createObjectURL(f),im=new Image();
    im.onload=()=>{const s=Math.min(1,2000/Math.max(im.naturalWidth,im.naturalHeight)),cv=document.createElement('canvas');
      cv.width=Math.round(im.naturalWidth*s);cv.height=Math.round(im.naturalHeight*s);cv.getContext('2d').drawImage(im,0,0,cv.width,cv.height);
      URL.revokeObjectURL(u);res(cv.toDataURL('image/jpeg',.88))};
    im.onerror=()=>{URL.revokeObjectURL(u);rej()};im.src=u});
}
function capture(t,file){
  const c=CASE,m=camMode(),r=c.recap,at=t||now(),q=file?'file':SC.quality;c.recap=null;c.nextN=null;
  let d=c.draft;
  if(m.k==='new'||!d)d=c.draft={n:m.n,imgs:[],pri:m.i,sel:m.i,v:m.v,acq:Math.floor(at/1000)*1000};
  d.imgs.push({i:m.i,at,q,kind:file?'full':KIND[(m.i-1)%3],img:file||shot(d.v,m.i,q,d.acq),src:file?'file':'gen'});d.imgs.sort((a,b)=>a.i-b.i);d.sel=m.i;
  if(r&&r.pri)d.pri=m.i;
  ev(m.k==='new'?`ECG ${d.n} acquired`:m.k==='add'?`ECG ${d.n} image ${m.i} added`:`ECG ${d.n} image ${m.i} recaptured`,ME,at);
  ev(`ECG ${d.n} image ${m.i} check on tablet: ${QUAL[q].t}`,'Tablet',at+800);
}
/* another photo of an ECG already sent: an image of that ECG, never a new ECG (Hamad, 3 Oct 2026, point 13) */
function captureSent(how,file){
  const c=CASE,e=c.ecgs[c.addTo-1],i=freeSlot(e),at=now(),q=file?'file':SC.quality;c.addTo=null;
  const x={i,at,q,kind:file?'full':KIND[(i-1)%3],img:file||shot(e.v,i,q,e.acq),src:file?'file':'gen',after:true};
  e.imgs.push(x);e.imgs.sort((a,b)=>a.i-b.i);
  PENDIMG.push({n:e.n,i});saveLocal();pumpImgs();
  ev(`Image ${i} ${how==='upload'?'uploaded':'captured'} and added to ECG ${e.n} after sending`,ME,at);
  view='WS';focus='C-07c';render();scrollToRegion('C-07c');
  toast(`Image ${i} added to ECG ${e.n}${SC.online?' and sent':'. It sends when the connection returns'}. It is not a new ECG.`);
}
/* leaving the camera without a new photo after Recapture: the discarded image stays discarded */
function endRecap(){
  const c=CASE,d=c.draft;c.recap=null;if(!d)return;
  if(!d.imgs.some(x=>x.i===d.pri)){d.pri=d.imgs[0].i;ev(`ECG ${d.n} image ${d.pri} is now primary`,'Tablet')}
  if(!d.imgs.some(x=>x.i===d.sel))d.sel=d.pri;
}
function removeImg(){
  const d=CASE.draft,s=selImg(d);if(d.imgs.length<2)return;
  ev(`ECG ${d.n} image ${s.i} discarded before sending`,ME);d.imgs=d.imgs.filter(x=>x!==s);
  if(s.i===d.pri){d.pri=d.imgs[0].i;ev(`ECG ${d.n} image ${d.pri} is now primary`,'Tablet')}
  d.sel=d.pri;
}
const focusSel=()=>{const b=$('.thumb.on');if(b)b.focus({preventScroll:true})};
function scrollToRegion(id){const el=$(id==='C-07b'?'#r-dest':id==='C-07a'?'#r-vit':id==='C-07c'?'#r-ecgs':id==='C-07d'?'#r-ai':'.rail');if(el&&view==='WS'){const m=$('.wmain');if(m&&id!=='C-07'&&SC.orient!=='port'&&$('#device').classList.contains('land'))m.scrollTop=el.offsetTop-12;else el.scrollIntoView({block:'start',behavior:'smooth'})}}

/* ---------- transmission: the tablet uploads, the platform confirms receipt in the shared record ---------- */
function send(opts){
  opts=opts||{};const c=CASE,e=c.draft;c.draft=null;c.ecgs.push(e);
  e.tx={stage:'check',pct:0,subAt:now()};e.aiR=null;
  ev(`ECG ${e.n} sent${nImgs(e)}`,ME);
  if(e.n===1)c.state='TRANSMITTING';
  if(c.repeatAsked&&e.n>c.repeatFor)c.repeatSent=true;
  view='WS';focus='C-07';layer=null;$('#layer').innerHTML='';render();
  setT(450,()=>{
    if(!SC.online){e.tx.stage='noconn';fail(e);return}
    e.tx.conAt=now();e.tx.stage='up';renderRail();
    /* the platform creates the case under the CAD number first (refused if a case already exists under it); then the
       images are uploaded and stored on the server; the progress is the real upload */
    ensureCase().then(ok=>{
      if(!ok){unsend(e);return}
      return uploadEcg(e).then(()=>{if(e.tx.stage!=='up')return;e.tx.upAt=now();e.tx.pct=100;renderRail();setT(250,()=>deliverEcg(e))});
    }).catch(()=>{if(e.tx.stage==='up'){e.tx.stage='fail';fail(e)}});
  });
}
/* create the case on the platform under the CAD number the EMT entered. Resolves true when it exists (created now, or by an
   earlier attempt of this tablet), false when the number must be corrected or the existing case opened; rejects without a
   connection (the normal failure route then applies) */
let creating=null;
function ensureCase(){
  const c=CASE;
  if(!c||c.srv!==false)return Promise.resolve(true);
  if(creating)return creating;
  creating=LIVE.request('POST','/api/cases',{cad:c.cad,cid:c.cid,openedAt:c.openedAt,hist:c.cadHist}).then(x=>{
    const b=x.body||{};
    if(x.status===200||x.status===201){
      c.srv=true;c.cadDup=null;c.cad=b.cad;CAD=b.cad;OUTQ.forEach(o=>{o.cad=b.cad});
      if(CASE===c&&b.rec&&b.rec.cad===CAD)SRV=b.rec;
      ev(`Case created on the platform under CAD #${b.cad} · no existing case with this number`,'Platform');
      saveLocal();setT(0,()=>{pumpImgs();flush()});return true;
    }
    if(x.status===409&&b.code==='exists'){c.cadDup=true;layer={t:'dup',cad:b.cad,ex:b.existing};return false}
    if(x.status===400){c.cadDup=true;c.cadEdit={val:c.cad,err:b.error||CADN.MSG,detail:b.detail||'',busy:false};layer=null;return false}
    throw new Error('HTTP '+x.status);
  }).finally(()=>{creating=null});
  return creating;
}
/* the platform did not take the case under this CAD number: the ECG goes back to the tablet as the unsent draft, nothing lost */
function unsend(e){
  const c=CASE;if(!c)return;
  const i=c.ecgs.indexOf(e);if(i>=0)c.ecgs.splice(i,1);
  delete e.tx;delete e.aiR;c.draft=e;c.failure=null;
  const dup=layer&&layer.t==='dup';
  ev(`ECG ${e.n} not sent: ${dup?`CASE ALREADY EXISTS under CAD #${c.cad}`:'the CAD number needs correcting'}`,'Platform');
  deriveState();saveLocal();
  if(dup){view='C-05';render();renderLayer()}else{view='CAD';render();focusCad()}
}
function uploadImg(x,onP){
  if(x.imageId)return Promise.resolve();
  return LIVE.upload(dataUrlToBlob(x.img),{cad:CAD,src:x.src==='file'?'file':'gen'},onP).then(r=>{x.imageId=r.id;x.url=r.url;x.img=r.url;saveLocal()});
}
async function uploadEcg(e){
  const L=e.imgs;
  for(let k=0;k<L.length;k++){await uploadImg(L[k],f=>{e.tx.pct=Math.round((k+f)/L.length*100);renderRail()});e.tx.pct=Math.round((k+1)/L.length*100);renderRail()}
}
/* an image added after sending is uploaded, then its action is sent; without a connection both wait and go in order on reconnection */
let PENDIMG=[],pumping=false;
async function pumpImgs(){
  if(pumping||!SC.online||!CASE||localOnly())return;pumping=true;
  try{
    while(PENDIMG.length&&SC.online){
      const p=PENDIMG[0],e=CASE.ecgs[p.n-1],x=e&&e.imgs.find(y=>y.i===p.i);
      if(!x){PENDIMG.shift();continue}
      await uploadImg(x);
      x.opId=op('img',{n:e.n,img:{i:x.i,kind:x.kind,q:x.q,at:x.at,imageId:x.imageId}}).id;PENDIMG.shift();saveLocal();renderMain();
    }
  }catch(_){}finally{pumping=false}
}
const ecgPayload=e=>({n:e.n,acq:e.acq,variant:e.v,pri:e.pri,same:e.n>2,timeWhy:e.timeWhy||null,imgs:e.imgs.map(x=>({i:x.i,kind:x.kind,q:x.q,at:x.at,imageId:x.imageId}))});
function mdPayload(){const o={};MD.forEach(f=>{const a=CASE.md[f.k];o[f.k]={v:mdText(f.k,a),raw:a,t:a&&a.at||CASE.mdAt||now()}});return o}
function deliverEcg(e,late){
  if(!SC.online){e.tx.stage='fail';fail(e);return}
  const first=e.n===1;
  e.tx.stage='wait';
  e.tx.opId=op(first?'submit':'ecg',{sendAt:e.tx.subAt,ecg:ecgPayload(e),md:first?mdPayload():undefined,late:!!late,ev:first?[{t:CASE.mdAt||now(),text:'Minimum dataset entered'}]:undefined}).id;
  if(first)MD.forEach(f=>{CASE.mdh[f.k]=[{a:CASE.md[f.k],t:CASE.md[f.k]&&CASE.md[f.k].at||CASE.mdAt||now(),kind:'sent'}]});
  renderRail();
}
function received(e,rcv){
  const c=CASE;e.tx.stage='rcv';e.tx.rcvAt=rcv;
  ev(e.tx.late?`Delivered late – downtime route already in use · ECG ${e.n}`:`Platform received ECG ${e.n}${nImgs(e)}${e.n===1?' and the case':''}`,'Platform',rcv);
  if(e.n===1){c.waitFrom=rcv;if(!c.dest)c.dest={st:'finding'}}
  else if(c.alert)ev(`${c.alert.who}'s screen updated: ECG ${e.n} added to the case (no alarm)`,'Platform',rcv);
}
function fail(e){
  const c=CASE;c.failure={n:e.n,at:now(),attempts:1,last:now(),ackAt:null,late:null};
  ev(`Transmission failed · ECG ${e.n} · downtime instruction shown`,'Tablet');
  layer={t:'fail'};deriveState();render();renderLayer();
}
/* the automatic retry after a failed Send: upload what is missing, then deliver. The case is marked delivered late,
   because the crew was already told to use the downtime route */
let retrying=false;
function late(){
  const c=CASE;if(!c||!c.failure||c.failure.late||retrying)return;
  const e=c.ecgs[c.failure.n-1];retrying=true;
  ensureCase().then(ok=>ok?uploadEcg(e).then(()=>true):false).then(ok=>{retrying=false;if(CASE!==c)return;
    if(!ok){if(layer&&layer.t==='fail')layer=null;unsend(e);return}
    if(c.failure.late)return;c.failure.late=now();
    e.tx.conAt=e.tx.conAt||now();e.tx.upAt=e.tx.upAt||now();e.tx.pct=100;e.tx.late=true;
    if(layer&&layer.t==='fail'){layer=null;renderLayer()}
    view='WS';render();deliverEcg(e,true)},()=>{retrying=false});
}

/* ---------- reading the shared record: what the platform and the cardiologist did reaches the crew here ---------- */
function deriveState(){
  const c=CASE;if(!c)return;const d=lastDec(),e1=c.ecgs[0],L=c.life||{};
  /* the journey after the decision maps onto the existing states: TRANSPORTING → ARRIVED → HANDOVER IN PROGRESS →
     HANDOVER COMPLETED (internal status: closed) */
  if(c.cancelled)c.state='CANCELLED';
  else if(L.closed)c.state='HANDOVER COMPLETED';
  else if(c.failure&&!c.failure.late)c.state='TRANSMISSION FAILED';
  else if(L.arr&&(L.ho||L.hopen||L.fv))c.state='HANDOVER IN PROGRESS';
  else if(L.arr)c.state='ARRIVED';
  else if(d&&c.eta&&c.eta.dep)c.state='TRANSPORTING';
  else if(d)c.state=d.k==='confirm'?'CONFIRMED STEMI':d.k==='not'?'NOT STEMI':(c.ecgs.some(x=>x.tx.rcvAt>d.at)?'UNDER REVIEW':'REPEAT ECG REQUESTED');
  else if(c.ack)c.state='UNDER REVIEW';
  else if(e1&&e1.tx.rcvAt)c.state=e1.tx.late?'DOWNTIME CASE':'AWAITING CARDIOLOGIST';
  else if(e1)c.state='TRANSMITTING';
  else c.state='DRAFT';
}
const lastOf=a=>a&&a.length?a[a.length-1]:null;
const lifeOf=S=>({arr:lastOf(S.arr),ho:lastOf(S.ho),fv:lastOf(S.fv),hopen:S.hopen||null,closed:S.closed||null});
function applySnap(){
  const c=CASE,S=SRV;if(c&&S){const was=c.life&&c.life.closed;c.life=lifeOf(S);
    /* closed (handover completed): the case is read-only and leaves the active list */
    if(c.life.closed&&!was&&view!=='C-01'&&view!=='HIST'){view='C-01';layer=null;$('#layer').innerHTML='';HLIST=null}}
  if(!c||!S||!S.sub){if(c)deriveState();refreshAll();return}
  c.ecgs.forEach(e=>{
    const s=S.ecgs[e.n-1];if(!s)return;
    if(s.rcv&&!e.tx.rcvAt){received(e,s.rcv);c.aiSel=null}
    /* the platform's analysis of this ECG, exactly as the cardiologist receives it. A later ECG's analysis is a new
       analysis: it is marked NEW and the earlier one stays, one tap away and in the case timeline */
    if(s.ai){const st=s.ai.st,was=e.aiR&&e.aiR.st;e.aiR=s.ai;
      if(st!==was&&st!=='proc'){
        const k=e.n>1?`New ECG analysis · ECG ${e.n}`:`AI ECG interpretation · ECG ${e.n}`;
        ev(st==='down'?`AI interpretation unavailable · ECG ${e.n}`:st==='wh'?`AI interpretation limited — ECG quality insufficient · ECG ${e.n} · no interpretation`:`${k}${st==='lim'?' · limited by ECG quality':''}: ${s.ai.imp}${e.n>1?` The analysis of ECG ${e.n-1} is kept.`:''}`,'AI service (decision support)',s.ai.done);
        c.aiSel=null;if(e.n>1)c.aiNew=e.n;}
      if((st==='lim'||st==='wh')&&!e.repFlag){e.repFlag=1;c.repeatAsked=true;c.repeatFor=e.n;c.repeatSent=false}}
  });
  const d0=S.dest[0];
  if(d0&&(!c.dest||c.dest.st==='finding')){c.dest={st:'rec',hosp:d0.hosp,reason:d0.reason,recAt:d0.t};ev(`Provisional destination recommended: ${HOSP[d0.hosp].name}`,'Destination engine',d0.t)}
  if(S.alert){
    if(!c.alert){c.alert={at:S.alert.at,who:S.alert.who,hosp:S.alert.hosp};ev(`Cardiologist alerted: ${S.alert.who}, on duty, ${HOSP[S.alert.hosp].name}`,'Platform',S.alert.at)}
    S.alert.rem.forEach(t=>{if(!c.rem.includes(t)){c.rem.push(t);ev(`Reminder sent to ${S.alert.who}: case not yet acknowledged`,'Platform',t)}});
    S.alert.esc.forEach(x=>{if(!c.esc.some(y=>y.at===x.t)){const t=x.lv===1?'Backup cardiologist alerted':'ACC duty officer alerted';c.esc.push({t,who:x.to,at:x.t});ev(`Escalation level ${x.lv}: ${t}`,'Platform',x.t)}});
  }
  if(S.ack&&!c.ack){c.ack={at:S.ack,who:S.alert.who};ev(`${S.alert.who} acknowledged the case`,S.alert.who,S.ack)}
  if(S.opened&&!c.opened){c.opened=S.opened;ev(`${S.alert.who} opened the ECG · reviewing`,S.alert.who,S.opened)}
  S.dec.forEach(x=>{
    const y=c.decs.find(z=>z.id===x.id);
    if(y){y.crewAck=x.crewAck||y.crewAck;y.dlv=x.dlv;return}
    const nd={...x};c.decs.push(nd);
    ev(`Decision received: ${DECL[x.k]} · ${x.by}`,x.byT||x.by,x.at);
    if(x.k==='repeat'){c.repeatAsked=true;c.repeatFor=c.ecgs.length;c.repeatSent=false}
    op('decrcv',{id:x.id});
    /* an entry the crew is typing is kept and comes back after the decision is acknowledged */
    if(layer&&['md','rec','eta','dest'].includes(layer.t))c.held=layer;
    layer={t:'dec',id:x.id};c.addTo=null;c.recap=null;
    if(view==='C-04'&&!c.draft)view=c.ecgs.length?'WS':view;
    renderLayer();
  });
  deriveState();refreshAll();
}
function refreshAll(){
  if(view==='WS'){renderRail();renderMain()}else if(view==='C-01'||view==='HO')render();else renderTop();
}

/* ---------- actions ---------- */
const unsent=()=>{view='C-05';render();toast(`ECG ${CASE.draft.n} is not sent yet. The prototype holds one unsent ECG at a time, so it opens ECG ${CASE.draft.n}.`,true)};
function mdPost(k,a,kind){
  const c=CASE,t=a&&a.at?a.at:now(),v={a,t,kind,opId:null};
  c.md[k]=a;
  const h=c.mdh[k]||(c.mdh[k]=[]),prev=h[h.length-1];
  v.opId=op('md',{k,v:mdText(k,a),raw:a,at:t,kind,why:kind==='correct'?'Correction of an earlier entry':''}).id;
  h.push(v);
  ev(`${MDK[k].label} ${kind==='correct'?'corrected':kind==='clarify'?'clarified':'updated'}: ${mdText(k,a)}${prev?` (earlier ${mdText(k,prev.a)} kept)`:''}`,ME,now());
  touch();
}
function closeMd(a){
  const L=layer;
  if(L.post){mdPost(L.k,a,L.post);layer=null;renderLayer();renderMain();renderRail();return}
  CASE.md[L.k]=a;touch();layer=null;renderLayer();render();
}
function act(a,el){
  const c=CASE;const d=el.dataset;
  switch(a){
  case 'home':view='C-01';render();break;
  case 'open-path':
    /* the case starts on this tablet; the EMT enters the CAD number next. The platform creates the case under it at Send */
    clearTimers();CASE=newCase();CAD='';SRV=null;OUTQ=[];PENDIMG=[];layer=null;$('#layer').innerHTML='';
    ev('STEMI pathway opened on this tablet · CAD number to be entered by the crew',ME);
    view='CAD';saveLocal();render();focusCad();break;
  case 'new-case':layer={t:'newcase'};renderLayer();break;
  case 'newcase-go':if(OUTQ.length||PENDIMG.length)break;layer=null;renderLayer();act('open-path',el);break;
  case 'open-case':view=!c.cad?'CAD':c.ecgs.length?'WS':c.draft?'C-05':'C-04';focus='C-07';render();if(view==='CAD')focusCad();break;
  case 'cad-edit':if(c&&!cadLocked()){view='CAD';render();focusCad()}break;
  /* ---------- transport, arrival, handover ---------- */
  case 'handover':if(!c||!c.ecgs.length)break;view='HO';render();break;
  case 'ho-back':view='WS';render();break;
  case 'mark-arrived':case 'arrive-now':{
    const h=(c.life&&c.life.arr&&c.life.arr.hosp)||(c.dest&&c.dest.hosp)||'A',t=now();
    op('arrive',{hosp:h,at:t},t);ev(`Arrived at ${HOSP[h].name}`,ME);toast(`Arrival recorded: ${HOSP[h].name} · ${hm(t)}`);view='HO';render();break;}
  case 'arr-edit':{const A=c.life&&c.life.arr;layer={t:'arr',hosp:A?A.hosp:(c.dest&&c.dest.hosp)||null,tm:A?A.at:rmin(now())};renderLayer();break;}
  case 'arr-hosp':layer.hosp=d.v;renderLayer();break;
  case 'arr-save':if(!layer.hosp)break;op('arrive',{hosp:layer.hosp,at:layer.tm});ev(`Arrival corrected: ${HOSP[layer.hosp].name} · ${hm(layer.tm)}`,ME);layer=null;renderLayer();break;
  case 'ho-edit':{const H=c.life&&c.life.ho;layer={t:'ho',at:H&&H.at?H.at:now(),area:H?H.area:null,other:(H&&H.other)||'',name:(H&&H.name)||'',role:(H&&H.role)||'',crew:(H&&H.crew)||`${ME}, ${ROLE} · ${UNIT}`,notes:(H&&H.notes)||''};renderLayer();break;}
  case 'ho-now':layer.at=now();renderLayer();break;
  case 'ho-at':layer.at=Math.min(now(),(layer.at||now())+Number(d.d)*MIN);renderLayer();break;
  case 'ho-area':layer.area=layer.area===d.v?null:d.v;renderLayer();break;
  case 'ho-save':{const L=layer;if(L.area==='Other'&&!L.other.trim())break;
    op('ho',{at:L.at,area:L.area,other:L.other,name:L.name,role:L.role,crew:L.crew,notes:L.notes});ev('Transfer of care details saved',ME);layer=null;renderLayer();break;}
  case 'fv-confirm':op('fv');ev('Final vitals at handover confirmed',ME);toast('Final vitals at handover confirmed.');break;
  case 'ho-img':{const S=view==='HIST'?HREC:SRV,e=S&&S.ecgs[Number(d.n)-1];if(!e)break;const x=e.imgs.find(i=>i.i===e.pri)||e.imgs[0];
    layer={t:'hoimg',url:x.url,label:`ECG ${e.n} · acquired ${hm(e.acq)} · primary image`};renderLayer();break;}
  case 'ho-complete':if(!SRV||SRV.hoMissing.length){toast('Complete the items listed on the page first.',true);break}layer={t:'hoconfirm'};renderLayer();break;
  case 'ho-close':{
    if(!SC.online||OUTQ.length){layer.err='Waiting for the connection and for your latest entries to be sent. Try again in a moment.';renderLayer();break}
    layer.busy=true;layer.err='';renderLayer();
    LIVE.request('POST','/api/cases/close',{cad:CAD}).then(x=>{const b=x.body||{};
      if(x.status===200&&b.ok){layer=null;renderLayer();c.life={...c.life,closed:{at:now(),by:`${ME}, ${ROLE}`}};deriveState();view='C-01';HLIST=null;render();
        toast(`<b>Handover completed.</b> Case CAD #${esc(b.cad)} is closed and read-only.`,true);return}
      layer={t:'hoconfirm',err:b.missing?'Complete first: '+b.missing.join(', '):(b.error||'The case could not be closed.')};renderLayer();
    },()=>{layer={t:'hoconfirm',err:'No connection: the case could not be closed. Try again.'};renderLayer()});
    break;}
  case 'hist-open':{const cad=d.cad;HREC=null;view='HIST';render();
    LIVE.request('GET','/api/cases/view?cad='+encodeURIComponent(cad)).then(x=>{if(x.status===200){HREC=x.body.rec;if(view==='HIST')render()}else toast('This completed case could not be opened.',true)},()=>toast('No connection.',true));break;}
  case 'hist-back':view='C-01';HREC=null;render();break;
  case 'cad-ok':{
    if(!c||cadLocked()||c.cadEdit.busy)break;
    const inp=$('#cadin');if(inp)c.cadEdit.val=inp.value;
    const r=CADN.check(c.cadEdit.val);
    /* an invalid number shows an inline message; nothing else on the case is touched */
    if(!r.ok){c.cadEdit={...c.cadEdit,err:r.error,detail:r.detail};render();focusCad();break}
    c.cadEdit.val=r.cad;
    if(r.cad===c.cad&&!c.cadDup){cadAccept(c,r.cad);break}
    if(!SC.online){cadAccept(c,r.cad,true);break}
    c.cadEdit={...c.cadEdit,busy:true,err:'',detail:''};render();
    LIVE.request('GET','/api/cases/check?cad='+encodeURIComponent(r.cad)).then(x=>{
      c.cadEdit.busy=false;if(CASE!==c)return;
      const b=x.body||{};
      if(x.status!==200){cadAccept(c,r.cad,true);return}
      if(!b.ok){c.cadEdit={...c.cadEdit,err:b.error||CADN.MSG,detail:b.detail||''};render();focusCad();return}
      if(b.exists){render();layer={t:'dup',cad:b.cad,ex:b.existing};renderLayer();return}
      cadAccept(c,b.cad);
    },()=>{c.cadEdit.busy=false;if(CASE===c)cadAccept(c,r.cad,true)});
    break;}
  case 'dup-fix':{
    const v=layer&&layer.cad;layer=null;renderLayer();if(!c)break;
    c.cadEdit={val:v||c.cadEdit.val,err:`CASE ALREADY EXISTS under CAD #${v}.`,detail:'Check the CAD number on the MDT and correct it, or open the existing case.',busy:false};
    view='CAD';render();focusCad();break;}
  case 'dup-open':{
    const v=layer&&layer.cad;if(!v)break;
    if(!SC.online){toast('No connection: the existing case cannot be opened now.',true);break}
    LIVE.request('POST','/api/cases/open',{cad:v}).then(x=>{
      const b=x.body||{};
      if(x.status!==200||!b.ok){toast(esc(b.error||'The existing case could not be opened.'),true);return}
      /* the existing case replaces this tablet's unsent draft; nothing is created or overwritten on the platform */
      clearTimers();layer=null;renderLayer();CASE=null;SRV=null;OUTQ=[];PENDIMG=[];CAD=b.cad;
      try{localStorage.removeItem(LSK)}catch(_){}
      if(b.rec&&b.rec.cad===CAD&&b.rec.path){SRV=b.rec;CASE=hydrate(SRV);applySnap()}
      view=CASE&&CASE.ecgs.length?'WS':'C-01';render();saveLocal();
      toast(`<b>Existing case CAD #${esc(b.cad)} opened.</b> No second case was created.`,true);
    },()=>toast('No connection: the existing case cannot be opened now.',true));
    break;}
  case 'show-note':break;
  case 'step':{
    const k=d.k;
    if(k==='CAD'){if(!cadLocked()){view='CAD';render();focusCad()}break}
    if(k==='C-03'){view='C-03';render();break}
    if(k==='C-04'){view=c.draft&&c.draft.imgs.length>=MAXI?'C-05':c.draft?'C-05':'C-04';render();break}
    if(k==='C-05'){view=c.draft?'C-05':'C-04';render();break}
    break;}
  case 'set':c.md[d.k]={v:d.k==='gcs'?Number(d.v):d.v};touch();render();break;
  case 'nv':c.md[d.k]=c.md[d.k]&&c.md[d.k].nv===d.v?null:{nv:d.v};touch();render();break;
  case 'open':openMd(d.k);break;
  case 'mdup':openMd(d.k,VIT.includes(d.k)?'update':'clarify');break;
  case 'post-kind':layer.post=d.v;renderLayer();break;
  case 'nvclose':if(layer&&layer.post){closeMd({nv:d.v,at:now()});break}c.md[d.k]={nv:d.v};touch();layer=null;renderLayer();render();break;
  case 'part':layer.pi=Number(d.i);renderLayer();break;
  case 'est':layer.est=!layer.est;renderLayer();break;
  case 'approx':layer.approx=!layer.approx;renderLayer();break;
  case 'at':layer.at=Number(d.d)===0?now():layer.at+Number(d.d)*MIN;if(layer.at>now())layer.at=now();renderLayer();break;
  case 'tq':layer.tm=rmin(now()-Number(d.m)*MIN);if(layer.t==='md')layer.approx=Number(d.m)>0;renderLayer();break;
  case 'tstep':layer.tm=Math.min(rmin(now())+(layer.t==='etime'?MIN:0),layer.tm+Number(d.m)*MIN);renderLayer();break;
  case 'md-done':{
    const L=layer;
    if(L.k==='onset'){closeMd({v:L.tm,approx:L.approx});break}
    if(!filled(L))break;if(partsErr(L,true)){L.tried=true;renderLayer();break}const v=L.parts.map(p=>Number(p.v));
    if(L.k==='age')closeMd({v:v[0],est:L.est});if(L.k==='bp')closeMd({sys:v[0],dia:v[1],at:L.at});
    if(L.k==='hr')closeMd({v:v[0],at:L.at});if(L.k==='spo2')closeMd({v:v[0],at:L.at});
    break;}
  case 'cpick':
    if(d.v==='oth'||layer.post){layer.sel=d.v;renderLayer();if(d.v==='oth'){const i=$('#cdet');if(i)i.focus()}break}
    c.md.complaint={v:d.v,det:layer.det.trim()};touch();layer=null;renderLayer();render();break;
  case 'c-done':closeMd({v:layer.sel,det:layer.det.trim()});break;
  case 'gcs':if(layer&&layer.post){closeMd({v:Number(d.v),at:now()});break}c.md.gcs={v:Number(d.v)};touch();layer=null;renderLayer();render();break;
  case 'sexpick':layer.sel=d.v;renderLayer();break;
  case 'sex-done':closeMd({v:layer.sel});break;
  case 'light':SC.light=!SC.light;render();break;
  case 'cam-cancel':if(c.recap)endRecap();c.addTo=null;view=c.draft?'C-05':c.ecgs.length?'WS':'C-01';c.nextN=null;render();break;
  case 'upload':pickFile();break;
  case 'shoot':{
    const f=$('#flash');if(f&&!RM.matches){f.classList.remove('go');void f.offsetWidth;f.classList.add('go')}
    setT(RM.matches?0:180,()=>{if(c.addTo){captureSent(a);return}capture();touch();view='C-05';render()});break;}
  case 'recapture':if(c.draft){const e=c.draft,s=selImg(e);ev(`ECG ${e.n} image ${s.i} capture discarded before sending`,ME);
      c.recap={n:e.n,i:s.i,pri:s.i===e.pri};e.imgs=e.imgs.filter(x=>x!==s);if(!e.imgs.length)c.draft=null}
    view='C-04';render();break;
  case 'sel-img':c.draft.sel=Number(d.i);render();focusSel();break;
  case 'make-pri':{const e=c.draft,s=selImg(e);e.pri=s.i;ev(`ECG ${e.n} image ${s.i} made primary`,ME);touch();render();focusSel();break}
  case 'rm-img':removeImg();touch();render();focusSel();break;
  case 'add-img':view='C-04';render();break;
  case 'add-sent':if(c.draft){unsent();break}c.addTo=Number(d.n);view='C-04';render();break;
  case 'zoom':layer={t:'zoom'};renderLayer();break;
  case 'ecg-time':layer={t:'etime',tm:rmin(c.draft.time||ecgAt(c.draft)),why:null,text:''};renderLayer();break;
  case 'ewhy':layer.why=d.v;renderLayer();break;
  case 'esave':c.draft.time=layer.tm;c.draft.timeWhy=layer.why==='Other'?layer.text.trim():layer.why+(layer.text.trim()?': '+layer.text.trim():'');ev(`ECG ${c.draft.n} time changed to ${hm(layer.tm)} · reason: ${c.draft.timeWhy}`,ME);touch();layer=null;renderLayer();render();break;
  case 'send':
    if(!c.cad){c.cadEdit={...c.cadEdit,err:CADN.MSG,detail:'The CAD number is empty.'};view='CAD';render();focusCad();break}
    if(MD.every(f=>c.md[f.k]))send();break;
  case 'add-ecg':case 'repeat':
    if(c.draft){unsent();break}
    c.addTo=null;c.nextN=c.ecgs.length+1;view='C-04';render();break;
  case 'show-fail':layer={t:'fail'};renderLayer();break;
  case 'fail-ack':c.failure.ackAt=now();op('downtime',{},c.failure.ackAt);ev('Downtime route in use · confirmed on the tablet',ME);layer=null;renderLayer();render();break;
  case 'show-dec':{const x=lastDec();if(x){layer={t:'dec',id:x.id};renderLayer()}break}
  case 'dec-ack':case 'dec-ack-rep':{
    const x=c.decs.find(z=>z.id===layer.id);if(x&&!x.crewAck){x.crewAck=now();op('decack',{id:x.id},x.crewAck);ev(`Decision acknowledged: ${DECL[x.k]}`,ME)}
    layer=null;
    if(a==='dec-ack-rep'){c.held=null;renderLayer();act('repeat',el);break}
    view='WS';render();layer=c.held||null;c.held=null;renderLayer();break;}
  case 'dest-accept':{const h=c.dest.hosp;c.dest={...c.dest,st:'conf',at:now(),by:ME};op('dest',{hosp:h,st:'conf'});ev(`Destination confirmed: ${HOSP[h].name} · by ${ME} · ACC notified`,ME);renderMain();renderRail();toast(`Destination confirmed: ${HOSP[h].name}. ACC notified.`);break}
  case 'dest-change':layer={t:'dest',pick:null,why:null,text:''};renderLayer();break;
  case 'dpick':layer.pick=d.v;renderLayer();break;
  case 'dwhy':layer.why=d.v;renderLayer();break;
  case 'dconfirm':{
    const L=layer,prev=c.dest.hosp,why=L.why==='Other'?L.text.trim():L.why+(L.text.trim()?': '+L.text.trim():'');
    c.dest={...c.dest,st:'conf',hosp:L.pick,from:prev,why,at:now(),by:ME};
    op('dest',{hosp:L.pick,st:'chg',why,from:prev});
    ev(`Destination changed: ${HOSP[prev].name} to ${HOSP[L.pick].name} · reason: ${why}`,ME);
    if(c.eta){c.eta={...c.eta,min:HOSP[L.pick].eta,upd:now()};op('eta',{min:c.eta.min,why:'upd'})}
    layer=null;renderLayer();render();toast(`Destination changed to ${HOSP[L.pick].name}. ACC notified.`);break;}
  case 'depart':{const h=HOSP[c.dest.hosp];c.eta={dep:now(),min:h.eta,upd:null};op('eta',{min:h.eta,dep:c.eta.dep,why:'dep'});ev(`Transport started (departed scene) · ETA ${h.eta} min`,ME);deriveState();if(view==='HO')render();else{renderMain();renderRail()}break}
  case 'eta':layer={t:'eta',min:c.eta.min};renderLayer();break;
  case 'eta-step':layer.min=Math.max(1,layer.min+Number(d.m));renderLayer();break;
  case 'eta-save':c.eta={...c.eta,min:layer.min,upd:now()};op('eta',{min:layer.min,why:'upd'});ev(`ETA updated: ${layer.min} min`,ME);layer=null;renderLayer();renderMain();break;
  case 'to-dest':focus='C-07b';syncNote();scrollToRegion('C-07b');break;
  case 'to-ai':focus='C-07d';c.aiNew=null;renderMain();renderRail();syncNote();scrollToRegion('C-07d');break;
  case 'ai-sel':c.aiSel=Number(d.n);c.aiNew=null;renderMain();renderRail();break;
  case 'rec':openRec(d.id);break;
  case 'ropt':{const it=RECK[layer.id],o=it.opts[Number(d.i)];layer.opt=Number(d.i);
    if(o.dose!==undefined&&!layer.dose)layer.dose=o.dose;if(o.def&&!layer.text)layer.text=o.def;
    if(o.num)Object.assign(layer,{parts:[{v:'',max:o.dec?3:2,dec:!!o.dec,rule:RULE[layer.id]}],pi:0,unit:o.num,slash:false,bp:null,tried:false});
    if(o.vitals)Object.assign(layer,{parts:[{v:'',max:3,lab:'BP sys',rule:RULE.sys},{v:'',max:3,lab:'BP dia',rule:RULE.dia},{v:'',max:3,lab:'HR',rule:RULE.hr},{v:'',max:3,lab:'SpO₂',rule:RULE.spo2}],pi:0,unit:'',slash:false,bp:0,tried:false});
    if(o.tpick&&!layer.tm)layer.tm=rmin(c.openedAt-MIN);
    renderLayer();break;}
  case 'rchip':layer.chips.has(d.v)?layer.chips.delete(d.v):layer.chips.add(d.v);renderLayer();break;
  case 'rscore':layer.score=Number(d.v);renderLayer();break;
  case 'rsave':saveRec();break;
  case 'close':if(layer&&layer.t!=='fail'&&layer.t!=='dec'){layer=null;renderLayer()}break;
  }
}
function openMd(k,post){
  const a=CASE.md[k],f=MDK[k];
  if(f.kind==='time'){layer={t:'md',k,tm:a&&!a.nv?a.v:rmin(now()),approx:a&&!a.nv?a.approx:false};}
  else if(f.kind==='complaint')layer={t:'md',k,sel:a?a.v:null,det:a?a.det||'':''};
  else if(f.kind==='gcs')layer={t:'md',k};
  else if(f.kind==='sex')layer={t:'md',k,sel:null};
  else if(k==='bp')layer={t:'md',k,parts:[{v:post==='update'?'':a&&!a.nv?String(a.sys):'',max:3,lab:'Systolic',rule:RULE.sys},{v:post==='update'?'':a&&!a.nv?String(a.dia):'',max:3,lab:'Diastolic',rule:RULE.dia}],pi:0,bp:0,unit:'mmHg',slash:true,at:post==='update'?now():a&&a.at?a.at:now()};
  else layer={t:'md',k,parts:[{v:post==='update'?'':a&&!a.nv?String(a.v):'',max:3,rule:RULE[k]}],pi:0,unit:f.unit,est:a&&a.est,at:post==='update'?now():a&&a.at?a.at:now()};
  if(post)layer.post=post;
  renderLayer();
}
function openRec(id){
  layer={t:'rec',id,opt:null,dose:'',text:'',chips:new Set(),score:null,at:now(),parts:[],pi:0};
  if(RECK[id].opts.length===1)act('ropt',{dataset:{i:'0'}});else renderLayer();
}
function saveRec(){
  const L=layer,it=RECK[L.id],o=it.opts[L.opt];if(!recOk(L))return;
  if((o.num||o.vitals)&&partsErr(L,true)){L.tried=true;renderLayer();return}
  if(L.id==='obs'){
    /* a full set adds a new reading to BP, HR and SpO₂; nothing is replaced */
    const v=L.parts.map(p=>Number(p.v)),at=L.at;layer=null;
    mdPost('bp',{sys:v[0],dia:v[1],at},'update');mdPost('hr',{v:v[2],at},'update');mdPost('spo2',{v:v[3],at},'update');
    renderLayer();renderMain();renderRail();return;
  }
  const prev=CASE.rec[L.id];
  const r={sum:o.nv?o.l:o.sum(L),nv:!!o.nv,at:now(),count:(prev&&it.multi?prev.count:0)+1,prev:prev&&!it.multi?[...(prev.prev||[]),{sum:prev.sum,at:prev.at}]:[]};
  r.opId=op('rec',{k:L.id,label:it.label,group:REC.find(g=>g.items.includes(it)).g,v:r.sum,nv:r.nv,at:o.time?L.at:r.at,multi:!!it.multi,ev:it.ev}).id;
  CASE.rec[L.id]=r;ev(it.ev,ME);touch();layer=null;renderLayer();renderMain();renderRail();
}
function key(k){
  if(layer&&layer.parts&&layer.parts.length){
    const L=layer,P=L.parts[L.pi];
    if(k==='del'){if(P.v)P.v=P.v.slice(0,-1);else if(L.pi>0)L.pi--}
    else if(k==='/'||k==='Next'){if(P.v&&L.pi<L.parts.length-1)L.pi++}
    else if(k==='.'){if(P.v&&!P.v.includes('.'))P.v+='.'}
    else if(P.v.replace('.','').length<(P.v.includes('.')?P.max:P.max)){P.v+=k;if(!P.dec&&P.v.length>=P.max&&L.pi<L.parts.length-1)L.pi++}
    renderLayer();return;
  }
}

/* ---------- the demonstration driver: the page asks, the tablet does it on screen as a crew member would ---------- */
function typeIn(vals,then){
  /* fills the open value drawer one part at a time, so the reviewer sees it entered */
  let i=0;const stepF=()=>{if(!layer||!layer.parts)return;if(i>=vals.length){setT(650,then);return}layer.parts[i].v=vals[i];layer.pi=Math.min(i+1,layer.parts.length-1);i++;renderLayer();setT(380,stepF)};setT(450,stepF);
}
function cmd(k){
  if(layer&&layer.t!=='dec'&&layer.t!=='fail'){layer=null;renderLayer()}
  switch(k){
  case 'open':if(!CASE)act('open-path',{dataset:{}});break;
  case 'capture':if(!CASE)act('open-path',{dataset:{}});if(!CASE.draft){view='C-04';render();setT(700,()=>act('shoot',{dataset:{}}))}break;
  case 'fill':{if(!CASE)return;
    const ks=MD.filter(f=>!CASE.md[f.k]);if(!ks.length){if(CASE.draft){view='C-05';render()}break}
    fillMd(now());CASE.mdAt=now();view=CASE.draft?'C-05':'C-03';render();toast('Minimum dataset entered: 54, male, chest pain, onset about 35 min ago, BP 118/74, HR 84, SpO₂ 96 %, GCS 15.',true);break;}
  case 'send':if(CASE&&CASE.draft&&MD.every(f=>CASE.md[f.k])){view='C-05';render();setT(500,()=>send())}break;
  case 'bp':if(!CASE||!CASE.ecgs.length)return;view='WS';render();scrollToRegion('C-07a');setT(300,()=>{openMd('bp','update');typeIn(['94','60'],()=>act('md-done',{dataset:{}}))});break;
  case 'aspirin':if(!CASE||!CASE.ecgs.length)return;view='WS';render();scrollToRegion('C-07a');setT(300,()=>{openRec('asp');setT(500,()=>{act('ropt',{dataset:{i:'0'}});setT(900,()=>saveRec())})});break;
  case 'ecg2':if(!CASE||!CASE.ecgs.length||CASE.draft)return;act('add-ecg',{dataset:{}});setT(900,()=>{act('shoot',{dataset:{}});setT(1600,()=>{if(CASE.draft)send()})});break;
  case 'decack':if(layer&&layer.t==='dec')act('dec-ack',{dataset:{}});break;
  }
}

/* ---------- messages from the live link to the platform server ---------- */
function onMsg(m){
  switch(m.t){
  case 'init':clearTimers();T0=m.T0;base=m.base;CAD=m.cad||'';EPOCH=m.epoch||'';SRV=null;OUTQ=[];PENDIMG=[];lastSync=null;CASE=null;layer=null;view='C-01';$('#layer').innerHTML='';SC={...SC0,ids:SC.ids,orient:SC.orient,online:true};
    restoreLocal();render();fit();if(CASE)resumeSends();break;
  case 'clock':T0=m.T0;base=m.base;break;
  case 'cfg':{SIMV={...SIMV,...m.sim};SC.quality=SIMV.q;const ids=!!m.sim.ids;if(ids!==SC.ids){SC.ids=ids;render();if(layer)renderLayer()}if(view==='C-04')render();break}
  case 'snap':{
    const rec=m.rec;lastSync=m.at;
    /* a case that is still on this tablet only (not sent yet) is not the platform's active case: ignore that one */
    if(localOnly()){SRV=null;refreshAll();break}
    if(!CASE&&rec&&!creating)CAD=rec.cad;
    SRV=rec&&rec.cad===CAD?rec:null;
    /* a tablet that lost its own copy (another browser, cleared storage) rebuilds the case from the server's record */
    if(!CASE&&SRV&&SRV.path){CASE=hydrate(SRV);if(CASE){view=CASE.ecgs.length&&!CASE.life.closed?'WS':'C-01';render()}}
    applySnap();saveLocal();break;}
  case 'hb':lastSync=m.at;$$('[data-tick="sync"]').forEach(el=>el.textContent='Last update '+hms(lastSync));break;
  case 'net':{
    const was=SC.online;SC.online=!!m.up;
    if(!was&&SC.online){
      const n=OUTQ.length+PENDIMG.length;
      if(CASE)ev(n?`Reconnected · ${n} saved item${n>1?'s':''} sent in order`:'Reconnected','Tablet');
      pumpImgs();flush();
      if(CASE&&CASE.failure&&!CASE.failure.late)setT(400,late);
    } else if(was&&!SC.online&&CASE)ev('Connection lost · saving on this tablet','Tablet');
    render();if(layer)renderLayer();break;}
  case 'cmd':cmd(m.k);break;
  }
}

/* ---------- this tablet's own copy: "Saved on this tablet" survives a page refresh (drafts, unsent entries) ---------- */
const LSK='stemi.crew.v1';
let lastSaved='';
function saveLocal(){
  try{
    if(!CAD&&!CASE)return;
    const c=CASE?{...CASE,held:null}:null;
    const s=JSON.stringify({cad:CAD,epoch:EPOCH,user:AU.id,CASE:c,OUTQ,PENDIMG});
    if(s!==lastSaved){localStorage.setItem(LSK,s);lastSaved=s}
  }catch(_){/* storage full or blocked: the server still has everything already sent */}
}
function restoreLocal(){
  try{
    const s=JSON.parse(localStorage.getItem(LSK)||'null');
    const mine=s&&s.epoch===EPOCH&&s.user===AU.id;
    /* a case not yet created on the platform (not sent) is kept whatever the platform's active case is: its CAD number is the crew's */
    const own=mine&&s.CASE&&s.CASE.srv===false;
    if(!mine||(!own&&s.cad!==CAD)){localStorage.removeItem(LSK);return}
    if(own)CAD=s.CASE.cad||'';
    CASE=s.CASE;OUTQ=s.OUTQ||[];PENDIMG=s.PENDIMG||[];
    if(CASE){CASE.held=null;if(CASE.cadEdit)CASE.cadEdit.busy=false;view=CASE.ecgs.length&&!(CASE.life&&CASE.life.closed)?'WS':'C-01'}
  }catch(_){CASE=null}
}
/* an ECG that was being uploaded when the page closed is not silently forgotten: it goes back through the failure route and retries */
function resumeSends(){
  const c=CASE;if(!c)return;
  const e=c.ecgs.find(x=>!x.tx.rcvAt&&!x.tx.opId);
  if(e&&!(c.failure&&!c.failure.late)){e.tx.stage='fail';fail(e)}
}
/* rebuild the crew's view of a case from the server's record (after Send everything is on the server) */
function hydrate(S){
  const c=newCase();c.openedAt=S.path.at;c.savedAt=S.path.at;
  c.srv=true;c.cad=S.cad;c.cadAt=S.cadEntry&&S.cadEntry.at;c.cadEdit.val=S.cad;CAD=S.cad;c.life=lifeOf(S);
  MD.forEach(f=>{const a=S.pt[f.k];if(a&&a.length){c.md[f.k]=a[a.length-1].raw;c.mdh[f.k]=a.map(x=>({a:x.raw,t:x.t,kind:x.kind,opId:x.op}))}});
  if(S.sub){c.mdDone=true;c.mdAt=S.sub.send;c.waitFrom=S.sub.rcv}
  c.ecgs=S.ecgs.map(s=>({n:s.n,acq:s.acq,v:s.variant,pri:s.pri,sel:s.pri,repFlag:1,
    imgs:s.imgs.map(x=>({i:x.i,at:x.at,q:x.q,kind:x.kind,img:x.url,url:x.url,src:x.src,after:x.after,opId:x.after?x.op:undefined})),
    tx:{stage:'rcv',subAt:s.sent,conAt:s.sent,upAt:s.sent,pct:100,rcvAt:s.rcv,late:!!(S.sub&&S.sub.late&&s.n===1),opId:s.op},aiR:s.ai}));
  const d0=S.dest[S.dest.length-1];
  if(d0)c.dest=d0.st==='rec'?{st:'rec',hosp:d0.hosp,reason:d0.reason,recAt:d0.t}:{st:'conf',hosp:d0.hosp,at:d0.t,by:d0.by===`${ME}, ${ROLE}`?ME:d0.by,from:d0.from,why:d0.why};
  if(S.eta.length){const L=S.eta[S.eta.length-1],dep=S.eta.find(x=>x.dep);c.eta={dep:dep?dep.dep:L.t,min:L.min,upd:L.why==='upd'?L.t:null}}
  Object.entries(S.rec).forEach(([k,r])=>{const it=RECK[k],v=r.vers,L=v[v.length-1];if(!L)return;
    c.rec[k]={sum:L.v,nv:L.nv,at:L.rcv,count:v.length,prev:it&&it.multi?[]:v.slice(0,-1).map(x=>({sum:x.v,at:x.rcv})),opId:L.op}});
  if(S.alert){c.alert={at:S.alert.at,who:S.alert.who,hosp:S.alert.hosp};c.rem=S.alert.rem.slice();c.esc=S.alert.esc.map(x=>({t:x.lv===1?'Backup cardiologist alerted':'ACC duty officer alerted',who:x.to,at:x.t}))}
  if(S.ack)c.ack={at:S.ack,who:S.alert?S.alert.who:'Cardiologist'};
  if(S.opened)c.opened=S.opened;
  c.events=S.audit.filter(a=>a.kind!=='view').map(a=>({t:a.t,text:a.text,who:a.who}));
  c.decs=S.dec.map(x=>({...x}));
  const L=c.decs[c.decs.length-1];
  if(L&&L.k==='repeat'&&!c.ecgs.some(e=>e.tx.rcvAt>L.at)){c.repeatAsked=true;c.repeatFor=c.ecgs.length;c.repeatSent=false}
  if(!c.life.closed)c.decs.forEach(x=>{if(!x.dlv)setT(300,()=>op('decrcv',{id:x.id}))});
  if(L&&!L.crewAck&&!c.life.closed)setT(350,()=>{if(CASE===c&&!layer){layer={t:'dec',id:L.id};renderLayer()}});
  CASE=c;deriveState();
  return c;
}

/* ---------- events ---------- */
$('#device').addEventListener('click',ev0=>{
  if(view==='WS'&&!layer){const r=ev0.target.closest('.rail,#r-dest,#r-vit,#r-rec,#r-ecgs,#r-ai,.rep,.decb');if(r){const f=r.id==='r-dest'?'C-07b':r.id==='r-vit'||r.id==='r-rec'?'C-07a':r.id==='r-ecgs'?'C-07c':r.id==='r-ai'?'C-07d':r.classList.contains('decb')?'C-09':'C-07';if(f!==focus){focus=f;syncNote()}
    /* looking at the AI section clears its NEW ECG ANALYSIS mark */
    if(r.id==='r-ai'&&CASE.aiNew&&!ev0.target.closest('[data-act]')){CASE.aiNew=null;renderMain();renderRail()}}}
  const t=ev0.target.closest('[data-act],[data-key],[data-note]');if(!t||t.disabled)return;
  if(t.dataset.note){post({t:'note',id:t.dataset.note});return}
  if(t.dataset.key){key(t.dataset.key);return}
  act(t.dataset.act,t);
});
$('#layer').addEventListener('input',e=>{
  const id=e.target.id;if(!layer)return;
  if(id==='cdet'){layer.det=e.target.value;const b=$('[data-act="c-done"]');if(b)b.disabled=!(layer.sel&&(layer.sel!=='oth'||layer.det.trim()))}
  if(id==='rdose')layer.dose=e.target.value;
  if(id==='rtext'){layer.text=e.target.value;const b=$('[data-act="rsave"]');if(b)b.disabled=!recOk(layer)}
  if(id==='dtext'){layer.text=e.target.value;const b=$('[data-act="dconfirm"]');if(b)b.disabled=!destOk(layer)}
  if(['honame','horole','hocrew','honotes','hoother'].includes(id)){layer[{honame:'name',horole:'role',hocrew:'crew',honotes:'notes',hoother:'other'}[id]]=e.target.value;if(id==='hoother'){const b=$('[data-act="ho-save"]');if(b)b.disabled=!layer.other.trim()}}
  if(id==='etext'){layer.text=e.target.value;const b=$('[data-act="esave"]');if(b)b.disabled=!(layer.why&&(layer.why!=='Other'||layer.text.trim()))}
});
/* the CAD number field keeps what is typed (a re-render or refresh does not lose it); Enter continues */
$('#view').addEventListener('input',e=>{
  if(e.target.id==='cadin'&&CASE){CASE.cadEdit.val=e.target.value;CASE.savedAt=now();saveLocal()}
  if(e.target.id==='histq'){HQ=e.target.value;clearTimeout(histT);histT=setTimeout(loadHist,250)}});
$('#view').addEventListener('keydown',e=>{if(e.target.id==='cadin'&&e.key==='Enter'){e.preventDefault();act('cad-ok',e.target)}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&layer&&layer.t!=='fail'&&layer.t!=='dec'&&layer.t!=='dup'){layer=null;renderLayer()}});

/* ---------- ticking clocks ---------- */
setInterval(()=>{
  if(!document.getElementById('view'))return;
  $$('[data-tick="clock"]').forEach(el=>el.textContent=hm(now()));
  if(!CASE)return;
  $$('[data-tick="caseclock"]').forEach(el=>el.textContent='Open '+dur(now()-CASE.openedAt));
  if(CASE.waitFrom&&!CASE.ack)$$('[data-tick="wait"]').forEach(el=>el.textContent=dur(now()-CASE.waitFrom));
  const f=CASE.failure;
  if(f&&!f.late&&now()-f.last>6000){f.attempts++;f.last=now();
    if(SC.online){late();return}
    $$('[data-tick="attempt"]').forEach(el=>el.textContent=`Retrying automatically · attempt ${f.attempts} · last try ${hms(f.last)}`);
    $$('[data-tick="attempt-n"]').forEach(el=>el.textContent=f.attempts);}
},500);

/* ---------- stage fit: the landscape tablet scaled to the frame; portrait below 700 px ---------- */
function fit(){
  /* the MDT keeps the approved landscape tablet layout (1180 × 820), scaled to fill this window */
  const st=$('#stage'),dv=$('#device'),w=st.clientWidth,h=innerHeight;
  const land=w>=700;
  dv.classList.toggle('land',land);dv.classList.toggle('port',!land);
  if(land){const s=Math.min(w/1180,h/820);dv.style.transform=`scale(${s})`;dv.style.left=Math.max(0,(w-1180*s)/2)+'px';st.style.height=(820*s)+'px'}
  else{dv.style.transform='';dv.style.left='';st.style.height=''}
}
let fitQ=0;new ResizeObserver(()=>{cancelAnimationFrame(fitQ);fitQ=requestAnimationFrame(fit)}).observe($('#stage'));
fit();render();
LIVE=Live({onMsg});
setInterval(()=>{if(SC.online){pumpImgs();flush()}saveLocal()},3000);
addEventListener('pagehide',saveLocal);
})();
