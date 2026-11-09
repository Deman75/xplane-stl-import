/* Geometry in canonical metres: X right, Y up, Z aft. No network or filesystem.
 * The factory is also serialized into an isolated Blob Worker for file:// use.
 */
function STLImporterCore() {
  'use strict';
  const LIMIT = 2000000;
  function bounds(vertices) {
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<vertices.length;i++) {const v=vertices[i];if(!Number.isFinite(v))throw Error('STL содержит нечисловые координаты.');const a=i%3;min[a]=Math.min(min[a],v);max[a]=Math.max(max[a],v);}
    return {min,max,size:max.map((v,i)=>v-min[i])};
  }
  function parseSTL(buffer) {
    const view=new DataView(buffer);let vertices,format;
    const count=buffer.byteLength>=84 ? view.getUint32(80,true) : 0;
    // Binary headers may start with "solid": the byte count is authoritative.
    if(buffer.byteLength>=84 && 84+count*50===buffer.byteLength) {
      if(!count || count>LIMIT)throw Error('Допустимо от 1 до 2 миллионов треугольников в одном STL.');
      vertices=new Float32Array(count*9);format='binary';
      for(let t=0;t<count;t++) for(let j=0;j<9;j++)vertices[t*9+j]=view.getFloat32(84+t*50+12+j*4,true);
    } else {
      const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer).replace(/^\uFEFF/,'');
      if(!/^\s*solid(?:\s|$)/i.test(text) || !/endsolid(?:\s|$)/i.test(text))throw Error('Не распознан STL или повреждена длина бинарного файла.');
      const values=[];let facets=0,inside=false,vertexCount=0;
      for(const raw of text.split(/\r\n|\r|\n/)) {
        const line=raw.trim();if(!line)continue;
        if(/^facet\s+normal\s/i.test(line)) {if(inside)throw Error('Незакрытая грань ASCII STL.');inside=true;vertexCount=0;facets++;}
        else if(/^vertex\s/i.test(line)) {
          if(!inside)throw Error('Вершина вне грани ASCII STL.');
          const fields=line.split(/\s+/);if(fields.length!==4)throw Error('Некорректная вершина ASCII STL.');
          for(const field of fields.slice(1)){const v=Number(field);if(!Number.isFinite(v))throw Error('Некорректное число ASCII STL.');values.push(v);}
          vertexCount++;
        } else if(line==='endfacet') {if(!inside||vertexCount!==3)throw Error('Грань STL должна иметь три вершины.');inside=false;}
        else if(!/^(solid(?:\s|$)|endsolid(?:\s|$)|outer\s+loop$|endloop$)/i.test(line))throw Error('Неизвестная строка ASCII STL.');
        if(facets>LIMIT)throw Error('Слишком много треугольников STL.');
      }
      if(inside||!facets||values.length!==facets*9)throw Error('Неполный ASCII STL.');
      vertices=new Float32Array(values);format='ascii';
    }
    return {vertices,format,triangles:vertices.length/9,bounds:bounds(vertices)};
  }
  function axis(code) {
    if(!/^[+-][XYZ]$/.test(code))throw Error('Укажите ось и знак.');
    return {index:'XYZ'.indexOf(code[1]),sign:code[0]==='+'?1:-1};
  }
  function mapping(options) {
    const x=axis(options.right||'+X'), y=axis(options.up||'+Y'), nose=axis(options.nose||'+Z');
    if(new Set([x.index,y.index,nose.index]).size!==3)throw Error('Направления вправо, вверх и нос должны использовать разные оси.');
    const factor=Number(options.factor??1),unit={mm:.001,cm:.01,m:1,in:.0254}[options.unit||'mm'];
    if(!unit||!Number.isFinite(factor)||factor<=0||factor>1e6)throw Error('Проверьте единицы и положительный масштаб (до 1000000).');
    const axes=[x,y,{index:nose.index,sign:-nose.sign}];
    const inversions=axes.reduce((n,a,i)=>n+axes.slice(i+1).filter(b=>a.index>b.index).length,0);
    return {axes,scale:unit*factor,mirror:(inversions%2?-1:1)*axes.reduce((n,a)=>n*a.sign,1)<0};
  }
  function transform(vertices,options) {
    const {axes,scale,mirror}=mapping(options),out=new Float32Array(vertices.length);
    for(let t=0;t<vertices.length;t+=9)for(let v=0;v<3;v++)for(let a=0;a<3;a++) {
      const source=mirror&&v>0?3-v:v;
      out[t+v*3+a]=vertices[t+source*3+axes[a].index]*axes[a].sign*scale;
    }
    bounds(out);return out;
  }
  function roleFor(path) {
    if(/vertical|fin|rudder/i.test(path))return 'vertical';
    if(/horizontal|elevator|stabilizer|stabiliser|\/tail\//i.test(path))return 'horizontal';
    if(/wing/i.test(path))return 'wing';
    if(/fuselage|body|hull/i.test(path))return 'body';
    return 'other';
  }
  function combineBounds(meshes) {
    if(!meshes.length)return null;
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const mesh of meshes)for(let a=0;a<3;a++){min[a]=Math.min(min[a],mesh.bounds.min[a]);max[a]=Math.max(max[a],mesh.bounds.max[a]);}
    return {min,max,size:max.map((v,i)=>v-min[i])};
  }
  // Triangle-plane intersections, not a projection of every vertex. Internal
  // walls remain in raw segments for inspection; envelope fitting is separate.
  function slice(meshes,normal,position,tolerance=1e-8) {
    const axes=[0,1,2].filter(a=>a!==normal),segments=[];
    for(const mesh of meshes) {
      if(position<mesh.bounds.min[normal]-tolerance||position>mesh.bounds.max[normal]+tolerance)continue;
      const v=mesh.vertices;
      for(let i=0;i<v.length;i+=9) {
        const d=[0,1,2].map(j=>v[i+j*3+normal]-position);
        if(d.every(x=>x>tolerance)||d.every(x=>x<-tolerance)||d.every(x=>Math.abs(x)<=tolerance))continue;
        const hits=[];
        for(let j=0;j<3;j++) {
          const k=(j+1)%3;
          if(Math.abs(d[j])<=tolerance)hits.push(axes.map(a=>v[i+j*3+a]));
          if((d[j]<-tolerance&&d[k]>tolerance)||(d[k]<-tolerance&&d[j]>tolerance)) {
            const f=d[j]/(d[j]-d[k]);hits.push(axes.map(a=>v[i+j*3+a]+f*(v[i+k*3+a]-v[i+j*3+a])));
          }
        }
        const distinct=hits.filter((p,j)=>!hits.slice(0,j).some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<=tolerance));
        if(distinct.length===2 && Math.hypot(distinct[0][0]-distinct[1][0],distinct[0][1]-distinct[1][1])>tolerance)segments.push(distinct);
      }
    }
    return segments;
  }
  // Radial outer approximation for a single, roughly star-shaped fuselage.
  // This is intentionally NOT presented as a general Boolean solid union.
  function envelope(segments,count=36) {
    if(!segments.length)return {center:null,ring:[],missing:count};
    const min=[Infinity,Infinity],max=[-Infinity,-Infinity];
    for(const segment of segments)for(const p of segment)for(let a=0;a<2;a++){min[a]=Math.min(min[a],p[a]);max[a]=Math.max(max[a],p[a]);}
    const center=[(min[0]+max[0])/2,(min[1]+max[1])/2];
    const ring=[];let missing=0;
    for(let i=0;i<count;i++) {
      const angle=2*Math.PI*i/count,dx=Math.cos(angle),dy=Math.sin(angle);let far=-Infinity;
      for(const [p,q] of segments) {
        const ex=q[0]-p[0],ey=q[1]-p[1],det=dx*ey-dy*ex;
        if(Math.abs(det)<1e-15)continue;
        const px=p[0]-center[0],py=p[1]-center[1],r=(px*ey-py*ex)/det,s=(px*dy-py*dx)/det;
        if(r>=-1e-10&&s>=-1e-8&&s<=1+1e-8)far=Math.max(far,r);
      }
      if(Number.isFinite(far))ring.push([center[0]+far*dx,center[1]+far*dy]);else{ring.push(null);missing++;}
    }
    return {center,ring,missing};
  }
  function hermite(p0,p1,m0,m1,t) {
    const t2=t*t,t3=t2*t;
    return p0.map((v,a)=>(2*t3-3*t2+1)*v+(t3-2*t2+t)*m0[a]+(-2*t3+3*t2)*p1[a]+(t3-t2)*m1[a]);
  }
  // Estimate tangent directions from the measured edge on each side. Leave
  // ends and gaps beyond the explicit limits unresolved, rather than guessing.
  function fillRingTangents(source,maxDegrees=90) {
    const ring=source.map(p=>p?.slice()||null),n=ring.length,filled=[];
    for(let start=0;start<n;start++) {
      if(!source[start]||source[(start+1)%n])continue;
      let gap=1;while(gap<n&&!source[(start+gap)%n])gap++;
      if(gap>=n||(gap*360/n)>maxDegrees+1e-8)continue;
      const before=source[(start-1+n)%n],p0=source[start],p1=source[(start+gap)%n],after=source[(start+gap+1)%n];
      if(!before||!after)continue;
      const m0=p0.map((v,a)=>(v-before[a])*gap),m1=p1.map((v,a)=>(after[a]-v)*gap);
      for(let j=1;j<gap;j++){const i=(start+j)%n;ring[i]=hermite(p0,p1,m0,m1,j/gap);filled.push(i);}
    }
    return {ring,filled};
  }
  function repairSections(sections,options) {
    const degrees=Number(options.maxGapDegrees??90),length=Number(options.maxGapLengthM??.05);
    if(!Number.isFinite(degrees)||degrees<0||degrees>180||!Number.isFinite(length)||length<0)throw Error('Проверьте пределы восстановления вырезов.');
    for(const s of sections){s.rawRing=s.ring.map(p=>p?.slice()||null);s.interpolatedPoints=[];}
    if(options.repairGaps) {
      for(const s of sections){const r=fillRingTangents(s.rawRing,degrees);s.ring=r.ring;s.interpolatedPoints=r.filled.map(point=>({point,method:'circumferential-tangent'}));}
      // Fully missing stations require two measured neighbours on each side.
      for(let start=0;start<sections.length-1;start++) {
        if(!sections[start].segments.length||sections[start+1].segments.length)continue;
        let end=start+1;while(end<sections.length&&!sections[end].segments.length)end++;
        const before=sections[start-1],a=sections[start],b=sections[end],after=sections[end+1];
        if(!before||!b||!after||b.z-a.z>length||!before.segments.length||!after.segments.length)continue;
        const dz=b.z-a.z;
        for(let i=start+1;i<end;i++)for(let j=0;j<a.ring.length;j++) {
          const p0=a.rawRing[j],p1=b.rawRing[j],pBefore=before.rawRing[j],pAfter=after.rawRing[j];
          if(!p0||!p1||!pBefore||!pAfter)continue;
          const m0=p0.map((v,k)=>(v-pBefore[k])*dz/(a.z-before.z)),m1=p1.map((v,k)=>(pAfter[k]-v)*dz/(after.z-b.z));
          sections[i].ring[j]=hermite(p0,p1,m0,m1,(sections[i].z-a.z)/dz);
          sections[i].interpolatedPoints.push({point:j,method:'longitudinal-tangent'});
        }
      }
    }
    for(const s of sections)s.remainingMissing=s.ring.filter(p=>!p).length;
    return sections;
  }
  function stationPositions(min,max,count,mode='uniform',zone={}) {
    if(!Number.isInteger(count)||count<2||count>100||!Number.isFinite(min)||!Number.isFinite(max)||max<=min)throw Error('Проверьте число и диапазон сечений.');
    let lo=0,hi=1,density=1;
    if(mode==='zone'){lo=(Number(zone.from)-min)/(max-min);hi=(Number(zone.to)-min)/(max-min);density=Number(zone.density??5);if(!Number.isFinite(lo)||!Number.isFinite(hi)||lo<0||hi>1||lo>=hi||!Number.isFinite(density)||density<1||density>100)throw Error('Зона сгущения должна находиться внутри детали, плотность — 1–100.');}
    return Array.from({length:count},(_,i)=>{
      const t=i/(count-1);let f=t;
      if(mode==='start')f=t*t;
      else if(mode==='end')f=1-(1-t)*(1-t);
      else if(mode==='both')f=(1-Math.cos(Math.PI*t))/2;
      else if(mode==='zone'){const q=t*(lo+(hi-lo)*density+1-hi);f=q<=lo?q:q<=lo+(hi-lo)*density?lo+(q-lo)/density:hi+q-lo-(hi-lo)*density;}
      else if(mode!=='uniform')throw Error('Неизвестное распределение сечений.');
      return min+(max-min)*f;
    });
  }
  function checkedPositions(values,min,max,minimum=2) {
    if(!Array.isArray(values)||values.length<minimum||values.length>100)throw Error('Некорректное количество позиций сечений.');
    const result=values.map(Number).sort((a,b)=>a-b),epsilon=Math.max(1e-9,(max-min)*1e-7);
    for(let i=0;i<result.length;i++){const v=result[i];if(!Number.isFinite(v)||v<min-epsilon||v>max+epsilon)throw Error('Сечение находится вне границ STL.');if(i&&v-result[i-1]<=epsilon)throw Error('Позиции сечений совпадают или слишком близки.');}
    return result.map(v=>Math.max(min,Math.min(max,v)));
  }
  function analyze(meshes,options={}) {
    const count=Math.round(Number(options.stations||20)),radii=Math.round(Number(options.radii||36));
    if(count<3||count>100||radii<8||radii>180)throw Error('Сечения: 3–100; точки обвода: 8–180.');
    const bodyGroups=[...new Set(meshes.filter(m=>m.role==='body'||m.role==='other').map(m=>m.group))];
    const bodies=[];
    for(const group of bodyGroups) {
      const parts=meshes.filter(m=>m.group===group&&(m.role==='body'||m.role==='other')),b=combineBounds(parts),sections=[];
      if(!b||b.size[2]<=0)continue;
      const positions=options.bodyPositions?.[group]?checkedPositions(options.bodyPositions[group],b.min[2],b.max[2],3):null;
      for(let i=0;i<(positions?.length||count);i++) {
        // Avoid a coplanar cut exactly on an end cap.
        const f=Math.max(.00001,Math.min(.99999,i/(count-1))),z=positions?positions[i]:b.min[2]+b.size[2]*f;
        const sliceAt=Math.max(b.min[2]+b.size[2]*.00001,Math.min(b.max[2]-b.size[2]*.00001,z));
        const segments=slice(parts,2,sliceAt),fitted=envelope(segments,radii);
        sections.push({z,sliceAt,segments,...fitted});
      }
      repairSections(sections,options);
      bodies.push({group,bounds:b,sections});
    }
    const surfaces=[];
    for(const role of ['wing','horizontal','vertical']) {
      const parts=meshes.filter(m=>m.role===role),b=combineBounds(parts);if(!b)continue;
      const normal=role==='vertical'?1:0,samples=[];
      const positions=options.surfacePositions?.[role]?checkedPositions(options.surfacePositions[role],b.min[normal],b.max[normal]):null;
      for(let i=0;i<(positions?.length||15);i++) {
        const at=positions?positions[i]:b.min[normal]+b.size[normal]*(.001+.998*i/14),sliceAt=Math.max(b.min[normal]+b.size[normal]*.00001,Math.min(b.max[normal]-b.size[normal]*.00001,at)),segments=slice(parts,normal,sliceAt);
        const points=segments.flatMap(s=>s);if(!points.length){samples.push({at,missing:true});continue;}
        // In both X and Y cuts Z is the second projected component.
        let leading=Infinity,trailing=-Infinity,low=Infinity,high=-Infinity;
        for(const p of points){leading=Math.min(leading,p[1]);trailing=Math.max(trailing,p[1]);low=Math.min(low,p[0]);high=Math.max(high,p[0]);}
        samples.push({at,sliceAt,leading,trailing,chord:trailing-leading,quarterChord:leading+(trailing-leading)*.25,
          transverseCenter:(low+high)/2,segments});
      }
      surfaces.push({role,bounds:b,normal,samples});
    }
    return {bodies,surfaces,bounds:combineBounds(meshes)};
  }
  function resampleTarget(meshes,options,target,positions) {
    const body=target.kind==='body',parts=meshes.filter(m=>body?(m.group===target.key&&(m.role==='body'||m.role==='other')):m.role===target.key);
    if(!parts.length)throw Error('Деталь не найдена для повторного среза.');
    const o={...options,bodyPositions:body?{[target.key]:positions}:{},surfacePositions:body?{}:{[target.key]:positions}},result=analyze(parts,o);
    const data=body?result.bodies[0]:result.surfaces[0];
    if(!body&&data.samples.some(s=>s.missing||s.chord<=0))throw Error('На одной из позиций нет полноценного среза поверхности. Сдвиньте его внутрь STL.');
    return data;
  }
  function preview(vertices,limit=2000) {
    const triangles=vertices.length/9,stride=Math.max(1,Math.ceil(triangles/limit)),sample=[];
    for(let t=0;t<triangles;t+=stride)for(let j=0;j<9;j++)sample.push(vertices[t*9+j]);
    return new Float32Array(sample);
  }
  function obj8(vertices) {
    const n=vertices.length/3,lines=['I','800','OBJ','','# Static STL geometry; no controls, animation or aerodynamic model.','POINT_COUNTS '+n+' 0 0 '+n];
    const fmt=x=>Number(x.toPrecision(8)).toString();
    for(let i=0;i<vertices.length;i+=9) {
      const a=[0,1,2].map(k=>vertices[i+3+k]-vertices[i+k]),b=[0,1,2].map(k=>vertices[i+6+k]-vertices[i+k]);
      let norm=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],length=Math.hypot(...norm);
      norm=norm.map(x=>length?x/length:0);
      for(let j=0;j<3;j++)lines.push('VT '+[...vertices.subarray(i+j*3,i+j*3+3),...norm,0,0].map(fmt).join(' '));
    }
    for(let i=0;i<n;i+=10){const count=Math.min(10,n-i);if(count===10)lines.push('IDX10 '+Array.from({length:10},(_,j)=>i+j).join(' '));else for(let j=0;j<count;j++)lines.push('IDX '+(i+j));}
    lines.push('ATTR_no_cull','TRIS 0 '+n,'');return lines.join('\n');
  }
  function report(meshes,analysis,options) {
    // Raw cut segments are included so an approximation is never mistaken for
    // an exact union; they also allow independent visual verification.
    return {schema:'stl-import-geometry-1',units:'metres',coordinates:'X right / Y up / Z aft; shared CAD origin retained',options,
      files:meshes.map(({path,group,role,format,triangles,bounds})=>({path,group,role,format,triangles,bounds})),...analysis,
      limitations:['Geometric analysis only. Any experimental ACF export is described separately; flight setup is not inferred.',
        'Body rings are radial approximations, not a general Boolean union. Tangent repairs are inferred geometry and explicitly marked. Internal contours and disconnected sections require review.',
        'Wing chords are projected envelopes; incidence, twist, aerodynamic profiles and control surfaces are not inferred.',
        'No mass, inertia, engine, landing gear or flight dynamics have been configured.'],planeMakerValidated:false,flightValidated:false};
  }
  return {parseSTL,bounds,axis,mapping,transform,roleFor,combineBounds,slice,envelope,hermite,fillRingTangents,repairSections,stationPositions,checkedPositions,analyze,resampleTarget,preview,obj8,report};
}
if(typeof module!=='undefined'&&module.exports)module.exports=STLImporterCore();
else globalThis.STLCore=STLImporterCore();
