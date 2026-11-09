'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../web/core.js'),P=require('../web/plane.js');
test('density distributions keep endpoints and concentrate samples in the requested zone',()=>{
 const uniform=C.stationPositions(-.1,.9,20),nose=C.stationPositions(-.1,.9,20,'start'),tip=C.stationPositions(-.1,.9,20,'end'),both=C.stationPositions(-.1,.9,20,'both'),zone=C.stationPositions(-.1,.9,20,'zone',{from:.1,to:.3,density:8});
 for(const xs of [uniform,nose,tip,both,zone]){assert.equal(xs.length,20);assert.ok(Math.abs(xs[0]+.1)<1e-12);assert.ok(Math.abs(xs.at(-1)-.9)<1e-12);assert.ok(xs.every((v,i)=>!i||v>xs[i-1]));}
 assert.ok(nose[1]-nose[0]<uniform[1]-uniform[0]);assert.ok(tip.at(-1)-tip.at(-2)<uniform.at(-1)-uniform.at(-2));assert.ok(both[1]-both[0]<uniform[1]-uniform[0]);
 assert.ok(zone.filter(x=>x>=.1&&x<=.3).length>uniform.filter(x=>x>=.1&&x<=.3).length*2);
 assert.throws(()=>C.stationPositions(0,1,20,'zone',{from:1,to:2}));assert.throws(()=>C.checkedPositions([0,0,.5],0,1));assert.throws(()=>C.checkedPositions([0,.5,2],0,1));
});
function taperedBox(){const p=[[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0],[-2,-1,1],[2,-1,1],[2,1,1],[-2,1,1]],faces=[[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]],triangles=faces.flatMap(([a,b,c,d])=>[[p[a],p[b],p[c]],[p[a],p[c],p[d]]]);const vertices=new Float32Array(triangles.flat(2));return {vertices,bounds:C.bounds(vertices),role:'body',group:'Fuselage'};}
test('moving a body station measures a new contour from STL, rather than moving the old ring',()=>{
 const m=taperedBox(),r=C.resampleTarget([m],{radii:36},{kind:'body',key:'Fuselage'},[0,.1,.8,1]);
 assert.deepEqual(r.sections.map(s=>s.z),[0,.1,.8,1]);
 assert.ok(Math.abs(r.sections[1].ring[0][0]-1.1)<1e-8);assert.ok(Math.abs(r.sections[2].ring[0][0]-1.8)<1e-8);
});
test('surface resampling follows an explicit custom station list',()=>{
 const m=taperedBox();m.role='vertical';const r=C.resampleTarget([m],{},{kind:'surface',key:'vertical'},[-.8,-.4,0,.7,.9]);
 assert.equal(r.samples.length,5);assert.deepEqual(r.samples.map(s=>s.at),[-.8,-.4,0,.7,.9]);assert.ok(r.samples.every(s=>!s.missing));
});
test('adaptive section boundaries pick the actual planform kink within the native budget',()=>{
 const surface={nodes:[0,.1,.2,.3,.4].map(at=>({at,chord:at<=.3?.2:.01,z:0,height:0,incidence:0,enabled:false}))};P.chooseBoundaries(surface,3);
 assert.equal(P.selected(surface).length,3);assert.ok(surface.nodes[3].enabled);
});
const template='I\n1200 Version\nACF\nPROPERTIES_BEGIN\nP _body/0/_geo_xyz/i_count 20\nP acf/_num_engn 0\nP acf/_m_empty 0\nPROPERTIES_END\n';
const foil={name:'test.afl',thickness:.12,outline:Array.from({length:14},()=>[0,0])},foils=new Map([['test.afl',foil]]);
function surface(){return {role:'wing',nativePanels:4,separateTip:false,customChords:true,nodes:[{at:0,chord:.2,z:1,height:0,incidence:0,enabled:true},{at:.5,chord:.3,z:1.1,height:0,incidence:0,enabled:false},{at:1,chord:.2,z:1,height:0,incidence:0,enabled:true}]};}
test('customize chords retains a curved outline without extra ACF panels',()=>{
 const s=surface(),r=P.buildACF(template,{closeCaps:true,bodies:[],surfaces:[s]},{wingRoot:'test.afl'},foils,'Test'),p=P.parseACF(r.text);
 assert.equal(r.segments.length,2);assert.ok(Math.abs(Number(p.get('_wing/0/_c_rat_for_RIB/5'))-1.5)<1e-10);assert.ok(Math.abs(Number(p.get('_wing/0/_c_off_for_RIB/5'))-1/3)<1e-10);
 assert.ok(Math.abs(Number(p.get('_wing/0/_chord_for_RIB/5'))*.3048-.3)<1e-9);
 assert.ok(Math.abs(Number(p.get('_wing/0/_geo_xyz/10,0,2'))*.3048-1.1)<1e-9);
});
test('explicit wingtip gets a mirrored Misc Wings pair and a separate full-wing MAC',()=>{
 const s=surface();s.nodes[1].enabled=true;s.separateTip=true;
 const r=P.buildACF(template,{closeCaps:true,bodies:[],surfaces:[s]},{wingRoot:'test.afl'},foils,'Test');
 assert.deepEqual(r.segments.map(s=>s.index),[0,1,12,13]);assert.deepEqual(r.segments.filter(s=>s.isMisc).map(s=>s.side),[-1,1]);assert.equal(P.nativeCount(s),1);assert.ok(r.mainWingMACM>0);assert.ok(r.nativeMainWingMACM>0);
});

