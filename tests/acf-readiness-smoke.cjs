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

  const marked=async id=>evaluate(`document.getElementById('${id}').dataset.acfNeeded === 'true'`);
  assert.equal(await marked('folderInput'),true);
  assert.equal(await marked('templateInput'),false,'built-in template is ready');
  assert.equal(await evaluate("document.querySelectorAll('#foilNames option').length"),34);
  assert.equal(await marked('massKg'),false,'optional physical export is not required');
  const fixture=path.join(output,'ReadinessFixture');fs.mkdirSync(fixture);
  const source=fs.readFileSync(path.join(project,'tests','core.test.cjs'),'utf8');
  const cube=new Function(source.match(/function cube\([^\n]+/)[0]+';return cube;')();
  function stl(triangles){return 'solid fixture\n'+triangles.map(t=>'facet normal 0 0 0\nouter loop\n'+t.map(p=>'vertex '+p.join(' ')).join('\n')+'\nendloop\nendfacet').join('\n')+'\nendsolid fixture\n';}
  fs.writeFileSync(path.join(fixture,'Fuselage.stl'),stl(cube(-50,50,-50,50,-500,500)));
  fs.writeFileSync(path.join(fixture,'Wing.stl'),stl(cube(-600,600,-10,10,-100,100)));
  const {root}=await page('DOM.getDocument');
  const setFiles=async(selector,files)=>{const {nodeId}=await page('DOM.querySelector',{nodeId:root.nodeId,selector});await page('DOM.setFileInputFiles',{nodeId,files});};
  await setFiles('#folderInput',[fixture]);
  await until(()=>evaluate("!document.getElementById('analyze').disabled && document.getElementById('triangles').textContent.includes('24')"),'fixture analysed');
  assert.equal(await marked('folderInput'),false);
  assert.equal(await marked('axesConfirmed'),true);
  assert.equal(await marked('templateInput'),false,'built-in template survives loading a folder with only STL');
  assert.equal(await marked('foilFolderInput'),false,'built-in AFLs are ready');
  assert.equal(await marked('wingRoot'),true);
  assert.equal(await marked('wingTip'),false,'empty tip inherits root');
  assert.equal(await marked('horizontalFoil'),false,'no horizontal tail in fixture');
  await evaluate("{const e=document.getElementById('wingRoot');e.value='NACA 2412 (popular).afl';e.dispatchEvent(new Event('input'));document.getElementById('axesConfirmed').click();}");
  assert.equal(await marked('wingRoot'),false);
  assert.equal(await marked('axesConfirmed'),false);
  assert.equal(await evaluate("document.getElementById('downloadAcfZip').disabled"),false,await evaluate("document.getElementById('acfStatus').textContent"));
  assert.equal(await evaluate("document.getElementById('downloadAcfZip').classList.contains('acf-ready')"),true);
  await evaluate("{const make=OfflineZip.makeZip;OfflineZip.makeZip=entries=>{globalThis.exportEntries=entries.map(e=>({name:e.name,text:new TextDecoder().decode(e.data)}));return make(entries);};document.getElementById('downloadAcfZip').click();}");
  await until(()=>evaluate("Boolean(globalThis.exportEntries) && !document.getElementById('analyze').disabled"),'ACF with built-in assets exported');
  const exported=await evaluate('exportEntries');
  const afl=exported.find(e=>e.name.endsWith('/Airfoils/NACA 2412 (popular).afl'));
  assert.ok(afl,'selected AFL bytes included in ZIP');
  assert.equal(afl.text,fs.readFileSync(path.join(project,'Airfoils/NACA 2412 (popular).afl'),'utf8'));
  const exportReport=JSON.parse(exported.find(e=>e.name.endsWith('/import-report.json')).text);
  assert.equal(exportReport.templateFile,'PlaneMaker12_template.acf');
  assert.ok(exported.some(e=>e.name.endsWith('_import.acf')));
  await evaluate("document.getElementById('flightEnabled').click()");
  for(const id of ['massKg','vneKmh','motorPower','propRpm','batteryWh','batteryV'])assert.equal(await marked(id),true,id);
  assert.equal(await marked('cgPercent'),false,'valid defaults need no changes');
  await evaluate("{const e=document.getElementById('massKg');e.value='1.25';e.dispatchEvent(new Event('input'));}");
  assert.equal(await marked('massKg'),false);
  await evaluate("{const e=document.getElementById('massKg');e.value='-1';e.dispatchEvent(new Event('change'));}");
  assert.equal(await marked('massKg'),true,'invalid value is highlighted again');
  await evaluate("{const e=document.getElementById('gearTrack');e.value='';e.dispatchEvent(new Event('input'));}");
  assert.equal(await marked('gearTrack'),true);
  await evaluate("document.getElementById('gearEnabled').click()");
  assert.equal(await marked('gearTrack'),false,'disabled supports are optional');
  await evaluate("document.getElementById('flightEnabled').click()");
  assert.equal(await marked('massKg'),false,'disabled physical export removes field requirements');
  assert.equal(await evaluate("document.getElementById('downloadAcfZip').classList.contains('acf-ready')"),true);
  await evaluate("{const e=document.getElementById('wingTip');e.value='missing.afl';e.dispatchEvent(new Event('input'));}");
  assert.equal(await marked('wingTip'),true);
  assert.equal(await evaluate("document.getElementById('downloadAcfZip').disabled"),true);
  await evaluate("{const e=document.getElementById('wingTip');e.value='';e.dispatchEvent(new Event('input'));}");
  const screenshot=await page('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(output,'acf-readiness.png'),Buffer.from(screenshot.data,'base64'));
  await page('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'));
  assert.equal(exceptions.length,0,JSON.stringify(exceptions));
  assert.ok(requests.every(url=>/^(file:|data:|blob:|about:)/.test(url)));
  const report={passed:true,output,requiredActions:true,profileHighlight:true,optionalFields:true,invalidNumbers:true,readyButton:true,mobileNoOverflow:true,javascriptErrors:exceptions};
  fs.writeFileSync(path.join(project,'reports','last-acf-readiness-test.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  await call('Browser.close');
})().catch(error=>{console.error(error,stderr.slice(-2000));process.exitCode=1;}).finally(()=>{
  if(socket)socket.close();
  if(processHandle.exitCode===null&&!processHandle.killed)processHandle.kill();
});
