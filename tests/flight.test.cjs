'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const F=require('../web/flight.js'),P=require('../web/plane.js');
const template='I\n1200 Version\nACF\nPROPERTIES_BEGIN\nP _body/0/_geo_xyz/i_count 20\nP acf/_num_engn 0\nP acf/_m_empty 0\nP acf/_m_max 1\nPROPERTIES_END\n';
const foil={name:'test.afl',thickness:.12,outline:Array.from({length:14},(_,i)=>[i<7?-.25+i/6:.75-(i-7)/6,0])},foils=new Map([['test.afl',foil]]);
function draft(){return {bodies:[],surfaces:[{role:'wing',nativePanels:4,customChords:true,nodes:[{enabled:true,at:0,chord:.4,z:1,height:0,incidence:0},{enabled:true,at:1,chord:.2,z:1.4,height:.1,incidence:0}]}]};}
function settings(){return {massKg:1.25,vneKmh:150,cgPercent:26,cgYM:.03,power:250,powerUnit:'W',diameterM:.2032,pitchM:.2032,rpm:10000,blades:2,gearRatio:1,direction:1,rootChordM:.02,tipChordM:.008,batteryWh:22.2,batteryV:11.1,positionM:[0,.02,-.1],propFoil:'test.afl'};}
function gear(){return {enabled:true,type:1,diameterM:.04,widthM:.02,yM:-.2,frontZM:0,rearZM:2,trackM:.3,deflectionM:.001,dampingRatio:1};}
test('propeller preview is a full-size disc in canonical XY at the entered Z',()=>{
 const p=F.propPreview({diameterM:.2032,positionM:[.03,.05,-.08]});assert.equal(p.ring.length,64);assert.equal(p.radius,.1016);
 for(const v of p.ring){assert.equal(v[2],-.08);assert.ok(Math.abs(Math.hypot(v[0]-.03,v[1]-.05)-.1016)<1e-12);}
 const q=F.propPreview({diameterM:.4,positionM:[1,2,3]});assert.ok(Math.abs(q.ring[0][0]-1.2)<1e-12);assert.equal(q.ring[16][1],2.2);
 assert.throws(()=>F.propPreview({diameterM:0,positionM:[0,0,0]}));assert.throws(()=>F.propPreview({diameterM:.2,positionM:[NaN,0,0]}));
});
test('hidden supports preserve requested dimensions and balance weight about CG',()=>{
 const g=gear(),d=draft(),s={...settings(),groundGear:g},r=P.buildACF(template,d,{wingRoot:'test.afl'},foils,'Test',s),p=P.parseACF(r.text),v=k=>Number(p.get(k)),details=r.flightSetup.groundGear;
 assert.equal(v('acf/_use_cus_gear_defs'),1);assert.equal(v('acf/_use_cus_gear_damping'),1);assert.equal(v('acf/_additonal_gear_flatplate'),0);
 let total=0,moment=0;
 for(let i=0;i<3;i++){
  const pre=`_gear/${i}/`,force=v(pre+'_strut_max_wgt_frc')*4.4482216152605,z=v(pre+'_gear_z')*.3048;
  total+=force;moment+=force*(z-r.flightSetup.cgZM);
  assert.equal(v(pre+'_gear_type'),1);assert.equal(v(pre+'_gear_renders_geo'),0);assert.equal(v(pre+'_gear_can_retract'),0);
  assert.ok(Math.abs(v(pre+'_tire_radius')*.3048-.02)<1e-10);assert.ok(Math.abs(v(pre+'_tire_swidth')*.3048-.01)<1e-10);
  assert.ok(Math.abs(v(pre+'_strut_max_wgt_def')*.3048-.001)<1e-10);assert.ok(Number.isFinite(v(pre+'_damp'))&&v(pre+'_damp')>0);
 }
 assert.ok(Math.abs(total-s.massKg*9.80665)<1e-8);assert.ok(Math.abs(moment)<1e-8);
 assert.ok(Math.abs(details.propClearanceM-(.02-.1016-(-.2-.02+.001)))<1e-12);
 assert.equal(details.loadFractions.length,3);for(let i=3;i<10;i++)assert.equal(v(`_gear/${i}/_gear_type`),0);
});
test('support validation rejects impossible positions, zero travel and prop-ground intersection',()=>{
 for(const patch of [{deflectionM:0},{deflectionM:.0001},{trackM:0},{diameterM:NaN},{rearZM:0},{type:3},{dampingRatio:0}])assert.throws(()=>F.gearGeometry({...gear(),...patch}));
 assert.throws(()=>F.gearProperties(gear(),1.25,3,settings()),/ЦТ/);
 assert.throws(()=>F.gearProperties({...gear(),yM:.1},1.25,1,settings()),/Винт/);
 assert.equal(F.gearProperties({...gear(),enabled:false},1.25,1,settings()).values.size,0);
 const g={...gear(),type:2};assert.equal(F.gearProperties(g,1.25,1,settings()).values.get('_gear/0/_gear_type'),2);
});
test('MAC uses area-weighted quarter chord and chord-squared integral on a swept trapezoid',()=>{
 const m=F.mac(draft(),P);assert.ok(Math.abs(m.areaM2-.6)<1e-12);assert.ok(Math.abs(m.chordM-(2/3)*(.16+.08+.04)/.6)<1e-12);
 const quarter=(2*1*.4+1*.2+1.4*.4+2*1.4*.2)/(3*(.4+.2));
 assert.ok(Math.abs(m.quarterChordZM-quarter)<1e-12);assert.ok(Math.abs(m.leadingEdgeZM-(quarter-.25*m.chordM))<1e-12);
});
test('CG includes Misc Wings and is invariant under changing panel boundaries',()=>{
 const d=draft();d.surfaces[0].nodes.splice(1,0,{enabled:false,at:.5,chord:.3,z:1.2,height:.05,incidence:0});
 const a=F.mac(d,P);d.surfaces[0].nodes[1].enabled=true;d.surfaces[0].separateTip=true;
 const b=F.mac(d,P);assert.ok(Math.abs(a.chordM-b.chordM)<1e-12);assert.ok(Math.abs(a.leadingEdgeZM-b.leadingEdgeZM)<1e-12);
 const r=P.buildACF(template,d,{wingRoot:'test.afl'},foils,'Test',settings());assert.equal(r.segments.filter(s=>s.isMisc).length,2);
 assert.ok(Math.abs(r.flightSetup.mac.chordM-r.mainWingMACM)<1e-12);assert.notEqual(r.nativeMainWingMACM,r.mainWingMACM);
});
test('full test mass, CG and electric powerplant reach native ACF in lb/ft/hp',()=>{
 const s=settings(),r=P.buildACF(template,draft(),{wingRoot:'test.afl'},foils,'Test',s),p=P.parseACF(r.text),v=k=>Number(p.get(k)),m=F.mac(draft(),P);
 assert.ok(Math.abs(v('acf/_m_empty')*.45359237-s.massKg)<1e-9);assert.equal(v('acf/_m_max'),v('acf/_m_empty'));assert.equal(v('acf/_m_fuel_max_tot'),0);
 assert.ok(Math.abs(v('acf/_cgZ')*.3048-(m.leadingEdgeZM+.26*m.chordM))<1e-9);assert.ok(Math.abs(v('acf/_cgY')*.3048-.03)<1e-9);
 assert.ok(Math.abs(v('acf/_Vne_kts')*1.852-150)<1e-8);assert.equal(p.get('_engn/0/_type'),'ELE');assert.equal(v('acf/_num_engn'),1);assert.equal(v('acf/_num_prop'),1);assert.equal(v('_prop/0/_prop_type'),0);
 assert.ok(Math.abs(v('_engn/0/_power_max_limit')*745.69987158227-250)<1e-8);
 assert.equal(v('acf/_num_xmsn'),1);assert.equal(v('acf/_xmsn_of_engn/0'),0);assert.equal(v('acf/_xmsn_of_prop/0'),0);
 assert.ok(Math.abs(v('_blad/0/_semilen_SEG')*.3048-s.diameterM/2)<1e-9);assert.equal(v('_prop/0/_des_rpm_prp'),10000);
 assert.equal(v('acf/_battery_watt_hr_max'),22.2);assert.equal(v('acf/_nom_bat_volt'),11.1);
 assert.equal(v('acf/_use_manual_prop_inc'),1);assert.equal(v('_blad/0/_ailn1/0'),0);assert.equal(v('_blad/0/_geo_xyz/i_count'),20);
 for(let i=0;i<10;i++){const angle=v(`_blad/0/_incidence/${i}`)*Math.PI/180,radius=s.diameterM/2*(i+.5)/10;assert.ok(Math.abs(2*Math.PI*radius*Math.tan(angle)-s.pitchM)<1e-9);}
 assert.ok(Math.abs(v('_blad/0/_part_z')*.3048+.1)<1e-9);assert.equal(v('_blad/0/_geo_xyz/0,0,0'),0,'blade cache is local');
 assert.equal(r.flightSetup.engineRPM,10000);assert.equal(r.requiredAirfoils.filter(n=>n==='test.afl').length,1);
});
test('metric horsepower, kW and gearbox use distinct explicit conversions',()=>{
 for(const [power,powerUnit,watts]of [[1,'metricHp',735.49875],[.25,'kW',250]]){
  const r=F.build({...settings(),power,powerUnit,gearRatio:2},draft(),P,foils);assert.equal(r.report.powerW,watts);assert.equal(r.report.engineRPM,20000);assert.equal(r.values.get('_prop/0/_des_rpm_prp'),10000);
 }
});
test('invalid and incomplete physical inputs block export; geometry-only export remains available',()=>{
 for(const changes of [{massKg:0},{vneKmh:0},{vneKmh:NaN},{cgPercent:NaN},{power:Infinity},{powerUnit:'watts'},{rpm:0},{pitchM:0},{gearRatio:-1},{blades:2.5},{diameterM:0},{batteryWh:0},{rootChordM:1},{positionM:[0,0]},{propFoil:'../x.afl'}])assert.throws(()=>F.build({...settings(),...changes},draft(),P,foils),JSON.stringify(changes));
 assert.throws(()=>F.build(settings(),draft(),P,new Map()));assert.throws(()=>F.mac({surfaces:[]},P));
 const r=P.buildACF(template,draft(),{wingRoot:'test.afl'},foils,'Test');assert.equal(r.flightSetup,null);assert.equal(P.parseACF(r.text).get('acf/_num_engn'),'0');
});
const root=path.resolve(__dirname,'..'),inspection=path.join(root,'reports/Project333-inspection.json'),realTemplate=path.join(root,'input/Project333/Project333_template.acf'),foilFolder=path.join(process.env.XPLANE_ROOT||path.join(root,'input/XPlane'),'Airfoils');
test('Project333 exports physical inputs with selected real AFLs and leaves template unchanged',{skip:![inspection,realTemplate,path.join(foilFolder,'Clark-Y (good propeller).afl')].every(fs.existsSync)},()=>{
 const before=fs.readFileSync(realTemplate),d=P.buildDraft(JSON.parse(fs.readFileSync(inspection))),names=['NACA 2412 (popular).afl','NACA 0009 (symmetrical).afl','Clark-Y (good propeller).afl'],afs=new Map(names.map(n=>[n,P.parseAFL(fs.readFileSync(path.join(foilFolder,n),'utf8'),n)]));
 const r=P.buildACF(before.toString(),d,{wingRoot:names[0],horizontalFoil:names[1],verticalFoil:names[1]},afs,'Project333',{...settings(),propFoil:names[2],groundGear:{...gear(),frontZM:.02,rearZM:.28}});
 assert.equal(r.requiredAirfoils.length,3);assert.ok(r.flightSetup.cgZM>r.flightSetup.mac.leadingEdgeZM);assert.deepEqual(fs.readFileSync(realTemplate),before);
 for(const [k,v]of P.parseACF(r.text))if(/^_(engn|prop|blad)\//.test(k)&&!k.includes('afl_file')&&!k.endsWith('/_type'))assert.ok(Number.isFinite(Number(v)),k);
 for(const [k,v]of P.parseACF(r.text))if(/^_gear\/[012]\//.test(k))assert.ok(Number.isFinite(Number(v)),k);
 fs.writeFileSync(path.join(root,'reports/Project333_flight_example.acf'),r.text);
 const {text,...report}=r;fs.writeFileSync(path.join(root,'reports/Project333-flight-verification.json'),JSON.stringify({...report,exampleInputsOnly:true,templateUnchanged:true},null,2));
});
