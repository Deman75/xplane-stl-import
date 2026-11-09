'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const P=require('../web/plane.js');
const template='I\r\n1200 Version\r\nACF\r\nPROPERTIES_BEGIN\r\nP _body/count 39\r\nP _wing/count 48\r\nP _body/0/_geo_xyz/i_count 20\r\nP _body/0/_part_cd 0.075\r\nP acf/_m_empty 0\r\nP acf/_num_engn 0\r\nP acf/_custom_keep 123.0000\r\nPROPERTIES_END\r\nPANEL_2D_BEGIN\r\nPANEL_2D_END\r\n';
function foil(name='test.afl'){return {name,thickness:.12,outline:Array.from({length:14},(_,j)=>[j<7?-.25+j/6:.75-(j-7)/6,j===0||j===6||j===7||j===13?0:j<7?.5:-.5])};}
function draftFixture(){const shape=Array.from({length:36},(_,i)=>[Math.cos(i*Math.PI/18)/2,Math.sin(i*Math.PI/18)/2]);return {closeCaps:true,bodies:[{group:'Fuselage',sections:[0,1,2].map((z,i)=>({z,cap:i===0||i===2,cx:0,cy:.1,width:.2,height:.3,shape:shape.map(p=>p.slice())}))}],surfaces:['wing','horizontal','vertical'].map((role,index)=>({role,nodes:[0,.5].map(at=>({enabled:true,at,chord:.2,z:1+index,height:0,incidence:0}))}))};}
const profiles={wingRoot:'test.afl',horizontalFoil:'test.afl',verticalFoil:'test.afl'},foils=new Map([['test.afl',foil()]]);
test('measured circular first and last body sections survive default draft and ACF export',()=>{
 const ring=Array.from({length:36},(_,i)=>[.1*Math.cos(i*Math.PI/18),.1+.15*Math.sin(i*Math.PI/18)]);
 const d=P.buildDraft({bodies:[{group:'Cylinder',sections:[0,1,2].map(z=>({z,ring,interpolatedPoints:[]}))}],surfaces:[]});
 assert.equal(d.closeCaps,true);
 assert.deepEqual(P.bodyRing(d.bodies[0].sections[0]),ring);
 const p=P.parseACF(P.buildACF(template,d,{},new Map(),'Cylinder').text);
 assert.equal(Number(p.get('_body/0/_s_dim')),5);
 for(const i of [1,3]){
  const xs=Array.from({length:18},(_,j)=>Number(p.get(`_body/0/_geo_xyz/${i},${j},0`))*.3048);
  const ys=Array.from({length:18},(_,j)=>Number(p.get(`_body/0/_geo_xyz/${i},${j},1`))*.3048);
  assert.ok(Math.abs(Math.max(...xs)-Math.min(...xs)-.2)<1e-9);
  assert.ok(Math.abs(Math.max(...ys)-Math.min(...ys)-.3)<1e-9);
 }
 for(const [cap,ringIndex,expectedZ] of [[0,1,0],[4,3,2]])for(let j=0;j<18;j++){
  const v=(i,a)=>Number(p.get(`_body/0/_geo_xyz/${i},${j},${a}`))*.3048;
  assert.ok(Math.abs(v(cap,0))<1e-9);assert.ok(Math.abs(v(cap,1)-.1)<1e-9);
  assert.ok(Math.abs(v(cap,2)-expectedZ)<1e-9);assert.equal(v(cap,2),v(ringIndex,2));
 }
 d.closeCaps=false;
 const open=P.parseACF(P.buildACF(template,d,{},new Map(),'Cylinder').text);
 assert.equal(Number(open.get('_body/0/_s_dim')),3);
 d.bodies[0].sections[0].shape[0]=null;
 assert.throws(()=>P.validateDraft(d));
 d.closeCaps=true;assert.throws(()=>P.validateDraft(d));
});
test('flat end closures reserve two ACF stations without dropping measured end rings',()=>{
 const ring=Array.from({length:36},(_,i)=>[.1*Math.cos(i*Math.PI/18),.1*Math.sin(i*Math.PI/18)]);
 const d=P.buildDraft({bodies:[{group:'Cylinder',sections:Array.from({length:30},(_,i)=>({z:i,ring,interpolatedPoints:[]}))}],surfaces:[]});
 assert.equal(d.bodies[0].sections.length,18);
 const stations=P.bodyStations(d.bodies[0]);assert.equal(stations.length,20);
 assert.deepEqual(stations.map(s=>s.z),[0,...d.bodies[0].sections.map(s=>s.z),29]);
 assert.equal(stations[1],d.bodies[0].sections[0]);assert.equal(stations[18],d.bodies[0].sections.at(-1));
 assert.ok(P.validateDraft(d));
 d.bodies[0].sections.splice(1,0,{...d.bodies[0].sections[0],z:.5});
 assert.throws(()=>P.validateDraft(d));
});
test('only fresh ACF 1200 templates are accepted; duplicate properties fail',()=>{
 assert.ok(P.validateTemplate(template));assert.throws(()=>P.validateTemplate(template.replace('_m_empty 0','_m_empty 20')));assert.throws(()=>P.validateTemplate(template.replace('1200 Version','1100 Version')));
 assert.throws(()=>P.parseACF(template.replace('PROPERTIES_END','P acf/_custom_keep 2\r\nPROPERTIES_END')));
});
test('draft limits, ordered stations, valid chords and incomplete interior rings',()=>{
 assert.ok(P.validateDraft(draftFixture()));let d=draftFixture();d.surfaces[0].nodes[1].chord=0;assert.throws(()=>P.validateDraft(d));
 d=draftFixture();d.bodies[0].sections[1].shape[0]=null;assert.throws(()=>P.validateDraft(d));
 d=draftFixture();d.bodies[0].sections[1].z=3;assert.throws(()=>P.validateDraft(d));
 d=draftFixture();d.bodies[0].sections[0].shape[0]=null;assert.throws(()=>P.validateDraft(d));d.closeCaps=false;assert.throws(()=>P.validateDraft(d));
});
test('ACF body stations are feet, top/right/bottom/left ordered and end caps close',()=>{
 const result=P.buildACF(template,draftFixture(),profiles,foils,'Test'),p=P.parseACF(result.text),v=k=>Number(p.get('_body/0/'+k));
 assert.equal(v('_s_dim'),5);assert.equal(v('_r_dim'),18);
 assert.ok(Math.abs(v('_geo_xyz/1,0,1')-.25/.3048)<1e-9);
 assert.ok(Math.abs(v('_geo_xyz/1,4,0')-.1/.3048)<1e-9);
 assert.ok(v('_geo_xyz/1,13,0')<0);
 assert.equal(v('_geo_xyz/1,8,1'),v('_geo_xyz/1,9,1'));
 assert.equal(v('_geo_xyz/1,0,1'),v('_geo_xyz/1,17,1'));
 for(let j=0;j<18;j++){assert.equal(v(`_geo_xyz/0,${j},0`),0);assert.ok(Math.abs(v(`_geo_xyz/0,${j},1`)-.1/.3048)<1e-9);}
 assert.ok(!/(?<!\r)\n/.test(result.text));assert.equal(p.get('acf/_custom_keep'),'123.0000');assert.equal(p.get('acf/_m_empty'),'0');assert.equal(p.get('acf/_num_engn'),'0');
});
test('main wings use 0/1, horizontal tail 8/9, vertical tail 10; no inherited controls',()=>{
 const result=P.buildACF(template,draftFixture(),profiles,foils,'Test'),p=P.parseACF(result.text);
 assert.deepEqual(result.segments.map(s=>s.index),[0,1,8,9,10]);assert.ok(!p.has('_wing/4/_Croot'));
 for(const s of result.segments){assert.equal(p.get(`_wing/${s.index}/_ailn1/0`),'0');assert.equal(p.get(`_wing/${s.index}/_afl_file_1`),'test.afl');}
 assert.equal(Number(p.get('_wing/10/_dihed_design')),90);assert.ok(Math.abs(result.mainWingMACM-.2)<1e-10);assert.ok(Math.abs(result.mainWingAreaM2-.2)<1e-10);
});
test('multiple horizontal panels allocate Misc Wings, keeping them out of Wings 1-4',()=>{
 const d=draftFixture();d.surfaces[1].nodes.push({...d.surfaces[1].nodes[1],at:1});d.surfaces[1].separateTip=true;const r=P.buildACF(template,d,profiles,foils,'Test');
 assert.deepEqual(r.segments.filter(s=>s.role==='horizontal').map(s=>s.index),[8,9,12,13]);assert.ok(r.segments.filter(s=>s.role!=='wing').every(s=>s.index>=8));
});
test('missing AFLs and unsupported mixed profiles fail explicitly',()=>{
 assert.throws(()=>P.buildACF(template,draftFixture(),profiles,new Map(),'Test'));
 assert.throws(()=>P.buildACF(template,draftFixture(),{...profiles,wingTip:'other.afl'},foils,'Test'));
});
const root=path.resolve(__dirname,'..'),realTemplate=path.join(root,'input/Project333/Project333_template.acf'),inspection=path.join(root,'reports/Project333-inspection.json'),xplane=process.env.XPLANE_ROOT||path.join(root,'input/XPlane'),foilFolder=path.join(xplane,'Airfoils');
const nativeAerolite=path.join(xplane,'Aircraft/Laminar Research/Aero-Works Aerolite 103/Aerolite_103.acf');
test('native Plane Maker ACF offsets use the scaled chord, not the base chord',{skip:!fs.existsSync(nativeAerolite)},()=>{
 const p=P.parseACF(fs.readFileSync(nativeAerolite,'utf8')),v=k=>Number(p.get('_wing/0/'+k));
 for(const i of [5,9]){
  const t=i/10,baseChord=v('_Croot')*(1-t)+v('_Ctip')*t,actualChord=baseChord*v(`_c_rat_for_RIB/${i}`),
   baseZ=v('_part_z')+v('_semilen_SEG')*Math.sin(v('_sweep_design')*Math.PI/180)*t,
   zs=Array.from({length:14},(_,j)=>v(`_geo_xyz/${2*i-1},${j},2`)),q=Math.min(...zs)+.25*(Math.max(...zs)-Math.min(...zs));
  assert.ok(Math.abs(q-(baseZ+actualChord*v(`_c_off_for_RIB/${i}`)))<2e-6);
  assert.ok(Math.abs(q-(baseZ+baseChord*v(`_c_off_for_RIB/${i}`)))>.01);
 }
});
test('real AFL shape agrees with native Plane Maker cached NACA 23016 geometry',{skip:!fs.existsSync(path.join(foilFolder,'NACA 23016.afl'))},()=>{
 const name='NACA 23016.afl',f=P.parseAFL(fs.readFileSync(path.join(foilFolder,name),'utf8'),name),d={closeCaps:true,bodies:[],surfaces:[{role:'wing',nodes:[{enabled:true,at:0,height:1.68,z:.51,chord:1.6,incidence:0},{enabled:true,at:1.1,height:1.68,z:.51,chord:1.6,incidence:0}]}]};
 const r=P.buildACF(template,d,{wingRoot:name},new Map([[name,f]]),'Test'),p=P.parseACF(r.text);
 assert.ok(Math.abs(Number(p.get('_wing/0/_geo_xyz/0,1,1'))-5.685803413)<2e-6);
 assert.ok(Math.abs(Number(p.get('_wing/0/_geo_xyz/0,1,2'))-.478845000)<2e-6);
 assert.throws(()=>P.parseAFL('I\n1110 Version\n1234\nNaN','bad.afl'));
});
test('Project333 fresh template + edited draft produces complete experimental geometry',{skip:![realTemplate,inspection,path.join(foilFolder,'NACA 2412 (popular).afl')].every(fs.existsSync)},()=>{
 const before=fs.readFileSync(realTemplate),r=JSON.parse(fs.readFileSync(inspection)),d=P.buildDraft(r);
 // The archived first cut is incomplete. Use complete measured stations;
 // end closure points must never mask missing data in a measured ring.
 for(const b of d.bodies)b.sections=b.sections.filter(s=>s.shape.every(Boolean));
 assert.ok(P.validateDraft(d));assert.equal(d.surfaces[0].nodes[0].source,'root-extrapolation');
 d.surfaces[0].nodes[0].chord=.15;
 const names=['NACA 2412 (popular).afl','NACA 0009 (symmetrical).afl'],afs=new Map(names.map(n=>[n,P.parseAFL(fs.readFileSync(path.join(foilFolder,n),'utf8'),n)]));
 const result=P.buildACF(before.toString('utf8'),d,{wingRoot:names[0],horizontalFoil:names[1],verticalFoil:names[1]},afs,'Project333');
 const props=P.parseACF(result.text);assert.equal(props.get('acf/_name'),'Project333');assert.ok(result.segments.filter(s=>s.role!=='wing').every(s=>s.index>=8));
 for(const [k,v]of props)if(/_geo_xyz\/\d+,\d+,\d+$/.test(k))assert.ok(Number.isFinite(Number(v)),k);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(realTemplate)).digest('hex'),crypto.createHash('sha256').update(before).digest('hex'));
 fs.writeFileSync(path.join(root,'reports','Project333_import.acf'),result.text);
 const {text,...report}=result;fs.writeFileSync(path.join(root,'reports','Project333-acf-verification.json'),JSON.stringify({...report,templateUnchanged:true,profileGeometryChecked:true},null,2));
});
