/* Physical inputs for the experimental ACF exporter. SI inside this module;
 * native ACF uses feet, pounds and mechanical horsepower. No donor aircraft.
 * One electric motor, one fixed-pitch propeller, direct drive by default.
 */
(function(root){
  'use strict';
  const FT=1/.3048,LB=1/.45359237,HP_W=745.69987158227;
  function check(n,min,max,label){if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw Error('Проверьте '+label);return n;}
  function propPreview(s){
    check(s.diameterM,.001,100,'диаметр винта');if(s.positionM?.length!==3)throw Error('Нужны координаты винта.');s.positionM.forEach(v=>check(v,-1e4,1e4,'положение винта'));
    const center=s.positionM.slice(),radius=s.diameterM/2,ring=Array.from({length:64},(_,i)=>[center[0]+radius*Math.cos(i*Math.PI/32),center[1]+radius*Math.sin(i*Math.PI/32),center[2]]);
    return {center,radius,ring};
  }
  function gearGeometry(g){
    if(!g?.enabled)return null;
    if(![1,2].includes(g.type))throw Error('Выберите полозья или колёса.');
    check(g.diameterM,.002,10,'диаметр опоры');check(g.widthM,.001,10,'ширину опоры');check(g.yM,-1000,1000,'высоту центра опор');
    check(g.frontZM,-1000,1000,'переднюю опору Z');check(g.rearZM,-1000,1000,'задние опоры Z');
    check(g.trackM,.01,1000,'колею опор');check(g.deflectionM,.001,.1,'обжатие опор, не менее 1 мм');check(g.dampingRatio,.2,3,'демпфирование опор');
    if(g.rearZM<=g.frontZM)throw Error('Задние опоры должны быть позади передней.');
    const centers=[[0,g.yM,g.frontZM],[-g.trackM/2,g.yM,g.rearZM],[g.trackM/2,g.yM,g.rearZM]],radius=g.diameterM/2,
      groundY=g.yM-radius,loadedGroundY=groundY+g.deflectionM;
    return {centers,radius,groundY,loadedGroundY};
  }
  function gearProperties(g,massKg,cgZM,prop){
    const geometry=gearGeometry(g);if(!geometry)return {values:new Map(),report:null};
    const {centers,radius,loadedGroundY}=geometry;
    const propClearanceM=prop.positionM[1]-prop.diameterM/2-loadedGroundY;
    if(!(propClearanceM>0))throw Error('Винт пересекает уровень земли под нагрузкой. Опустите опоры или поднимите ось винта.');
    // The CG must be inside the triangular support polygon, not merely between
    // the first and last point. CG X is zero in this exporter.
    if(!(cgZM>g.frontZM&&cgZM<g.rearZM))throw Error('ЦТ должен быть между передней и задними опорами.');
    const noseFraction=(g.rearZM-cgZM)/(g.rearZM-g.frontZM),fractions=[noseFraction,(1-noseFraction)/2,(1-noseFraction)/2],values=new Map();
    const put=(k,v)=>values.set(k,v),ft=(k,v)=>put(k,v*FT);
    put('_gear/count',10);put('acf/_gear_EQ',1);put('acf/_use_cus_gear_defs',1);put('acf/_use_cus_gear_damping',1);
    put('acf/_additonal_gear_flatplate',0);put('acf/_gear_exposed_when_retracted',0);
    for(let i=0;i<10;i++){
      const p=`_gear/${i}/`;put(p+'_gear_type',i<3?g.type:0);put(p+'_gear_renders_geo',0);put(p+'_gear_can_retract',0);
      if(i>=3)continue;
      for(const k of ['_axiE','_axiR','_eagle_claw_deg','_gear_brakes','_gear_castors','_latE','_latR','_lonE','_lonR','_leg_len','_steerdeg_hispeed','_steerdeg_lospeed','_strut_comp','_strut_s1','_strut_s2','_strut_t1','_strut_t2'])put(p+k,0);
      put(p+'_cyc_time',1);centers[i].forEach((v,j)=>ft(p+'_gear_'+'xyz'[j],v));ft(p+'_tire_radius',radius);ft(p+'_tire_swidth',g.widthM/2);put(p+'_tire_psi',20);
      const supportedMass=massKg*fractions[i],forceLb=supportedMass*LB;
      ft(p+'_strut_max_wgt_def',g.deflectionM);put(p+'_strut_max_wgt_frc',forceLb);put(p+'_strut_preload_def',0);put(p+'_strut_preload_frc',0);
      // Critical viscous damping c = 2*zeta*sqrt(k*m), k = supported weight / travel.
      // Native ACF damping is lbf/(ft/s), not SI N*s/m.
      const stiffnessNM=supportedMass*9.80665/g.deflectionM,dampingNSM=2*g.dampingRatio*Math.sqrt(stiffnessNM*supportedMass);
      put(p+'_damp',dampingNSM*.3048/4.4482216152605);
    }
    return {values,report:{...g,...geometry,loadFractions:fractions,propClearanceM,
      note:'Level-aircraft estimate at static load. Does not guarantee prop clearance during pitch/roll or impact. Hiding gear does not remove its aerodynamic drag.'}};
  }
  function mac(draft,P){
    let area=0,c2=0,qc=0;
    for(const s of draft.surfaces.filter(s=>s.role==='wing')){
      const ns=P.selected(s);
      for(let j=0;j<ns.length-1;j++)for(let i=0;i<10;i++){
        const a=P.ribAt(s,ns[j],ns[j+1],i/10),b=P.ribAt(s,ns[j],ns[j+1],(i+1)/10),dy=b.at-a.at;
        if(!(dy>0&&a.chord>0&&b.chord>0))throw Error('Проверьте геометрию крыла для САХ.');
        // Exact integrals of linear chord and quarter-chord on each rib interval.
        area+=dy*(a.chord+b.chord);
        c2+=2*dy*(a.chord*a.chord+a.chord*b.chord+b.chord*b.chord)/3;
        qc+=2*dy*(2*a.z*a.chord+a.z*b.chord+b.z*a.chord+2*b.z*b.chord)/6;
      }
    }
    if(!(area>0))throw Error('Для центровки нужно основное крыло.');
    const chordM=c2/area,quarterChordZM=qc/area;
    return {areaM2:area,chordM,quarterChordZM,leadingEdgeZM:quarterChordZM-.25*chordM,basis:'all exported main-wing panels, including Misc Wings; horizontal projection'};
  }
  function validate(s){
    check(s.cgPercent,0,100,'центровку, % САХ');check(s.massKg,.001,1e6,'полную массу, кг');check(s.cgYM,-1000,1000,'высоту ЦТ');
    check(s.vneKmh,.1,10000,'Vne — предельную допустимую воздушную скорость, км/ч');
    check(s.power,0.001,1e9,'мощность на валу');if(!['W','kW','metricHp'].includes(s.powerUnit))throw Error('Выберите единицы мощности.');
    check(s.diameterM,.001,100,'диаметр винта');check(s.rpm,1,1e6,'расчётные обороты винта');check(s.pitchM,.00001,100,'шаг винта');
    check(s.gearRatio,.01,100,'передаточное отношение');check(s.blades,1,16,'число лопастей');if(!Number.isInteger(s.blades))throw Error('Число лопастей должно быть целым.');
    check(s.rootChordM,.00001,s.diameterM,'хорду корня лопасти');check(s.tipChordM,.00001,s.diameterM,'хорду конца лопасти');
    check(s.batteryWh,.001,1e9,'энергию аккумулятора, Вт·ч');check(s.batteryV,.001,1e5,'напряжение аккумулятора');
    if(![1,-1].includes(s.direction))throw Error('Выберите направление вращения винта.');
    for(const v of s.positionM||[])check(v,-1e4,1e4,'положение винта');if(s.positionM?.length!==3)throw Error('Нужны X, Y, Z центра винта.');
    if(!s.propFoil||/[\\/\r\n\0]/.test(s.propFoil)||!s.propFoil.toLowerCase().endsWith('.afl'))throw Error('Выберите AFL лопасти винта.');
    gearGeometry(s.groundGear);
    return s;
  }
  function build(s,draft,P,airfoils){
    validate(s);const m=mac(draft,P),cgZM=m.leadingEdgeZM+s.cgPercent/100*m.chordM,
      powerW=s.power*(s.powerUnit==='kW'?1000:s.powerUnit==='metricHp'?735.49875:1),powerHP=powerW/HP_W,
      radius=s.diameterM/2,engineRPM=s.rpm*s.gearRatio,foil=airfoils.get(s.propFoil);
    if(!foil)throw Error('Выберите папку Airfoils: нужен профиль винта '+s.propFoil);
    const values=new Map(),put=(k,v)=>values.set(k,v),ft=(k,v)=>put(k,v*FT);
    // The single entered test mass is represented as empty mass. Fuel/payload
    // are zero so they cannot silently be added a second time on loading.
    put('acf/_m_empty',s.massKg*LB);put('acf/_m_max',s.massKg*LB);put('acf/_m_fuel_max_tot',0);
    put('acf/_Vne_kts',s.vneKmh/1.852);
    for(const k of ['_cgZ','_cgZ_fwd','_cgZ_aft'])ft('acf/'+k,cgZM);
    ft('acf/_cgY',s.cgYM);put('acf/_cgX_lft',0);put('acf/_cgX_rgt',0);put('acf/_cg_in_mac',0);
    // A fresh geometry-only template has zero transmissions. Merely assigning
    // engine/prop indices does not create the shaft coupling in X-Plane.
    // Even a direct-drive electric motor needs one transmission (ratio 1:1).
    // Electric-only setup: 0.20 s engine spin-up accepted in the user's test.
    // Propeller inertia remains a separate setting; geometry-only export keeps
    // the original template value and does not acquire electric motor defaults.
    for(const [k,v]of Object.entries({_num_engn:1,_num_prop:1,_num_xmsn:1,_engine_rev_time_sec:.2,_power_max_limit:powerHP,_RSC_redline_ENGN:engineRPM,_RSC_idlespeed_ENGN:0,
      _battery_watt_hr_max:s.batteryWh,_nom_bat_volt:s.batteryV,_nom_gen_volt:s.batteryV,_num_batteries:1,_use_manual_prop_inc:1}))put('acf/'+k,v);
    put('acf/_xmsn_of_engn/0',0);put('acf/_xmsn_of_prop/0',0);
    const e='_engn/0/',p='_prop/0/',b='_blad/0/';
    put('_engn/count',16);put('_prop/count',16);put('_blad/count',16);
    for(const [k,v]of Object.entries({_type:'ELE',_power_max_limit:powerHP,_RSC_max_pwr_ENGN:engineRPM,_RSC_redline_ENGN:engineRPM,_engn_health_var:1,
      _thrust_max_limit:0,_burner_inc:0,_engn_clutch_EQ:0,_engn_freewheels:0,_engn_vector_EQ:0,_part_psi:0,_part_the:0}))put(e+k,v);
    put(e+'_exhaust_os_xyz/count',3);for(let i=0;i<3;i++)put(e+'_exhaust_os_xyz/'+i,0);
    for(const [k,v]of Object.entries({_des_rpm_prp:s.rpm,_des_kts_acf:0,_des_AOA_root:0,_des_AOA_tip:0,_des_AOA_pwr:1,_des_Mach_limit:1,_max_AOA_deg:90,
      _max_pitch:0,_min_pitch:0,_num_blades:s.blades,_prop_dir:s.direction,_prop_gear_rat:s.gearRatio,_prop_type:0,_rad_mod:1,
      _prop_clutch_EQ:0,_prop_ducted:0,_prop_hotel_EQ:0,_vectarmY_engn:0,_vectarmZ_engn:0}))put(p+k,v);
    for(const [k,v]of Object.entries({_Croot:s.rootChordM*FT,_Ctip:s.tipChordM*FT,_semilen_SEG:radius*FT,_els:10,_s_dim:20,_r_dim:14,
      _part_phi:0,_part_the:0,_part_psi:0,_part_specs_eq:0,_part_specs_invis:0,_part_specs_rmod:1,_part_tex:0,
      _engn_for_body:-2,_gear_for_body:-2,_is_right_mult:1,_dihed_design:0,_sweep_design:0,_plan_ellipse_frac:0,
      _foil_rat_rot:0,_foil_rat_mid_inner:0,_foil_rat_mid_outer:0,_foil_rat_tip:1,_var_sweep:0,_var_dihed:0,_var_incid:0,_var_retract:0}))put(b+k,v);
    for(let i=0;i<3;i++){ft(e+'_part_'+'xyz'[i],s.positionM[i]);ft(b+'_part_'+'xyz'[i],s.positionM[i]);put(b+'_afl_file_'+(i+1),s.propFoil);}
    const twists=Array.from({length:10},(_,i)=>Math.atan2(s.pitchM,2*Math.PI*radius*(i+.5)/10)*180/Math.PI);
    put(b+'_incidence/count',10);twists.forEach((v,i)=>put(b+'_incidence/'+i,v));
    for(const control of ['ailn1','ailn2','elev1','elev2','rudd1','rudd2','flap1','flap2','slat1','slat2','spoi1','spoi2','yawbr','inc_ailn1','inc_ailn2','inc_elev1','inc_elev2','inc_rudd1','inc_rudd2','inc_trim','inc_vect','sbrk1','sbrk2']){
      put(b+'_'+control+'/count',10);for(let i=0;i<10;i++)put(b+'_'+control+'/'+i,0);
    }
    for(const a of ['c_rat_for_RIB','c_off_for_RIB','chord_for_RIB'])put(b+'_'+a+'/count',11);
    for(let i=0;i<11;i++){put(b+'_c_rat_for_RIB/'+i,1);put(b+'_c_off_for_RIB/'+i,0);ft(b+'_chord_for_RIB/'+i,s.rootChordM+(s.tipChordM-s.rootChordM)*i/10);}
    // Blade cached geometry is LOCAL, unlike wing geo_xyz. Native Plane Maker
    // places/replicates it using _blad part_xyz and _prop num_blades/prop_dir.
    for(let i=0;i<20;i++){
      const rib=Math.ceil(i/2),r=radius*rib/10,chord=s.rootChordM+(s.tipChordM-s.rootChordM)*rib/10,
        theta=(rib===0?twists[0]:rib===10?twists[9]:(twists[rib-1]+twists[rib])/2)*Math.PI/180;
      for(let j=0;j<18;j++){
        let xyz=[0,0,0];if(j<14){const z=foil.outline[j][0]*chord,n=foil.outline[j][1]*foil.thickness*chord;
          xyz=[r,z*Math.sin(theta)+n*Math.cos(theta),z*Math.cos(theta)-n*Math.sin(theta)];}
        for(let a=0;a<3;a++)ft(b+`_geo_xyz/${i},${j},${a}`,xyz[a]);
      }
    }
    put(b+'_geo_xyz/i_count',20);put(b+'_geo_xyz/j_count',18);put(b+'_geo_xyz/k_count',3);
    const gear=gearProperties(s.groundGear,s.massKg,cgZM,s);for(const [k,v]of gear.values)put(k,v);
    return {values,report:{...s,groundGear:gear.report,mac:m,cgZM,powerW,powerNativeHP:powerHP,engineRPM,propellerType:'fixed geometric pitch',bladeTwistDegrees:twists,
      assumptions:['Single electric motor. Shaft power, not electrical input power.','Entered total test mass is empty mass; no extra fuel/payload.','Blade chord and AFL are user inputs, not measured from a propeller STL.','Battery and inertia need validation; this is not a validated flight model.']}};
  }
  const api={mac,propPreview,gearGeometry,gearProperties,validate,build};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FlightSetup=api;
})(globalThis);