test('Plane Maker reconstruction of customized tail ribs agrees with exported geometry',()=>{
 // Both narrowing and widening ratios, aft and forward offsets, and a very
 // small tip chord: using the base chord for offsets creates tip spikes.
 for(const role of ['horizontal','vertical']){
  const s={role,nativePanels:1,customChords:true,nodes:[
   {at:0,chord:.06,z:.88,height:0,incidence:0,enabled:true},
   {at:.04,chord:.025,z:.9,height:0,incidence:0,enabled:false},
   {at:.08,chord:.04,z:.91,height:0,incidence:0,enabled:false},
   {at:.1,chord:.003,z:.93,height:0,incidence:0,enabled:true}]};
  const r=P.buildACF(template,{bodies:[],surfaces:[s]},{horizontalFoil:'test.afl',verticalFoil:'test.afl'},foils,'Tail');
  const p=P.parseACF(r.text);
  for(const segment of r.segments){const pre=`_wing/${segment.index}/`,v=k=>Number(p.get(pre+k));
   for(let i=0;i<=10;i++){
    const t=i/10,baseChord=v('_Croot')*(1-t)+v('_Ctip')*t,actualChord=baseChord*v(`_c_rat_for_RIB/${i}`),
     baseZ=v('_part_z')+v('_semilen_SEG')*Math.sin(v('_sweep_design')*Math.PI/180)*t,
     reconstructedZ=baseZ+actualChord*v(`_c_off_for_RIB/${i}`),expected=P.nodeAt(s,t*.1).z/.3048;
    assert.ok(Math.abs(reconstructedZ-expected)<2e-8,`${role} rib ${i}`);
    assert.ok(Math.abs(v(`_geo_xyz/${Math.max(0,2*i-1)},0,2`)-reconstructedZ)<2e-8);
   }
  }
 }
});
test('native section budgets are enforced and Misc slot capacity is finite',()=>{
 const s=surface();s.nativePanels=5;assert.throws(()=>P.validateDraft({bodies:[],surfaces:[s]}));
 const many=role=>({role,nativePanels:1,separateTip:true,nodes:Array.from({length:21},(_,at)=>({at,chord:1,z:0,height:0,incidence:0,enabled:true}))});
 assert.throws(()=>P.validateDraft({bodies:[],surfaces:[many('wing'),many('horizontal')]}));
});
