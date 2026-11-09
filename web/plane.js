/* Editable geometric approximation and experimental ACF 1200 studio exporter.
 * A fresh Plane Maker template provides the aircraft defaults. No flight setup
 * is borrowed from another aircraft; controls, mass and engine remain unconfigured.
 */
(function(root){
  'use strict';
  const FT=1/.3048,rad=d=>d*Math.PI/180,deg=r=>r*180/Math.PI;
  const lerp=(a,b,t)=>a+(b-a)*t;
  function finite(n,label){if(!Number.isFinite(n))throw Error('Некорректное число: '+label);return n;}
  function pointBounds(points){const min=[Infinity,Infinity],max=[-Infinity,-Infinity];for(const p of points.filter(Boolean))for(let a=0;a<2;a++){min[a]=Math.min(min[a],p[a]);max[a]=Math.max(max[a],p[a]);}return {min,max};}
  function buildDraft(analysis){
    const bodies=analysis.bodies.map(body=>{
      // Two of Plane Maker's 20 stations are reserved for flat end closures.
      const count=Math.min(18,body.sections.length);
      const sections=Array.from({length:count},(_,i)=>{
        const sourceIndex=Math.round(i*(body.sections.length-1)/(count-1)),s=body.sections[sourceIndex],b=pointBounds(s.ring);
        const valid=s.ring.some(Boolean),cx=valid?(b.min[0]+b.max[0])/2:0,cy=valid?(b.min[1]+b.max[1])/2:0,width=valid?b.max[0]-b.min[0]:0,height=valid?b.max[1]-b.min[1]:0;
        return {sourceIndex,z:s.z,cx,cy,width,height,cap:i===0||i===count-1,
          shape:s.ring.map(p=>p?[(p[0]-cx)/(width||1),(p[1]-cy)/(height||1)]:null),repaired:s.interpolatedPoints.length};
      });
      return {group:body.group,sections};
    });
    const surfaces=analysis.surfaces.map(surface=>{
      let samples=surface.samples.filter(s=>!s.missing&&(surface.role==='vertical'||s.at>=-1e-7));
      const nodes=samples.map(s=>({enabled:false,at:Math.abs(s.at)<1e-7?0:s.at,chord:s.chord,z:s.quarterChord,height:s.transverseCenter,incidence:0,source:'measured'}));
      // A root cut through a saddle may be shorter than the actual wing. Offer
      // a marked extrapolation from the next two sections, editable by the user.
      if(surface.role!=='vertical'&&nodes.length>=3&&nodes[0].at===0){
        const a=nodes[1],b=nodes[2],t=-a.at/(b.at-a.at),estimate=lerp(a.chord,b.chord,t);
        if(nodes[0].chord<.85*estimate){for(const key of ['chord','z','height'])nodes[0][key]=lerp(a[key],b[key],t);nodes[0].source='root-extrapolation';}
      }
      const result={role:surface.role,normal:surface.normal,nodes,nativePanels:surface.role==='wing'?4:surface.role==='horizontal'?1:2,separateTip:false,customChords:true};
      chooseBoundaries(result,result.nativePanels+1);return result;
    });
    return {bodies,surfaces,closeCaps:true};
  }
  function bodyRing(section){
    if(section.closingPoint)return section.shape.map(()=>[section.cx,section.cy]);
    return section.shape.map(p=>p?[section.cx+p[0]*section.width,section.cy+p[1]*section.height]:null);
  }
  function bodyStations(body,closeCaps=true){
    if(!closeCaps||!body.sections.length)return body.sections;
    // A separate zero-radius station closes each end in the SAME Z plane.
    // Keep the measured end rings intact and ordered between the two points.
    const point=s=>({...s,width:0,height:0,closingPoint:true});
    return [point(body.sections[0]),...body.sections,point(body.sections[body.sections.length-1])];
  }
  function selected(surface){return surface.nodes.filter(n=>n.enabled);}
  function chooseBoundaries(surface,count){
    const nodes=surface.nodes;for(const n of nodes)n.enabled=false;if(!nodes.length)return;
    nodes[0].enabled=nodes[nodes.length-1].enabled=true;
    while(selected(surface).length<Math.min(count,nodes.length)){
      let best=-1,score=-Infinity;const indices=nodes.map((n,i)=>n.enabled?i:-1).filter(i=>i>=0);
      for(let s=0;s<indices.length-1;s++){const left=indices[s],right=indices[s+1],a=nodes[left],b=nodes[right];
        for(let i=left+1;i<right;i++){const n=nodes[i],t=(n.at-a.at)/(b.at-a.at),error=(n.chord-lerp(a.chord,b.chord,t))**2+(n.z-lerp(a.z,b.z,t))**2+(n.height-lerp(a.height,b.height,t))**2,
            value=error+Math.min(n.at-a.at,b.at-n.at)*1e-14;if(value>score){score=value;best=i;}}
      }
      if(best<0)break;nodes[best].enabled=true;
    }
    return surface;
  }
  function nodeAt(surface,at){const ns=surface.nodes;let j=1;while(j<ns.length-1&&ns[j].at<at)j++;const a=ns[j-1],b=ns[j],t=(at-a.at)/(b.at-a.at);return {at,...Object.fromEntries(['chord','z','height','incidence'].map(k=>[k,lerp(a[k],b[k],t)]))};}
  function ribAt(surface,a,b,t){
    const at=lerp(a.at,b.at,t),n=surface.customChords?nodeAt(surface,at):{at,chord:lerp(a.chord,b.chord,t),z:lerp(a.z,b.z,t),incidence:lerp(a.incidence,b.incidence,t)};
    return {...n,height:lerp(a.height,b.height,t)};
  }
  function nativeCount(surface){const maximum=surface.role==='wing'?4:surface.role==='horizontal'?1:2,panels=selected(surface).length-1,budget=surface.nativePanels??maximum;if(!Number.isInteger(budget)||budget<1||budget>maximum)throw Error('Недопустимое число штатных секций: '+surface.role);return Math.max(0,Math.min(budget,panels-(surface.separateTip?1:0)));}
  function validateDraft(draft){
    if(draft.bodies.length>39)throw Error('ACF: не более 39 корпусов.');
    for(const body of draft.bodies){let last=-Infinity;
      if(body.sections.length<3||bodyStations(body,draft.closeCaps).length>20)throw Error('ACF: максимум 18 сечений корпуса с двумя точками торцов (20 без закрытия).');
      for(const s of body.sections){for(const key of ['z','cx','cy','width','height'])finite(s[key],key);
        if(s.z<=last)throw Error('Станции корпуса должны идти от носа к хвосту без совпадений.');last=s.z;
        if(s.width<0||s.height<0)throw Error('Ширина и высота корпуса не могут быть отрицательными.');
        if(s.shape.some(p=>!p))throw Error('Остался неполный обвод корпуса '+body.group+'. Настройте восстановление или положение среза: закрытие торцов не заменяет шпангоуты.');
      }
    }
    for(const surface of draft.surfaces){const nodes=selected(surface);if(nodes.length<2)throw Error('Выберите минимум два сечения: '+surface.role);
      if(nodes.length-1>(surface.nativePanels??(surface.role==='wing'?4:surface.role==='horizontal'?1:2))&&!surface.separateTip)throw Error('Превышен лимит штатных секций: '+surface.role+'. Снимите лишние границы или включите «Законцовки отдельно».');
      if(surface.customChords){let last=-Infinity;for(const n of surface.nodes){for(const key of ['at','chord','z','height','incidence'])finite(n[key],key);if(n.at<=last||n.chord<=0||Math.abs(n.incidence)>45)throw Error('Проверьте все узлы customize chords: порядок, хорды и углы.');last=n.at;}}
      if(nodes.length>21)throw Error('Поверхность: максимум 21 узел.');
      let last=-Infinity;for(const n of nodes){for(const key of ['at','chord','z','height','incidence'])finite(n[key],key);
        if(n.at<=last)throw Error('Узлы поверхности должны идти от корня к законцовке.');last=n.at;
        if(n.chord<=0)throw Error('Хорда должна быть положительной.');if(Math.abs(n.incidence)>45)throw Error('Проверьте угол установки (±45°).');
      }
    }
    const miscNeeded=draft.surfaces.reduce((n,s)=>n+(s.role==='vertical'?1:2)*Math.max(0,selected(s).length-1-nativeCount(s)),0);
    if(miscNeeded>36)throw Error('Выбрано слишком много секций: в ACF доступно 36 Misc Wings.');
    return true;
  }
  function nodePoint(surface,n,side=1){return surface.role==='vertical'?[n.height,n.at,n.z]:[n.at*side,n.height,n.z];}
  function planform(draft){
    const lines=[];
    for(const s of draft.surfaces){const ns=selected(s);for(const side of s.role==='vertical'?[1]:[-1,1]){
      const edge=n=>{const p=nodePoint(s,n,side),a=p.slice(),b=p.slice();a[2]-=n.chord*.25;b[2]+=n.chord*.75;return [a,b];};
      for(let i=0;i<ns.length-1;i++){let previous=null;for(let r=0;r<=10;r++){const [a,b]=edge(ribAt(s,ns[i],ns[i+1],r/10));if(r===0||r===10)lines.push([a,b]);if(previous)lines.push([previous[0],a],[previous[1],b]);previous=[a,b];}}
    }}return lines;
  }
  function parseAFL(text,name){
    const lines=text.replace(/^\uFEFF/,'').split(/\r\n|\r|\n/).map(s=>s.trim()).filter(Boolean);
    if(!['I','A'].includes(lines[0])||lines[1]!=='1110 Version'||!lines[2].startsWith('1234'))throw Error('AFL '+name+': поддерживается штатный формат 1110 Version.');
    const thickness=Number(lines[3]);if(!Number.isFinite(thickness)||thickness<=0||thickness>1)throw Error('Некорректная толщина AFL: '+name);
    const outline=lines.slice(5,19).map(line=>line.split(/\s+/).map(Number));
    if(outline.length!==14||outline.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v))))throw Error('Некорректный контур AFL: '+name);
    return {name,thickness,outline};
  }
  function parseACF(text){
    const header=text.replace(/^\uFEFF/,'').split(/\r\n|\r|\n/).map(s=>s.trim()).filter(Boolean).slice(0,3);
    if(!['A','I'].includes(header[0])||header[1]!=='1200 Version'||header[2]!=='ACF')throw Error('Нужен текстовый шаблон ACF 1200 Version.');
    const entries=new Map();for(const line of text.split(/\r\n|\r|\n/)){const m=/^P\s+(\S+)\s+(.*)$/.exec(line);if(m){if(entries.has(m[1]))throw Error('Повторное поле ACF: '+m[1]);entries.set(m[1],m[2]);}}
    if(!text.includes('PROPERTIES_END'))throw Error('В шаблоне отсутствует PROPERTIES_END.');
    return entries;
  }
  function validateTemplate(text){const entries=parseACF(text);
    if(Number(entries.get('acf/_num_engn')||0)!==0||Number(entries.get('acf/_m_empty')||0)!==0||[...entries.keys()].some(k=>/^_wing\/\d+\//.test(k)||/^_body\/[1-9]\d*\//.test(k)))
      throw Error('Нужен чистый шаблон File → New, без крыльев, дополнительных корпусов, двигателя и массы.');
    if(!entries.has('_body/0/_geo_xyz/i_count'))throw Error('В шаблоне нет штатного блока фюзеляжа.');return entries;
  }
  function interpolateRing(ring,angle){const n=ring.length,f=((angle/(2*Math.PI)%1+1)%1)*n,i=Math.floor(f)%n,t=f-Math.floor(f),a=ring[i],b=ring[(i+1)%n];if(!a||!b)throw Error('Неполный контур корпуса.');return a.map((v,k)=>lerp(v,b[k],t));}
  function buildACF(template,draft,profiles,airfoils,name,flight=null){
    const original=validateTemplate(template);validateDraft(draft);const values=new Map(),segments=[];
    const put=(k,v)=>{if(typeof v==='number'){finite(v,k);v=Number(v.toPrecision(11)).toString();}if(/[\r\n\0]/.test(String(v)))throw Error('Недопустимое значение ACF.');values.set(k,String(v));};
    const ft=(k,v)=>put(k,v*FT);
    for(const [index,body]of draft.bodies.entries()){
      const stations=bodyStations(body,draft.closeCaps);
      const prefix='_body/'+index+'/',seed=[...original].filter(([k])=>k.startsWith('_body/0/')&&!k.includes('/_geo_xyz/')&&!k.includes('/_locked/'));
      for(const [key,v]of seed)put(prefix+key.slice('_body/0/'.length),v);
      put(prefix+'_s_dim',stations.length);put(prefix+'_r_dim',18);put(prefix+'_part_specs_eq',1);put(prefix+'_part_specs_invis',0);
      for(const key of ['_part_x','_part_y','_part_z','_part_phi','_part_the','_part_psi'])put(prefix+key,0);
      let radius=0;
      for(let i=0;i<20;i++)for(let j=0;j<18;j++){
        const section=stations[i];let p=[0,0,0];
        if(section){const angle=j<=8?Math.PI/2-j*Math.PI/8:-Math.PI/2-(j-9)*Math.PI/8;
          const xy=interpolateRing(bodyRing(section,draft.closeCaps),angle);p=[xy[0],xy[1],section.z];radius=Math.max(radius,Math.hypot(...xy));}
        for(let a=0;a<3;a++)ft(prefix+`_geo_xyz/${i},${j},${a}`,p[a]);put(prefix+`_locked/${i},${j}`,0);
      }
      put(prefix+'_geo_xyz/i_count',20);put(prefix+'_geo_xyz/j_count',18);put(prefix+'_geo_xyz/k_count',3);put(prefix+'_locked/i_count',20);put(prefix+'_locked/j_count',18);ft(prefix+'_part_rad',Math.max(radius,.001));
    }
    let misc=12,totalArea=0,weightedMAC=0,nativeArea=0,nativeWeightedMAC=0;
    const getFoil=n=>{const foil=airfoils.get(n);if(!foil)throw Error('Выберите папку Airfoils: отсутствует '+n);return foil;};
    for(const surface of draft.surfaces){const nodes=selected(surface),role=surface.role;
      const firstName=role==='wing'?profiles.wingRoot:role==='horizontal'?profiles.horizontalFoil:profiles.verticalFoil;
      const lastName=role==='wing'?(profiles.wingTip||firstName):firstName;
      if(!firstName||!lastName)throw Error('Не выбран профиль: '+role);
      if(firstName!==lastName)throw Error('В этой версии используйте одинаковый профиль в корне и на конце крыла.');
      if(/[\\/]/.test(firstName+lastName)||!firstName.toLowerCase().endsWith('.afl')||!lastName.toLowerCase().endsWith('.afl'))throw Error('Выберите имя AFL без пути.');
      const f0=getFoil(firstName),f1=getFoil(lastName);
      for(let segment=0;segment<nodes.length-1;segment++){
        const a=nodes[segment],b=nodes[segment+1],ribs=Array.from({length:11},(_,i)=>ribAt(surface,a,b,i/10));let slots;
        if(role==='wing'&&segment<nativeCount(surface))slots=[segment*2,segment*2+1];
        else if(role==='horizontal'&&segment<nativeCount(surface))slots=[8,9];
        else if(role==='vertical'&&segment<nativeCount(surface))slots=[10+segment];
        else {slots=role==='vertical'?[misc++]:[misc++,misc++];}
        if(slots.some(s=>s>=48))throw Error('Недостаточно секций Misc Wings.');
        for(const [sideIndex,index]of slots.entries()){
          const side=role==='vertical'?1:sideIndex===0?-1:1,prefix='_wing/'+index+'/',start=nodePoint(surface,a,side),end=nodePoint(surface,b,side);
          const dx=role==='vertical'?b.height-a.height:b.at-a.at,dy=role==='vertical'?b.at-a.at:b.height-a.height,dz=b.z-a.z,
            dihedral=Math.atan2(dy,dx),sweep=Math.atan2(dz,Math.hypot(dx,dy));
          for(const [key,v]of Object.entries({_Croot:a.chord*FT,_Ctip:b.chord*FT,_semilen_SEG:Math.hypot(dx,dy,dz)*FT,
            _part_x:start[0]*FT,_part_y:start[1]*FT,_part_z:start[2]*FT,_part_phi:0,_part_the:0,_part_psi:0,
            _dihed_design:deg(dihedral),_sweep_design:deg(sweep),_is_right_mult:side,_els:10,_s_dim:20,_r_dim:14,
            _engn_for_body:-2,_gear_for_body:-2,_part_specs_eq:1,_part_specs_invis:0,_part_specs_rmod:1,_part_tex:0,
            _foil_rat_rot:0,_foil_rat_mid_inner:0,_foil_rat_mid_outer:0,_foil_rat_tip:1,_var_sweep:0,_var_dihed:0,_var_incid:0,_var_retract:0,
            _incid_chrd_inc:0,_incid_full_up:0,_dihed_full_up:0,_sweep_full_aft:0,_sweep_rotation_span_os:0,_plan_ellipse_frac:0,_retract_max:0}))put(prefix+key,v);
          put(prefix+'_afl_file_1',firstName);put(prefix+'_afl_file_2',firstName);put(prefix+'_afl_file_3',lastName);
          for(const control of ['ailn1','ailn2','elev1','elev2','rudd1','rudd2','flap1','flap2','slat1','slat2','spoi1','spoi2','yawbr','inc_ailn1','inc_ailn2','inc_elev1','inc_elev2','inc_rudd1','inc_rudd2']){put(prefix+'_'+control+'/count',10);for(let i=0;i<10;i++)put(prefix+'_'+control+'/'+i,0);}
          for(const array of ['c_rat_for_RIB','c_off_for_RIB','chord_for_RIB'])put(prefix+'_'+array+'/count',11);
          put(prefix+'_incidence/count',10);
          // Native ACF applies the offset after chord scaling: quarter-chord Z
          // = linear Z + c_off_for_RIB * actual chord, not the base chord.
          // Confirmed against Aerolite 103 and A330 native cached geometry.
          // Dividing by baseChord here displaces tapered/customized tail ribs.
          for(let i=0;i<11;i++){const baseChord=lerp(a.chord,b.chord,i/10);put(prefix+'_c_rat_for_RIB/'+i,ribs[i].chord/baseChord);put(prefix+'_c_off_for_RIB/'+i,(ribs[i].z-lerp(a.z,b.z,i/10))/ribs[i].chord);ft(prefix+'_chord_for_RIB/'+i,ribs[i].chord);if(i<10)put(prefix+'_incidence/'+i,ribAt(surface,a,b,(i+.5)/10).incidence);}
          for(let i=0;i<20;i++){
            const t=Math.ceil(i/2)/10,rib=ribs[Math.ceil(i/2)],chord=rib.chord,theta=rad(rib.incidence),q=start.map((v,k)=>lerp(v,end[k],t)),global=(lerp(a.at,b.at,t)-nodes[0].at)/(nodes.at(-1).at-nodes[0].at);q[2]=rib.z;
            for(let j=0;j<18;j++){let p=[0,0,0];if(j<14){const zrel=lerp(f0.outline[j][0],f1.outline[j][0],global),height=lerp(f0.outline[j][1]*f0.thickness,f1.outline[j][1]*f1.thickness,global)*chord,
                z=zrel*chord*Math.cos(theta)+height*Math.sin(theta),normal=height*Math.cos(theta)-zrel*chord*Math.sin(theta);
              p=[q[0]-Math.sin(dihedral)*normal*side,q[1]+Math.cos(dihedral)*normal,q[2]+z];}
              for(let k=0;k<3;k++)ft(prefix+`_geo_xyz/${i},${j},${k}`,p[k]);
            }
          }
          put(prefix+'_geo_xyz/i_count',20);put(prefix+'_geo_xyz/j_count',18);put(prefix+'_geo_xyz/k_count',3);
          segments.push({role,index,side,isMisc:index>=12,customChords:Boolean(surface.customChords),ribs,root:start,tip:end,rootChord:a.chord,tipChord:b.chord,sweep:deg(sweep),dihedral:deg(dihedral)});
        }
        if(role==='wing')for(let i=0;i<10;i++){const a=ribs[i],b=ribs[i+1],area=(b.at-a.at)*(a.chord+b.chord),mac=2/3*(a.chord*a.chord+a.chord*b.chord+b.chord*b.chord)/(a.chord+b.chord);totalArea+=area;weightedMAC+=area*mac;if(segment<nativeCount(surface)){nativeArea+=area;nativeWeightedMAC+=area*mac;}}
      }
    }
    if(nativeArea)ft('acf/_average_mac_acf',nativeWeightedMAC/nativeArea);
    let flightReport=null;
    if(flight){
      const F=typeof module!=='undefined'&&module.exports?require('./flight.js'):root.FlightSetup;
      const result=F.build(flight,draft,{selected,ribAt},airfoils);flightReport=result.report;
      for(const [k,v]of result.values)put(k,v);
    }
    // No aeroelastic calibration is supplied by STL. Export a rigid wing;
    // preserve the template's wing mass/fuel fractions and damping separately.
    put('acf/_wing_mid_dihed_per_g',0);
    put('acf/_name',name);put('_wing/count',48);put('_body/count',39);
    // Replace generated geometry only; preserve every unrelated template row.
    const eol=template.includes('\r\n')?'\r\n':'\n',output=[];
    for(const line of template.split(/\r\n|\r|\n/)){
      const m=/^P\s+(\S+)\s+/.exec(line);
      if(m&&(/^_body\/\d+\//.test(m[1])||/^_wing\/\d+\//.test(m[1])))continue;
      if(m&&values.has(m[1])){output.push('P '+m[1]+' '+values.get(m[1]));values.delete(m[1]);}
      else if(line.trim()==='PROPERTIES_END'){for(const [key,v]of values)output.push('P '+key+' '+v);values.clear();output.push(line);}
      else output.push(line);
    }
    const text=output.join(eol);parseACF(text);
    return {text,segments,flightSetup:flightReport,bodyCount:draft.bodies.length,mainWingAreaM2:totalArea,mainWingMACM:totalArea?weightedMAC/totalArea:null,nativeMainWingMACM:nativeArea?nativeWeightedMAC/nativeArea:null,
      requiredAirfoils:[...new Set([...draft.surfaces.flatMap(s=>s.role==='wing'?[profiles.wingRoot,profiles.wingTip||profiles.wingRoot]:[s.role==='horizontal'?profiles.horizontalFoil:profiles.verticalFoil]),...(flight?[flight.propFoil]:[])])],
      limitations:['Experimental ACF geometry. Open and save in Plane Maker before use.','Body end closures add two point stations at the end-ring centres in the same Z planes; measured rings are preserved. Paired wings and horizontal tails are mirrored from the right side.',
      flight?'Mass, CG and a preliminary electric powerplant are entered. '+(flightReport.groundGear?'Hidden ground supports are generated; contact dynamics still need validation. ':'Landing gear still needs setup. ')+'Inertia and control assignments still need setup.':'Mass, inertia, engine, landing gear, control assignments and flight setup are still template defaults.','Chosen AFL affects the calculated surface; it was not identified from the STL.'],planeMakerValidated:false,flightValidated:false};
  }
  const api={buildDraft,bodyRing,bodyStations,selected,chooseBoundaries,nodeAt,ribAt,nativeCount,validateDraft,nodePoint,planform,parseAFL,parseACF,validateTemplate,buildACF};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PlaneImport=api;
})(globalThis);
