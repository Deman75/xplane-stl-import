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

  await until(()=>evaluate("!document.getElementById('analyze').disabled && document.querySelectorAll('.file').length > 0"),'current project loaded');
  await evaluate("{const original=FlightSetup.propPreview;globalThis.propCalls=[];FlightSetup.propPreview=s=>{const p=original(s);propCalls.push(p.center);return p;};}");
  for(const eventName of ['input','change'])for(const [axis,id]of ['motorX','motorY','motorZ'].entries()){
    const value=(axis+1)*100;
    await evaluate(`{propCalls=[];const e=document.getElementById('${id}');e.value='${value}';e.dispatchEvent(new Event('${eventName}',{bubbles:true}));}`);
    const calls=await evaluate('propCalls');
    assert.ok(calls.length,eventName+' must redraw '+id);
    assert.equal(calls.at(-1)[axis],value/1000);
  }
  assert.equal(exceptions.length,0,JSON.stringify(exceptions));
  assert.ok(requests.every(url=>/^(file:|data:|blob:|about:)/.test(url)));
  console.log(JSON.stringify({passed:true,motorInputAndChangeRedraw:true,javascriptErrors:exceptions}));
  await call('Browser.close');
})().catch(error=>{console.error(error,stderr.slice(-2000));process.exitCode=1;}).finally(()=>{
  if(socket)socket.close();
  if(processHandle.exitCode===null&&!processHandle.killed)processHandle.kill();
});
