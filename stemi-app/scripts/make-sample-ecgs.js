/* Regenerates the fictional sample ECG images in samples/ (used to test Upload). Needs Playwright: NODE_PATH=$(npm root -g) node scripts/make-sample-ecgs.js */
const { chromium } = require('playwright');const fs=require('fs');
(async()=>{
 const b=await chromium.launch();const p=await b.newPage();
 await p.setContent('<html><body></body></html>');
 await p.addScriptTag({path:'public/shared/ecg.js'});
 const acq=new Date(2026,9,4,10,12,30).getTime();
 for(const [v,name] of [['border','test-ecg-1-borderline-anterior'],['evolved','test-ecg-2-evolving-anterior'],['clear','test-ecg-clear-anterior-stemi']]){
  const u=await p.evaluate(([v,a])=>{const P=ECG.photo(v,'full','good',a),c=document.createElement('canvas');c.width=P.c.width;c.height=P.c.height;const x=c.getContext('2d');x.drawImage(P.c,0,0);x.font='700 30px sans-serif';x.fillStyle='rgba(255,255,255,.85)';x.fillText('FICTIONAL TEST ECG · NOT A PATIENT · Unified STEMI Platform test build',40,1020);return c.toDataURL('image/jpeg',.86)},[v,acq+(v==='evolved'?14*60000:0)]);
  fs.writeFileSync(`samples/${name}.jpg`,Buffer.from(u.split(',')[1],'base64'));
 }
 await b.close();
})();
