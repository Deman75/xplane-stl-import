'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const P=require('../web/plane.js'),root=path.resolve(__dirname,'..'),context={};
vm.runInNewContext(fs.readFileSync(path.join(root,'web/bundled-assets.js'),'utf8'),context);
const assets=context.BundledAircraftAssets;
test('offline bundle contains every AFL byte-for-byte and a valid empty ACF base',()=>{
 const names=fs.readdirSync(path.join(root,'Airfoils')).filter(n=>/\.afl$/i.test(n)).sort();
 assert.equal(assets.airfoils.length,names.length);assert.ok(names.length>0);
 for(const name of names){
  const item=assets.airfoils.find(f=>f.name===name);assert.ok(item,name);
  assert.equal(item.text,fs.readFileSync(path.join(root,'Airfoils',name),'utf8'));
  assert.ok(P.parseAFL(item.text,name).thickness>0);
 }
 assert.equal(assets.template.text,fs.readFileSync(path.join(root,'input',assets.template.name),'utf8'));
 const p=P.validateTemplate(assets.template.text);
 assert.equal(Number(p.get('acf/_num_engn')),0);assert.equal(Number(p.get('acf/_m_empty')),0);
 assert.equal(Number(p.get('_body/0/_s_dim')),0);
 for(const [key,value]of p)if(/^_body\/0\/_geo_xyz\/\d+,\d+,\d+$/.test(key))assert.equal(Number(value),0);
});
test('bundled profiles and template export an ACF without any user-selected supporting files',()=>{
 const name='NACA 2412 (popular).afl',f=assets.airfoils.find(f=>f.name===name);
 const foils=new Map([[name,P.parseAFL(f.text,name)]]);
 const d={closeCaps:true,bodies:[],surfaces:[{role:'wing',nodes:[0,.5].map(at=>({enabled:true,at,chord:.2,z:0,height:0,incidence:0}))}]};
 const r=P.buildACF(assets.template.text,d,{wingRoot:name},foils,'Bundled test');
 const p=P.parseACF(r.text);assert.equal(p.get('acf/_name'),'Bundled test');
 assert.equal(p.get('_wing/0/_afl_file_1'),name);assert.equal(p.get('_wing/1/_afl_file_1'),name);
});
