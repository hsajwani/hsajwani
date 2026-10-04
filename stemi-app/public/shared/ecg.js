/* Shared by the crew tablet and the cardiologist's screen (from the approved prototype, round 3 v0.2, cardio/js/2-ecg.js).
   The fictional test ECG generator: a simulated 12-lead printout photographed by the crew. Its images are uploaded and
   stored on the server; the cardiologist's screen shows the stored file. FICTIONAL, NOT A PATIENT ECG. */
(function(){
'use strict';
const p2=n=>String(n).padStart(2,'0');
const hm=t=>{const d=new Date(t);return p2(d.getHours())+':'+p2(d.getMinutes())};
const hms=t=>{const d=new Date(t);return hm(t)+':'+p2(d.getSeconds())};
const MON=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const pdate=t=>{const d=new Date(t);return p2(d.getDate())+'-'+MON[d.getMonth()]+'-'+d.getFullYear()};
/* ---------- ECG: fictional 3×4 printout with rhythm strip at 25 mm/s and 10 mm/mV, photographed on a dark surface.
   Variants: clear (anterior STE V2–V5, reciprocal II, III, aVF) · border (subtle anterior changes) · evolved (new STE V3–V4)
   · clear2 (persistent STE). Kinds of photo: full 12-lead, chest-lead close-up, lower-strip close-up. ---------- */
const ECG=(()=>{
 const W=2160,H=1120,PX=8,X0=110,SPS=25*PX,MV=10*PX,ROWS=[250,500,750,1000];
 const LAY=[['I','aVR','V1','V4'],['II','aVL','V2','V5'],['III','aVF','V3','V6']];
 const BASE={
  I:{p:.10,q:-.04,r:.70,s:-.10,t:.26},II:{p:.15,q:-.05,r:1.05,s:-.18,t:.16},III:{p:.06,q:-.03,r:.45,s:-.24,t:.02},
  aVR:{p:-.12,q:.03,r:-.78,s:.10,t:-.22},aVL:{p:.03,q:-.05,r:.46,s:-.26,t:.20},aVF:{p:.10,q:-.04,r:.74,s:-.21,t:.06},
  V1:{p:.07,q:0,r:.20,s:-.95,t:.14},V2:{p:.08,q:0,r:.38,s:-1.12,t:.52},V3:{p:.08,q:0,r:.60,s:-.78,t:.60},
  V4:{p:.08,q:-.03,r:.95,s:-.48,t:.56},V5:{p:.08,q:-.05,r:1.12,s:-.27,t:.42},V6:{p:.08,q:-.06,r:.94,s:-.14,t:.28}
 };
 const VAR={
  clear:{hr:84,st:{I:.10,II:-.11,III:-.17,aVR:0,aVL:.12,aVF:-.15,V1:.12,V2:.30,V3:.40,V4:.34,V5:.21,V6:.06}},
  border:{hr:84,st:{I:.03,II:-.02,III:-.03,aVR:0,aVL:.04,aVF:-.02,V1:.04,V2:.10,V3:.12,V4:.12,V5:.04,V6:.01},t:{V2:.64,V3:.74,V4:.68}},
  evolved:{hr:92,st:{I:.06,II:-.05,III:-.12,aVR:0,aVL:.07,aVF:-.10,V1:.05,V2:.14,V3:.32,V4:.30,V5:.12,V6:.03},t:{V2:.60,V3:.70,V4:.64}},
  clear2:{hr:88,st:{I:.11,II:-.12,III:-.18,aVR:0,aVL:.13,aVF:-.16,V1:.12,V2:.32,V3:.42,V4:.36,V5:.22,V6:.07}}
 };
 const sig=x=>1/(1+Math.exp(-x));
 function beat(d,p){
  const g=(m,s,a)=>a*Math.exp(-.5*((d-m)/s)**2);
  let v=g(.085,.024,p.p)+g(.178,.0085,p.q)+g(.2,.0115,p.r)+g(.226,.0105,p.s);
  v+=p.t*Math.exp(-.5*((d-.45)/(d<.45?.062:.042))**2);
  v+=p.st*sig((d-.242)/.006)*sig((.47-d)/.028);
  return v;
 }
 const cnv=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
 const PAP={},PH={},CR={};
 function paper(v,acq){
  const key=v+'|'+acq;if(PAP[key])return PAP[key];
  const cfg=VAR[v]||VAR.clear,RR=60/cfg.hr,on=[];
  for(let t=.16,k=0;t<10.8;k++){on.push(t);t+=RR+Math.sin(k*1.7+acq%7)*.012}
  const lp=ld=>({...BASE[ld],st:cfg.st[ld]||0,t:cfg.t&&cfg.t[ld]!=null?cfg.t[ld]:BASE[ld].t});
  const volt=(ld,t,p)=>{let s=0;for(const o of on){const d=t-o;if(d>-.1&&d<.8)s+=beat(d,p)}const n=Math.sin(t*913.7+ld.length*7.1)*Math.sin(t*377.3);return s+.022*Math.sin(2*Math.PI*.23*t+ld.length)+.006*n};
  const c=cnv(W,H),x=c.getContext('2d');
  x.fillStyle='#fff7f5';x.fillRect(0,0,W,H);
  x.strokeStyle='rgba(226,122,114,.30)';x.lineWidth=1;x.beginPath();
  for(let i=0;i<=W;i+=PX){x.moveTo(i+.5,0);x.lineTo(i+.5,H)}for(let j=0;j<=H;j+=PX){x.moveTo(0,j+.5);x.lineTo(W,j+.5)}x.stroke();
  x.strokeStyle='rgba(212,86,78,.58)';x.lineWidth=1.7;x.beginPath();
  for(let i=0;i<=W;i+=PX*5){x.moveTo(i+.5,0);x.lineTo(i+.5,H)}for(let j=0;j<=H;j+=PX*5){x.moveTo(0,j+.5);x.lineTo(W,j+.5)}x.stroke();
  x.fillStyle='#1b1b1b';x.font='700 31px "Courier New",Courier,monospace';
  x.fillText(pdate(acq)+'  '+hms(acq),40,62);x.fillText('HR '+cfg.hr+' /min',640,62);
  x.font='600 27px "Courier New",Courier,monospace';x.fillText('25 mm/s   10 mm/mV   0.05-150 Hz',1390,62);
  x.strokeStyle='#151515';x.lineWidth=2.7;x.lineJoin='round';x.lineCap='round';
  const cal=y=>{x.beginPath();x.moveTo(34,y);x.lineTo(50,y);x.lineTo(50,y-MV);x.lineTo(90,y-MV);x.lineTo(90,y);x.lineTo(X0,y);x.stroke()};
  const tr=(ld,t1,t2,y)=>{const p=lp(ld);x.beginPath();for(let t=t1;t<=t2+1e-9;t+=.002){const X=X0+t*SPS,Y=y-volt(ld,t,p)*MV;t===t1?x.moveTo(X,Y):x.lineTo(X,Y)}x.stroke();
   x.save();x.font='700 32px "Courier New",Courier,monospace';x.fillStyle='#151515';x.fillText(ld,X0+t1*SPS+12,y-92);x.restore();
   if(t1>0){x.beginPath();x.moveTo(X0+t1*SPS,y-20);x.lineTo(X0+t1*SPS,y+20);x.stroke()}};
  for(let r=0;r<3;r++){cal(ROWS[r]);for(let k=0;k<4;k++)tr(LAY[r][k],k*2.5,k*2.5+2.5,ROWS[r])}
  cal(ROWS[3]);tr('II',0,10,ROWS[3]);
  return PAP[key]=c;
 }
 function surface(x,w,h,seed){
  const g=x.createLinearGradient(0,0,w,h);g.addColorStop(0,'#3b454c');g.addColorStop(1,'#1c2327');x.fillStyle=g;x.fillRect(0,0,w,h);
  let s=seed;const rnd=()=>(s=(s*16807)%2147483647)/2147483647;
  for(let i=0;i<12000;i++){x.fillStyle=`rgba(255,255,255,${rnd()*.035})`;x.fillRect(rnd()*w,rnd()*h,2,2)}
 }
 function finish(x,w,h){
  const v=x.createRadialGradient(w/2,h/2,h*.38,w/2,h/2,h*.95);v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(0,0,0,.38)');x.fillStyle=v;x.fillRect(0,0,w,h);
  x.fillStyle='rgba(255,196,150,.035)';x.fillRect(0,0,w,h);
 }
 /* photo(v,kind,q,acq) → {url, T}; T is the paper-to-photo placement of a full 12-lead photo, used for lead-focus crops */
 function photo(v,kind,q,acq){
  const key=[v,kind,q,acq].join('|');if(PH[key])return PH[key];
  const pap=paper(v,acq),w=1600,h=1050,c=cnv(w,h),x=c.getContext('2d');
  surface(x,w,h,kind==='full'?7:kind==='chest'?11:13);
  let T=null;
  const shadow=()=>{x.shadowColor='rgba(0,0,0,.55)';x.shadowBlur=36;x.shadowOffsetY=14};
  if(kind==='full'){
   const pw=1450,ph=pw*H/W,cx=q==='cut'?1270:800,cy=525,rot=(q==='cut'?1.1:-1.4)*Math.PI/180;
   x.save();x.translate(cx,cy);x.rotate(rot);shadow();x.drawImage(pap,-pw/2,-ph/2,pw,ph);x.restore();
   if(q==='glare'){
    const sx=cx-pw/2+360*pw/W,sy=cy-ph/2+500*ph/H;
    x.save();x.translate(sx,sy);x.scale(.9,1.25);
    const r=x.createRadialGradient(0,0,10,0,0,240);r.addColorStop(0,'rgba(255,255,255,.97)');r.addColorStop(.45,'rgba(255,255,255,.86)');r.addColorStop(1,'rgba(255,255,255,0)');
    x.fillStyle=r;x.beginPath();x.arc(0,0,240,0,Math.PI*2);x.fill();x.restore();
   }
   T={pw,ph,cx,cy,rot};
  }else{
   const src=kind==='chest'?[X0+5*SPS-40,100,W-(X0+5*SPS-40),770]:[0,630,1300,H-630-6];
   const s=Math.min(1500/src[2],990/src[3]),dw=src[2]*s,dh=src[3]*s,rot=(kind==='chest'?.8:-.9)*Math.PI/180;
   x.save();x.translate(800,525);x.rotate(rot);shadow();x.drawImage(pap,src[0],src[1],src[2],src[3],-dw/2,-dh/2,dw,dh);x.restore();
  }
  finish(x,w,h);
  return PH[key]={url:c.toDataURL('image/jpeg',.86),c,T};
 }
 const REG={i3:[40,95,615,870],avr:[600,95,1115,870],v13:[1100,95,1615,870],v46:[1600,95,2158,870],rhy:[20,860,2150,1114]};
 /* a crop of the photographed full 12-lead image; nothing is redrawn */
 function crop(v,q,acq,f){
  const key=[v,q,acq,f].join('|');if(CR[key])return CR[key];
  const P=photo(v,'full',q,acq),{pw,ph,cx,cy,rot}=P.T,s=pw/W,co=Math.cos(rot),si=Math.sin(rot),[a,b,c2,d]=REG[f];
  const pts=[[a,b],[c2,b],[a,d],[c2,d]].map(([px,py])=>{const X=px*s-pw/2,Y=py*s-ph/2;return [X*co-Y*si+cx,X*si+Y*co+cy]});
  let x1=Math.max(0,Math.min(...pts.map(p=>p[0]))-14),y1=Math.max(0,Math.min(...pts.map(p=>p[1]))-14),x2=Math.min(1600,Math.max(...pts.map(p=>p[0]))+14),y2=Math.min(1050,Math.max(...pts.map(p=>p[1]))+14);
  const bw=Math.max(40,x2-x1),bh=Math.max(40,y2-y1),k=2,o=cnv(Math.round(bw*k),Math.round(bh*k)),ox=o.getContext('2d');
  ox.imageSmoothingQuality='high';ox.drawImage(P.c,x1,y1,bw,bh,0,0,o.width,o.height);
  return CR[key]=o.toDataURL('image/jpeg',.88);
 }
 return {photo,crop};
})();
/* ---------- the AI ECG interpretation. The platform makes ONE analysis per ECG; every screen shows it with these
   labels, in this order (Hamad, 3 Oct 2026, 12:07). Only the cardiologist's screen adds the clinical correlation ---------- */
const AIROWS=[['q','ECG quality'],['rhy','Rhythm'],['rate','Rate'],['ste','ST elevation'],['std','ST depression and reciprocal changes'],['cond','Conduction'],['ser','Serial ECG changes'],['imp','AI impression'],['conf','Confidence and limitations']];
const AIST={proc:'AI analysis processing',ok:'AI analysis completed',lim:'AI interpretation limited — ECG quality insufficient',wh:'AI interpretation limited — ECG quality insufficient',down:'AI interpretation unavailable'};
const aiVal=(a,n,k)=>k==='ser'?(n===1?'No earlier ECG in this case':a.ser?`${a.ser.h}. ${a.ser.t}`:''):(a[k]||'');
const aiStLine=a=>!a?'AI analysis starting':a.st==='proc'?`AI analysis processing · started ${hms(a.start)}`:`${AIST[a.st]}${a.st==='lim'||a.st==='wh'?' · ':' — '}${hms(a.done)}`;

window.ECG=ECG;
window.AIX={AIROWS,AIST,aiVal,aiStLine};
})();
