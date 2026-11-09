'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const C=require('../web/core.js');
const buf=text=>new TextEncoder().encode(text).buffer;
function binary(triangles){const buffer=new ArrayBuffer(84+50*triangles.length),v=new DataView(buffer);new Uint8Array(buffer).set(new TextEncoder().encode('solid binary header'));v.setUint32(80,triangles.length,true);triangles.forEach((t,i)=>t.flat().forEach((x,j)=>v.setFloat32(84+i*50+12+j*4,x,true)));return buffer;}
function mesh(triangles,role='body',group='Fuselage'){const vertices=new Float32Array(triangles.flat(2));return {vertices,bounds:C.bounds(vertices),triangles:triangles.length,role,group,path:group+'.stl',format:'fixture'};}
function cube(x0=-1,x1=1,y0=-1,y1=1,z0=-1,z1=1){const p=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],faces=[[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]];return faces.flatMap(([a,b,c,d])=>[[p[a],p[b],p[c]],[p[a],p[c],p[d]]]);}
test('binary STL with a misleading solid header; count, bounds and invalid lengths',()=>{
 const p=C.parseSTL(binary([[[0,0,0],[2,0,0],[0,3,0]]]));assert.equal(p.format,'binary');assert.equal(p.triangles,1);assert.deepEqual(p.bounds.size,[2,3,0]);
 assert.throws(()=>C.parseSTL(new ArrayBuffer(3)));const b=binary([[[NaN,0,0],[2,0,0],[0,3,0]]]);assert.throws(()=>C.parseSTL(b));
 assert.throws(()=>C.parseSTL(binary(cube()).slice(0,-1)));
});
test('ASCII STL validates facet vertex counts and finite coordinates',()=>{
 const text='solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 2 0 0\nvertex 0 3 0\nendloop\nendfacet\nendsolid test\n';
 assert.equal(C.parseSTL(buf(text)).triangles,1);assert.throws(()=>C.parseSTL(buf(text.replace('vertex 0 3 0\n',''))));assert.throws(()=>C.parseSTL(buf(text.replace('vertex 0 3 0','vertex NaN 3 0'))));
});
test('shared coordinates, unit conversion and forward axis reversal',()=>{
 const v=new Float32Array([10,20,30,40,50,60,70,80,90]);
 const out=C.transform(v,{unit:'mm',factor:2,right:'+X',up:'+Y',nose:'+Z'});
 assert.ok(Math.abs(out[0]-.02)<1e-8);assert.ok(Math.abs(out[2]+.06)<1e-8);
 assert.deepEqual([...v],[10,20,30,40,50,60,70,80,90]);
 const reversed=C.transform(v,{unit:'mm',right:'+X',up:'+Y',nose:'-Z'});assert.ok(reversed[2]>0);
 assert.throws(()=>C.transform(v,{right:'+X',up:'+X',nose:'+Z'}));assert.throws(()=>C.transform(v,{factor:0}));
});
test('triangle-plane cuts give a square; cap coplanarity and empty cuts',()=>{
 const m=mesh(cube()),s=C.slice([m],2,0);assert.equal(s.length,8);
 const e=C.envelope(s,8);assert.equal(e.missing,0);assert.deepEqual(e.ring[0],[1,0]);assert.ok(Math.abs(e.ring[1][0]-1)<1e-8);assert.equal(C.slice([m],2,3).length,0);
 assert.ok(C.slice([m],2,1).length>0);
});
test('split fuselage parts retain common placement; inner walls do not shrink the outer radial envelope',()=>{
 const a=mesh(cube(-1,1,-1,1,-2,0)),b=mesh(cube(-1,1,-1,1,0,2)),inner=mesh(cube(-.4,.4,-.4,.4,-2,2));
 const e=C.envelope(C.slice([a,b,inner],2,0),36);assert.equal(e.missing,0);assert.equal(e.ring[0][0],1);
 const r=C.analyze([a,b,inner],{stations:5,radii:36});assert.equal(r.bodies.length,1);assert.equal(r.bodies[0].sections.length,5);assert.ok(r.bodies[0].sections.every(s=>s.missing===0));
});
test('real gaps are reported, not silently interpolated',()=>{
 const r=C.analyze([mesh(cube(-1,1,-1,1,-2,-.1)),mesh(cube(-1,1,-1,1,.1,2))],{stations:5,radii:18});assert.equal(r.bodies[0].sections[2].segments.length,0);assert.equal(r.bodies[0].sections[2].missing,18);
});
test('separate body groups are not joined; wing and fin cuts use the correct plane',()=>{
 const r=C.analyze([mesh(cube(),'body','A'),mesh(cube(),'body','B'),mesh(cube(-4,4,-.1,.1,2,3),'wing'),mesh(cube(-.1,.1,0,2,4,5),'vertical')],{stations:3});
 assert.equal(r.bodies.length,2);assert.equal(r.surfaces[0].samples[7].chord,1);assert.equal(r.surfaces[1].normal,1);assert.equal(r.surfaces[1].samples[7].leading,4);
});
test('OBJ8 exports canonical positions, finite normals and complete index tables',()=>{
 const text=C.obj8(new Float32Array([0,0,0,1,0,0,0,1,0]));assert.match(text,/POINT_COUNTS 3 0 0 3/);assert.match(text,/VT 1 0 0 0 0 1 0 0/);assert.match(text,/IDX 2/);assert.match(text,/TRIS 0 3/);assert.ok(!text.includes('NaN'));
});
const project=path.resolve(__dirname,'..'),source=path.join(project,'input/Project333');
test('Hermite bridge preserves endpoint positions and tangent directions',()=>{
 const a=[0,0],b=[3,1],ma=[2,1],mb=[1,-2],eps=1e-6;
 assert.deepEqual(C.hermite(a,b,ma,mb,0),a);assert.deepEqual(C.hermite(a,b,ma,mb,1),b);
 const nearA=C.hermite(a,b,ma,mb,eps),nearB=C.hermite(a,b,ma,mb,1-eps);
 for(let i=0;i<2;i++){assert.ok(Math.abs((nearA[i]-a[i])/eps-ma[i])<1e-4);assert.ok(Math.abs((b[i]-nearB[i])/eps-mb[i])<1e-4);}
});
test('circumferential repair spans wraparound, retains samples, respects angular limit',()=>{
 const circle=Array.from({length:36},(_,i)=>[Math.cos(i*Math.PI/18),Math.sin(i*Math.PI/18)]),cut=circle.map(p=>p.slice());
 for(const i of [35,0,1])cut[i]=null;
 const r=C.fillRingTangents(cut,90);assert.equal(r.filled.length,3);assert.ok(r.ring.every(Boolean));
 for(let i=2;i<35;i++)assert.deepEqual(r.ring[i],circle[i]);assert.equal(cut[0],null);
 assert.equal(C.fillRingTangents(cut,30).filled.length,0);
 const sections=[{z:0,ring:cut,segments:[[[0,0],[1,1]]]}];C.repairSections(sections,{repairGaps:false});assert.equal(sections[0].remainingMissing,3);
});
test('longitudinal repair uses neighbouring sections, limits and no endpoint extrapolation',()=>{
 const section=(z,present)=>({z,segments:present?[[[0,0],[1,1]]]:[],ring:present?[[z,0],[z,1],[z+1,1],[z+1,0]]:[null,null,null,null]});
 const s=[section(0,true),section(.01,true),section(.02,false),section(.03,true),section(.04,true)];
 C.repairSections(s,{repairGaps:true,maxGapLengthM:.05});assert.equal(s[2].remainingMissing,0);assert.equal(s[2].interpolatedPoints.length,4);assert.ok(Math.abs(s[2].ring[0][0]-.02)<1e-10);
 const limited=[section(0,true),section(.01,true),section(.02,false),section(.03,true),section(.04,true)];
 C.repairSections(limited,{repairGaps:true,maxGapLengthM:.01});assert.equal(limited[2].remainingMissing,4);
 const end=[section(0,false),section(.01,true),section(.02,true)];C.repairSections(end,{repairGaps:true});assert.equal(end[0].remainingMissing,4);
});
test('provided Project333: all four meshes, body sections, spans and source hashes',{skip:!['Fuselage/Fuselage.stl','Wing/wing.stl','Tail/Horizontal_Stab.stl','Tail/Vertical_Stab.stl'].every(name=>fs.existsSync(path.join(source,name)))},()=>{
 const names=['Fuselage/Fuselage.stl','Wing/wing.stl','Tail/Horizontal_Stab.stl','Tail/Vertical_Stab.stl'],hashes={};
 const options={unit:'mm',factor:1,right:'-X',up:'+Y',nose:'+Z',stations:20,radii:36,repairGaps:true,maxGapDegrees:90,maxGapLengthM:.05};
 const meshes=names.map(name=>{const b=fs.readFileSync(path.join(source,name));hashes[name]=crypto.createHash('sha256').update(b).digest('hex');const p=C.parseSTL(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)),vertices=C.transform(p.vertices,options);return {...p,vertices,bounds:C.bounds(vertices),path:name,role:C.roleFor(name),group:name.split('/')[0]};});
 assert.equal(meshes.reduce((n,m)=>n+m.triangles,0),407345);const r=C.analyze(meshes,options);
 assert.equal(r.bodies.length,1);assert.equal(r.surfaces.length,3);assert.ok(Math.abs(r.surfaces.find(s=>s.role==='wing').bounds.size[0]-1.2960444)<1e-6);
 const report=C.report(meshes,r,options);report.sourceHashes=hashes;report.axesConfirmed=false;
 fs.mkdirSync(path.join(project,'reports'),{recursive:true});fs.writeFileSync(path.join(project,'reports','Project333-inspection.json'),JSON.stringify(report,null,2));
 for(const name of names)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(source,name))).digest('hex'),hashes[name]);
 assert.equal(r.bodies[0].sections[6].remainingMissing,0);assert.equal(r.bodies[0].sections[7].remainingMissing,0);assert.equal(r.bodies[0].sections[8].remainingMissing,0);
 console.log('Project333: remaining missing rays',r.bodies[0].sections.map(s=>s.remainingMissing).join(','));
});
