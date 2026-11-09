/* Developer-only smoke test. The application itself needs no Node or server. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const project=path.resolve(__dirname,'..');
const output=path.join(project,'reports','browser-smoke-'+Date.now());
fs.mkdirSync(output,{recursive:true});
const profile=path.join(output,'profile');
const chrome=process.env.STL_TEST_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const processHandle=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-extensions',
  '--disable-sync','--metrics-recording-only','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',
  '--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let stderr=''; processHandle.stderr.on('data',b=>stderr+=b);
processHandle.on('error',error=>{stderr+='\n'+error.message;});
let socket;
async function until(fn,label,timeout=20000){const start=Date.now();while(Date.now()-start<timeout){const value=await fn();if(value)return value;await wait(100);}throw new Error('Timeout: '+label);}
(async()=>{
  const active=path.join(profile,'DevToolsActivePort');
  await until(()=>fs.existsSync(active),'Chrome debug endpoint');
  const [port,endpoint]=fs.readFileSync(active,'utf8').trim().split(/\r?\n/);
  socket=new WebSocket('ws://127.0.0.1:'+port+endpoint);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0; const pending=new Map(), exceptions=[], requests=[];
  socket.addEventListener('message',event=>{
    const msg=JSON.parse(event.data);
    if(msg.id&&pending.has(msg.id)){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(new Error(JSON.stringify(msg.error))):p.resolve(msg.result);}
    if(msg.method==='Runtime.exceptionThrown')exceptions.push(msg.params.exceptionDetails);
    if(msg.method==='Network.requestWillBeSent')requests.push(msg.params.request.url);
  });
  function call(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
  const {targetId}=await call('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
  const page=(method,params)=>call(method,params,sessionId);
  const evaluate=async expression=>{const r=await page('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  await page('Runtime.enable');await page('Network.enable');await page('Page.enable');
  await page('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:output,eventsEnabled:true});
  await page('Page.navigate',{url:pathToFileURL(path.join(project,'index.html')).href});
  await until(()=>evaluate("Boolean(globalThis.STLCore && document.getElementById('folderInput'))"),'local HTML loaded');
  const {root}=await page('DOM.getDocument');
  const {nodeId}=await page('DOM.querySelector',{nodeId:root.nodeId,selector:'#folderInput'});
  await page('DOM.setFileInputFiles',{nodeId,files:[process.env.STL_TEST_PROJECT||path.join(project,'input','Project333')]});
  try { await until(()=>evaluate("document.getElementById('triangles').textContent.replace(/\\D/g,'') === '407345'"),'directory load and preview'); }
  catch(error) { console.error(await evaluate("({status:document.getElementById('status').textContent,triangles:document.getElementById('triangles').textContent,progress:document.getElementById('progress').value})"),exceptions);throw error; }

  assert.equal(await evaluate("document.getElementById('downloadZip').disabled"),true);
  const baseline=await evaluate("({span:document.getElementById('span').textContent,length:document.getElementById('length').textContent,status:document.getElementById('status').textContent,parts:document.querySelectorAll('.file').length})");
  assert.equal(baseline.parts,4);
  assert.ok(baseline.span.includes('296'));
  await evaluate("{const c=document.getElementById('viewer').getContext('2d'),original=c.moveTo;globalThis.viewerProbe=[];c.moveTo=function(x,y){if(viewerProbe.length<3)viewerProbe.push([x,y]);return original.call(this,x,y);};document.querySelector('[data-view=iso]').click();}");
  const originalPoints=await evaluate('viewerProbe.slice()');
  const mousePoint=await evaluate("(()=>{const r=document.getElementById('viewer').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
  await page('Input.dispatchMouseEvent',{type:'mousePressed',...mousePoint,button:'left',buttons:1,clickCount:1});
  await evaluate('viewerProbe=[]');
  await page('Input.dispatchMouseEvent',{type:'mouseMoved',x:mousePoint.x+40,y:mousePoint.y+25,button:'left',buttons:1});
  await page('Input.dispatchMouseEvent',{type:'mouseReleased',x:mousePoint.x+40,y:mousePoint.y+25,button:'left',buttons:0,clickCount:1});
  const movedPoints=await evaluate('viewerProbe.slice()');assert.equal(movedPoints.length,3);
  for(let i=0;i<3;i++){assert.ok(Math.abs(movedPoints[i][0]-originalPoints[i][0]-40)<1e-6);assert.ok(Math.abs(movedPoints[i][1]-originalPoints[i][1]-25)<1e-6);}
  await page('Input.dispatchMouseEvent',{type:'mousePressed',...mousePoint,button:'right',buttons:2,clickCount:1});
  await evaluate('viewerProbe=[]');
  await page('Input.dispatchMouseEvent',{type:'mouseMoved',x:mousePoint.x+50,y:mousePoint.y+20,button:'right',buttons:2});
  await page('Input.dispatchMouseEvent',{type:'mouseReleased',x:mousePoint.x+50,y:mousePoint.y+20,button:'right',buttons:0,clickCount:1});
  const rotatedPoints=await evaluate('viewerProbe.slice()');assert.equal(rotatedPoints.length,3);
  assert.ok(rotatedPoints.some((p,i)=>i>0&&Math.hypot((p[0]-movedPoints[i][0])-(rotatedPoints[0][0]-movedPoints[0][0]),(p[1]-movedPoints[i][1])-(rotatedPoints[0][1]-movedPoints[0][1]))>.1),'right drag changes orientation, not just position');
  assert.equal(await evaluate("document.getElementById('viewer').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))"),false);
  await evaluate("viewerProbe=[];document.querySelector('[data-view=iso]').click()");
  const resetPoints=await evaluate('viewerProbe.slice()');assert.deepEqual(resetPoints,originalPoints);
  await evaluate("document.getElementById('axesConfirmed').click()");
  assert.equal(await evaluate("document.getElementById('downloadJson').disabled"),false);
  await evaluate("document.getElementById('downloadJson').click()");
  await until(()=>fs.existsSync(path.join(output,'Project333_geometry.json')),'JSON download');
  const geometry=JSON.parse(fs.readFileSync(path.join(output,'Project333_geometry.json'),'utf8'));
  assert.equal(geometry.files.length,4);assert.equal(geometry.options.nose,'+Z');assert.equal(geometry.options.right,'-X');
  assert.equal(geometry.options.repairGaps,true);
  for(const i of [6,7,8]){assert.equal(geometry.bodies[0].sections[i].remainingMissing,0);assert.ok(geometry.bodies[0].sections[i].interpolatedPoints.length>0);}
  assert.match(await evaluate("document.getElementById('templateStatus').textContent"),/Project333_template\.acf/);
  const {nodeId:foilNode}=await page('DOM.querySelector',{nodeId:root.nodeId,selector:'#foilFolderInput'});
  await page('DOM.setFileInputFiles',{nodeId:foilNode,files:['D:\\XPlane 12\\Airfoils']});
  await until(()=>evaluate("document.querySelectorAll('#foilNames option').length > 0"),'AFL folder read');
  await evaluate("for(const [id,name]of [['wingRoot','NACA 2412 (popular).afl'],['horizontalFoil','NACA 0009 (symmetrical).afl'],['verticalFoil','NACA 0009 (symmetrical).afl']]){const e=document.getElementById(id);e.value=name;e.dispatchEvent(new Event('input'));}");
  assert.equal(await evaluate("document.getElementById('downloadAcfZip').disabled"),false);
  assert.equal(await evaluate("document.getElementById('cgPercent').value"),'26');
  assert.equal(await evaluate("document.getElementById('closeCaps').checked"),true);
  await evaluate("document.getElementById('flightEnabled').click()");
  assert.equal(await evaluate("document.getElementById('downloadAcfZip').disabled"),true,'incomplete physical inputs block export');
  await evaluate("for(const [id,value]of Object.entries({massKg:'1.25',vneKmh:'150',motorPower:'250',propRpm:'10000',batteryWh:'22.2',batteryV:'11.1',motorZ:'-90'})){const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event('input'));}");
  assert.equal(await evaluate("document.getElementById('downloadAcfZip').disabled"),false,await evaluate("document.getElementById('acfStatus').textContent"));
  const viewerClip=await evaluate("(()=>{const r=document.getElementById('viewer').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1};})()");
  const previewBefore=await page('Page.captureScreenshot',{format:'png',clip:viewerClip});
  await evaluate("for(const [id,value]of Object.entries({motorZ:'-140',propDiameter:'10'})){const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event('input'));}");
  const previewAfter=await page('Page.captureScreenshot',{format:'png',clip:viewerClip});
  assert.notEqual(previewBefore.data,previewAfter.data,'propeller geometry updates the actual viewer');
  fs.writeFileSync(path.join(output,'propeller-preview-changed.png'),Buffer.from(previewAfter.data,'base64'));
  await evaluate("for(const [id,value]of Object.entries({motorZ:'-90',propDiameter:'8',gearY:'0'})){const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event('input'));}");
  assert.equal(await evaluate("document.getElementById('downloadAcfZip').disabled"),true,'prop-ground intersection blocks export');
  await evaluate("{const e=document.getElementById('gearY');e.value='-200';e.dispatchEvent(new Event('input'));}");
  assert.equal(await evaluate("document.getElementById('downloadAcfZip').disabled"),false);
  const previewFinal=await page('Page.captureScreenshot',{format:'png',clip:viewerClip});fs.writeFileSync(path.join(output,'propeller-and-gear.png'),Buffer.from(previewFinal.data,'base64'));
  await evaluate("{const e=document.querySelector('#draftEditors input[aria-label=chord]');e.value='150';e.dispatchEvent(new Event('change'));}");
  await evaluate(`{const p=document.querySelector('[data-target="surface:wing"]');p.querySelector('[data-field="separateTip"]').click();p.querySelector('[data-field="count"]').value='11';p.querySelector('[data-field="mode"]').value='end';p.querySelector('[data-action="generate"]').click();p.querySelector('[data-action="resample"]').click();}`);
  await until(()=>evaluate("!document.getElementById('analyze').disabled"),'wing resampled with denser tip stations');
  assert.equal(await evaluate(`document.querySelector('[data-target="surface:wing"] [data-field="count"]').value`),'11');
  assert.equal(await evaluate("document.querySelector('#draftEditors input[aria-label=chord]').value"),'150');
  await evaluate(`{const p=document.querySelector('[data-target="body:Fuselage"]');p.querySelector('[data-field="count"]').value='16';p.querySelector('[data-field="mode"]').value='zone';p.querySelector('[data-field="zoneFrom"]').value='180';p.querySelector('[data-field="zoneTo"]').value='350';p.querySelector('[data-field="density"]').value='5';p.querySelector('[data-action="generate"]').click();p.querySelector('[data-action="resample"]').click();}`);
  await until(()=>evaluate("!document.getElementById('analyze').disabled"),'body resampled in a selected zone');
  assert.equal(await evaluate(`document.querySelector('[data-target="body:Fuselage"] [data-field="count"]').value`),'16');
  assert.equal(await evaluate("document.querySelector('#draftEditors input[aria-label=chord]').value"),'150');
  assert.equal(await evaluate("document.getElementById('downloadAcfZip').disabled"),false,await evaluate("document.getElementById('acfStatus').textContent"));
  await evaluate("const original=OfflineZip.makeZip;OfflineZip.makeZip=entries=>{const acf=entries.find(e=>e.name.endsWith('_import.acf'));if(acf)globalThis.acfCheck={text:new TextDecoder().decode(acf.data),paths:entries.map(e=>e.name),report:JSON.parse(new TextDecoder().decode(entries.find(e=>e.name.endsWith('import-report.json')).data))};return original(entries);};document.getElementById('downloadAcfZip').click()");
  await until(()=>fs.existsSync(path.join(output,'Project333_acf.zip')),'experimental ACF ZIP');
  await until(()=>evaluate("!document.getElementById('downloadAcfZip').disabled"),'ACF export finished');
  const acfCheck=await evaluate('globalThis.acfCheck'),P=require('../web/plane.js'),props=P.parseACF(acfCheck.text);
  assert.ok(Math.abs(Number(props.get('_wing/0/_Croot'))*.3048-.15)<1e-8);
  assert.ok(props.has('_wing/8/_Croot'));assert.ok(props.has('_wing/10/_Croot'));
  assert.equal(props.get('acf/_num_engn'),'1');assert.equal(props.get('_engn/0/_type'),'ELE');assert.ok(Math.abs(Number(props.get('acf/_m_empty'))*.45359237-1.25)<1e-9);
  assert.equal(acfCheck.paths.filter(p=>p.endsWith('.afl')).length,3);
  assert.ok(Math.abs(Number(props.get('acf/_Vne_kts'))*1.852-150)<1e-8);assert.equal(acfCheck.report.flightSettings.cgPercent,26);assert.equal(acfCheck.report.flightSettings.rpm,10000);
  assert.equal(acfCheck.report.flightSettings.diameterM,.2032);assert.equal(acfCheck.report.flightSettings.pitchM,.2032);
  assert.equal(acfCheck.report.acf.flightSetup.powerW,250);
  assert.equal(props.get('acf/_num_xmsn'),'1');assert.equal(props.get('acf/_xmsn_of_engn/0'),'0');assert.equal(props.get('acf/_xmsn_of_prop/0'),'0');
  for(let i=0;i<3;i++){assert.equal(props.get(`_gear/${i}/_gear_type`),'1');assert.equal(props.get(`_gear/${i}/_gear_renders_geo`),'0');
    assert.ok(Math.abs(Number(props.get(`_gear/${i}/_tire_radius`))*.3048-.02)<1e-9);assert.ok(Math.abs(Number(props.get(`_gear/${i}/_strut_max_wgt_def`))*.3048-.001)<1e-9);}
  assert.equal(props.get('acf/_use_cus_gear_defs'),'1');assert.equal(props.get('acf/_use_cus_gear_damping'),'1');
  assert.ok(acfCheck.report.acf.flightSetup.groundGear.propClearanceM>0);
  assert.ok(Math.abs(Number(props.get('acf/_cgZ'))*.3048-acfCheck.report.acf.flightSetup.cgZM)<1e-9);
  assert.ok(await evaluate("document.getElementById('cgInfo').textContent.includes('26')"));
  assert.equal(props.get('_body/0/_s_dim'),'16');
  assert.equal(acfCheck.report.acf.segments.filter(s=>s.role==='wing'&&s.isMisc).length,2);
  assert.ok(acfCheck.report.acf.segments.some(s=>s.customChords));
  assert.equal(acfCheck.report.draft.surfaces.find(s=>s.role==='wing').nodes.length,11);
  await evaluate("document.getElementById('frontSign').value='-';document.getElementById('frontSign').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.getElementById('downloadZip').disabled"),true);
  await evaluate("document.getElementById('analyze').click()");
  await until(()=>evaluate("!document.getElementById('analyze').disabled && document.getElementById('triangles').textContent.replace(/\\D/g,'') === '407345'"),'nose reversal recalculated');
  await evaluate("document.getElementById('axesConfirmed').click();document.getElementById('downloadJson').click()");
  await until(()=>{try{return JSON.parse(fs.readFileSync(path.join(output,'Project333_geometry.json'),'utf8')).options.nose==='-Z';}catch{return false;}},'reversed JSON');
  const reversed=JSON.parse(fs.readFileSync(path.join(output,'Project333_geometry.json'),'utf8'));
  assert.equal(reversed.options.nose,'-Z');assert.ok(reversed.bodies[0].bounds.max[2]>0);
  assert.ok(Math.abs(geometry.bodies[0].bounds.min[2]+reversed.bodies[0].bounds.max[2])<1e-6);
  await evaluate("document.getElementById('frontSign').value='+';document.getElementById('frontSign').dispatchEvent(new Event('change'));document.getElementById('analyze').click()");
  await until(()=>evaluate("!document.getElementById('analyze').disabled"),'original axes restored');
  await evaluate("document.getElementById('axesConfirmed').click();document.getElementById('downloadZip').click()");
  await until(()=>fs.existsSync(path.join(output,'Project333_geometry.zip')),'geometry ZIP',60000);
  await until(()=>evaluate("!document.getElementById('downloadZip').disabled"),'export finished');
  await evaluate("document.getElementById('sliceIndex').value='6';document.getElementById('sliceIndex').dispatchEvent(new Event('input'))");
  const image=await page('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(output,'desktop.png'),Buffer.from(image.data,'base64'));
  await evaluate("document.getElementById('upAxis').value='Z';document.getElementById('upAxis').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.getElementById('downloadZip').disabled"),true);
  await evaluate("document.getElementById('analyze').click()");
  assert.equal(await evaluate("document.getElementById('status').className"),'error');
  await page('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'));
  assert.equal(exceptions.length,0,JSON.stringify(exceptions));
  assert.ok(requests.every(url=>/^(file:|data:|blob:|about:)/.test(url)),JSON.stringify(requests));
  const report={passed:true,output,zip:path.join(output,'Project333_geometry.zip'),parts:4,triangles:407345,
    fileUrlLaunch:true,workerFromBlob:true,axisReversalChecked:true,invalidAxesRejected:true,
    explicitAxisConfirmation:true,leftDragPanChecked:true,rightDragRotateChecked:true,viewResetChecked:true,tangentRepairsValidated:true,editableDraftChecked:true,customSamplingChecked:true,localEditsPreserved:true,separateWingtipChecked:true,physicalInputsChecked:true,physicalInputsPreserved:true,propPreviewChecked:true,hiddenSupportsChecked:true,propClearanceGuardChecked:true,experimentalAcfZipValidated:true,zipExport:true,mobileNoOverflow:true,javascriptErrors:exceptions,
    networkRequests:requests,planeMakerValidated:false,flightValidated:false};
  fs.writeFileSync(path.join(project,'reports','last-browser-test.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  await call('Browser.close');
})().catch(error=>{console.error(error,stderr.slice(-2000));process.exitCode=1;}).finally(()=>{
  if(socket)socket.close();
  if(processHandle.exitCode===null&&!processHandle.killed)processHandle.kill();
});
