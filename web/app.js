(function(){
  'use strict';
  const $=id=>document.getElementById(id),C=STLCore,P=PlaneImport,roles={body:'Фюзеляж',wing:'Крыло',horizontal:'Гориз. оперение',vertical:'Вертик. оперение',other:'Другой корпус',ignore:'Не учитывать'};
  const colors={body:'#607d92',wing:'#178e91',horizontal:'#698cc9',vertical:'#bc8950',other:'#9b83b4'};
  let inputs=[],worker=null,analysis=null,meshes=[],busy=false,job=0,pendingExport=null,appliedOptions=null;
  let draft=null,templateText=null,templateFile=null,foilFiles=new Map(),pendingResample=null;
  const bundled=globalThis.BundledAircraftAssets||{airfoils:[],template:null};
  const builtinFoils=new Map(bundled.airfoils.map(f=>[f.name.toLowerCase(),{file:new File([f.text],f.name),ambiguous:false}]));
  let yaw=.55,pitch=.5,zoom=1,panX=0,panY=0,drag=null;
  const number=(n,d=1)=>n.toLocaleString('ru-RU',{maximumFractionDigits:d});
  function say(text,error=false){$('status').textContent=text;$('status').className=error?'error':'';}
  function safeName(value){return value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/^\.+/,'').slice(0,80)||'Aircraft';}
  function profiles(){return Object.fromEntries(['wingRoot','wingTip','horizontalFoil','verticalFoil'].map(id=>{const value=$(id).value.trim();return [id,foilFiles.get(value.toLowerCase())?.file.name||value||null];}));}
  const inputNumber=id=>$(id).value.trim()===''?NaN:Number($(id).value);
  function propSettings(){return {diameterM:inputNumber('propDiameter')*.0254,positionM:['motorX','motorY','motorZ'].map(id=>inputNumber(id)/1000)};}
  function groundGear(){return {enabled:$('gearEnabled').checked,type:inputNumber('gearType'),diameterM:inputNumber('gearDiameter')/1000,widthM:inputNumber('gearWidth')/1000,
    yM:inputNumber('gearY')/1000,frontZM:inputNumber('gearFrontZ')/1000,rearZM:inputNumber('gearRearZ')/1000,trackM:inputNumber('gearTrack')/1000,
    deflectionM:inputNumber('gearDeflection')/1000,dampingRatio:inputNumber('gearDamping')};}
  function flightSettings(){
    if(!$('flightEnabled').checked)return null;
    const n=id=>$(id).value.trim()===''?NaN:Number($(id).value),name=$('propFoil').value.trim();
    return {massKg:n('massKg'),cgPercent:n('cgPercent'),cgYM:n('cgY')/1000,vneKmh:n('vneKmh'),power:n('motorPower'),powerUnit:$('powerUnit').value,
      diameterM:n('propDiameter')*.0254,pitchM:n('propPitch')*.0254,rpm:n('propRpm'),blades:n('propBlades'),gearRatio:n('gearRatio'),
      direction:n('propDirection'),rootChordM:n('propRootChord')/1000,tipChordM:n('propTipChord')/1000,
      batteryWh:n('batteryWh'),batteryV:n('batteryV'),positionM:['motorX','motorY','motorZ'].map(id=>n(id)/1000),
      propFoil:foilFiles.get(name.toLowerCase())?.file.name||name,groundGear:groundGear()};
  }
  function updateCG(){
    if(!draft)return;
    try{const m=FlightSetup.mac(draft,P),percent=Number($('cgPercent').value),z=m.leadingEdgeZM+percent/100*m.chordM;
      $('cgInfo').textContent=`Полное крыло: САХ ${number(m.chordM*1000,2)} мм, передняя кромка Z ${number(m.leadingEdgeZM*1000,2)} мм. ЦТ ${number(percent,2)}%: Z ${number(z*1000,2)} мм. Включены Misc Wings; штатный %MAC Plane Maker может отличаться.`;
    }catch(e){$('cgInfo').textContent=e.message;}
    try{const g=groundGear(),geo=FlightSetup.gearGeometry(g);if(!geo){$('gearInfo').textContent='Создание опор выключено.';return;}
      const prop=propSettings(),clearance=prop.positionM[1]-prop.diameterM/2-geo.loadedGroundY,m=FlightSetup.mac(draft,P),cg=m.leadingEdgeZM+inputNumber('cgPercent')/100*m.chordM;
      if(!(cg>g.frontZM&&cg<g.rearZM))throw Error('ЦТ должен быть между передней и задними опорами.');
      $('gearInfo').textContent=`Уровень земли под нагрузкой: Y ${number(geo.loadedGroundY*1000,1)} мм. Зазор винта при горизонтальном самолёте: ${number(clearance*1000,1)} мм.`+(clearance<=0?' Винт пересекает уровень земли: опустите опоры или поднимите ось винта.':'');
    }catch(e){$('gearInfo').textContent=e.message;}
  }
  function options(){
    const nose=$('frontSign').value+$('longAxis').value,up=$('upSign').value+$('upAxis').value;
    const n=C.axis(nose),u=C.axis(up);if(n.index===u.index)throw Error('Продольная и вертикальная оси должны различаться.');
    const nv=[0,0,0],uv=[0,0,0];nv[n.index]=n.sign;uv[u.index]=u.sign;
    const right=[nv[1]*uv[2]-nv[2]*uv[1],nv[2]*uv[0]-nv[0]*uv[2],nv[0]*uv[1]-nv[1]*uv[0]];
    const a=right.findIndex(x=>x!==0),r=(right[a]>0?'+':'-')+'XYZ'[a];
    const o={nose,up,right:r,unit:$('unit').value,factor:Number($('factor').value),stations:Number($('stations').value),radii:Number($('radii').value),repairGaps:$('repairGaps').checked,maxGapDegrees:Number($('maxGapDegrees').value),maxGapLengthM:Number($('maxGapLength').value)/1000};
    if(!Number.isFinite(o.maxGapDegrees)||o.maxGapDegrees<0||o.maxGapDegrees>180||!Number.isFinite(o.maxGapLengthM)||o.maxGapLengthM<0)throw Error('Проверьте пределы восстановления вырезов.');
    C.mapping(o);if(!Number.isInteger(o.stations)||o.stations<3||o.stations>100||!Number.isInteger(o.radii)||o.radii<8||o.radii>180)throw Error('Проверьте число сечений и точек обвода.');
    $('axisInfo').textContent=`Исходный STL: нос ${nose}, верх ${up}, вправо ${r}.`;return o;
  }
  function setBusy(value){busy=value;for(const el of document.querySelectorAll('input,select,textarea,button'))if(el.id!=='cancel'&&!el.dataset.view&&!['showSections','showDraft','showProp','showGear'].includes(el.id))el.disabled=value||el.dataset.rowDisabled==='true';$('analyze').disabled=value||!inputs.length||!worker;$('cancel').disabled=!value;$('progress').hidden=!value;updateDownloads();}
  function acfIssues(){
    const issues=[],add=(ids,message)=>issues.push({ids,message});
    if(!draft||!analysis)add([inputs.length&&worker?'analyze':'folderInput'],'Загрузите STL и пересчитайте геометрию.');
    if(analysis&&!$('axesConfirmed').checked)add(['axesConfirmed'],'Подтвердите направление носа и верха.');
    if(!templateText)add(['templateInput'],'Выберите чистый шаблон ACF из Plane Maker.');
    if(draft)try{P.validateDraft(draft);}catch(e){add(['draftEditors'],e.message);}
    const p=profiles(),needed=new Set();
    for(const s of draft?.surfaces||[])for(const id of s.role==='wing'?['wingRoot',...($('wingTip').value.trim()?['wingTip']:[])]:[s.role==='horizontal'?'horizontalFoil':'verticalFoil'])needed.add(id);
    if($('flightEnabled').checked)needed.add('propFoil');
    if(needed.size&&!foilFiles.size)add(['foilFolderInput'],'Выберите папку Airfoils с нужными AFL.');
    for(const id of needed){
      const name=id==='propFoil'?$('propFoil').value.trim():p[id],f=name&&foilFiles.get(name.toLowerCase());
      if(!name)add([id],'Назначьте профиль: '+$(id).closest('label').textContent.trim()+'.');
      else if(!f||f.ambiguous)add([id,'foilFolderInput'],(f?.ambiguous?'Несколько файлов AFL с именем ':'Не найден AFL: ')+name);
    }
    if(p.wingTip&&p.wingTip!==p.wingRoot)add(['wingTip'],'Используйте одинаковый AFL в корне и на конце крыла.');
    if($('flightEnabled').checked){
      const active=[...$('flightPanel').querySelectorAll('input[type=number]'),...($('gearEnabled').checked?$('gearPanel').querySelectorAll('input[type=number]'):[])];
      const invalid=active.filter(el=>el.value.trim()===''||!el.validity.valid);
      for(const el of invalid)add([el.id],'Введите корректное значение: '+el.closest('label').textContent.trim()+'.');
      const flight=flightSettings();
      try{FlightSetup.validate(flight);}catch(e){
        // Native field validity locates all missing inputs; retain the shared
        // physical validator for range and cross-field constraints as well.
        if(!invalid.length)add([/опор|полоз|колёс/.test(e.message)?'gearPanel':'flightPanel'],e.message);
      }
      if(!invalid.length&&draft)try{
        FlightSetup.validate(flight);
        const m=FlightSetup.mac(draft,P),cg=m.leadingEdgeZM+flight.cgPercent/100*m.chordM;
        if(flight.groundGear.enabled){
          const geo=FlightSetup.gearGeometry(flight.groundGear);
          if(!(cg>flight.groundGear.frontZM&&cg<flight.groundGear.rearZM))add(['cgPercent','gearFrontZ','gearRearZ'],'ЦТ должен быть между передней и задними опорами.');
          if(flight.positionM[1]-flight.diameterM/2<=geo.loadedGroundY)add(['motorY','propDiameter','gearY'],'Винт пересекает уровень земли под нагрузкой. Опустите опоры или поднимите ось винта.');
        }
      }catch(e){if(!issues.some(i=>i.message===e.message))add(['flightPanel'],e.message);}
    }
    return issues;
  }
  function acfReason(){return acfIssues()[0]?.message||'';}
  function highlightAcf(issues){
    for(const el of document.querySelectorAll('.acf-needed'))el.classList.remove('acf-needed');
    for(const el of document.querySelectorAll('[data-acf-needed]'))el.removeAttribute('data-acf-needed');
    for(const id of new Set(issues.flatMap(i=>i.ids))){
      const el=$(id);if(!el)continue;el.dataset.acfNeeded='true';
      const target=el.hidden?document.querySelector('label[for="'+id+'"]'):el.closest('label')||el;
      target?.classList.add('acf-needed');
    }
    const ready=!busy&&!issues.length;$('downloadAcfZip').classList.toggle('acf-ready',ready);
    $('acfGuide').textContent=busy?'Расчёт выполняется…':ready?'Всё заполнено. Архив ACF можно скачать зелёной кнопкой внизу.':
      'Оранжевая рамка и метка «Нужно для ACF» показывают оставшиеся действия и поля. Физические параметры обязательны только при включённом разделе 06.';
  }
  function updateDownloads(){
    const enabled=!busy&&Boolean(analysis)&&$('axesConfirmed').checked;$('downloadZip').disabled=$('downloadJson').disabled=!enabled;
    const issues=acfIssues();$('downloadAcfZip').disabled=busy||Boolean(issues.length);
    $('acfStatus').textContent=issues.length?'Осталось исправить: '+issues.length+'. '+issues[0].message:'Геометрия готова к экспериментальному экспорту ACF. После загрузки проверьте и сохраните её в Plane Maker.';
    highlightAcf(issues);updateCG();
  }
  function invalidate(){if(analysis){analysis=null;draft=null;meshes=[];$('draftEditors').replaceChildren();$('badge').textContent='Нужно пересчитать';say('Настройки изменены. Нажмите «Пересчитать», чтобы обновить геометрию.');draw();drawSlice();}$('axesConfirmed').checked=false;updateDownloads();try{options();}catch(e){say(e.message,true);}}
  function acceptFoils(list){
    const selected=new Map();for(const file of [...list].filter(f=>/\.afl$/i.test(f.name))){const key=file.name.toLowerCase(),previous=selected.get(key);selected.set(key,{file,ambiguous:Boolean(previous)});}
    foilFiles=new Map([...builtinFoils,...selected]);
    $('foilNames').replaceChildren();for(const {file}of [...foilFiles.values()].sort((a,b)=>a.file.name.localeCompare(b.file.name))){const op=document.createElement('option');op.value=file.name;$('foilNames').append(op);}
    $('foilStatus').textContent='Доступно AFL: '+foilFiles.size+' (встроенных: '+builtinFoils.size+', выбранных: '+selected.size+'). Выберите профили из списка или начните вводить название.';updateDownloads();
  }
  function useBuiltinTemplate(){
    templateText=null;templateFile=null;
    if(bundled.template)try{
      P.validateTemplate(bundled.template.text);templateText=bundled.template.text;
      templateFile=new File([templateText],bundled.template.name);
      $('templateStatus').textContent='Встроенный чистый шаблон: input/'+bundled.template.name+'. Можно выбрать другой.';
    }catch(e){$('templateStatus').textContent=e.message;}
    else $('templateStatus').textContent='Выберите чистый шаблон ACF отдельно.';
  }
  async function acceptTemplate(file){
    if(!file)return;try{const text=await file.text();P.validateTemplate(text);templateText=text;templateFile=file;$('templateStatus').textContent='Шаблон: '+file.name+' · ACF 1200, чистый.';}
    catch(e){templateText=null;templateFile=null;$('templateStatus').textContent=e.message;}updateDownloads();
  }
  function draftChanged(){if(!draft)return;draft.closeCaps=$('closeCaps').checked;try{P.validateDraft(draft);const wing=draft.surfaces.find(s=>s.role==='wing'),count=wing?P.selected(wing).length-1:0;$('draftStatus').textContent=wing&&count>P.nativeCount(wing)?'Крыло: '+P.nativeCount(wing)+' штатных секций и '+(count-P.nativeCount(wing))+' дополнительных пар. Штатный %MAC Plane Maker учитывает только Wings 1–4; полная САХ есть в import-report.json.':'Ручные правки применены к приближению. Фиолетовые линии показывают его положение.';}catch(e){$('draftStatus').textContent=e.message;}updateDownloads();draw();drawSlice();}
  function targetState(target){
    if(target.kind==='body'){const source=analysis.bodies.find(b=>b.group===target.key),edited=draft.bodies.find(b=>b.group===target.key);return {source,edited,min:source.bounds.min[2],max:source.bounds.max[2],positions:edited.sections.map(s=>s.z),rows:edited.sections,coordinate:'z',maximum:18,minimum:3};}
    const source=analysis.surfaces.find(s=>s.role===target.key),edited=draft.surfaces.find(s=>s.role===target.key),a=source.normal;
    return {source,edited,min:target.key==='vertical'?source.bounds.min[a]:Math.max(0,source.bounds.min[a]),max:source.bounds.max[a],positions:edited.nodes.map(n=>n.at),rows:edited.nodes,coordinate:'at',maximum:21,minimum:2};
  }
  function resample(target,positions,preserve=true){
    if(busy||!worker||!draft)return;
    try{const state=targetState(target);if(positions.length>state.maximum)throw Error('Максимум сечений: '+state.maximum);C.checkedPositions(positions,state.min,state.max,state.minimum);
      pendingResample={target,preserve,old:structuredClone(state.edited)};setBusy(true);say('Повторное снятие срезов по STL…');worker.postMessage({kind:'resample',target,positions});
    }catch(e){say(e.message,true);renderDraft();}
  }
  function samplingControls(container,target){
    const state=targetState(target),panel=document.createElement('div');panel.className='sampling';panel.dataset.target=target.kind+':'+target.key;
    const title=document.createElement('strong');title.textContent='Распределение сечений · '+(target.kind==='body'?target.key:roles[target.key]);title.className='positions';panel.append(title);
    function control(labelText,input){const label=document.createElement('label');label.textContent=labelText;label.append(input);panel.append(label);return input;}
    const count=document.createElement('input');count.type='number';count.min=state.minimum;count.max=state.maximum;count.value=state.positions.length;count.dataset.field='count';control('Количество срезов',count);
    const mode=document.createElement('select');mode.dataset.field='mode';for(const [value,title]of [['uniform','Равномерно'],['start',target.kind==='body'?'Гуще у носа':'Гуще у корня'],['end',target.kind==='body'?'Гуще у хвоста':'Гуще у законцовки'],['both','Гуще у обоих краёв'],['zone','В заданной зоне']]){const option=document.createElement('option');option.value=value;option.textContent=title;mode.append(option);}control('Распределение',mode);
    const from=document.createElement('input'),to=document.createElement('input'),density=document.createElement('input');for(const input of [from,to,density]){input.type='number';input.step='any';}from.dataset.field='zoneFrom';to.dataset.field='zoneTo';density.dataset.field='density';from.value=((state.min+(state.max-state.min)*.3)*1000).toFixed(3);to.value=((state.min+(state.max-state.min)*.7)*1000).toFixed(3);density.value=5;
    control('Зона от, мм',from);control('Зона до, мм',to);control('Сгущение в зоне, ×',density);
    if(target.kind==='surface'){
      const native=document.createElement('input');native.type='number';native.min=1;native.max=target.key==='wing'?4:target.key==='horizontal'?1:2;native.value=state.edited.nativePanels;native.dataset.field='nativePanels';native.addEventListener('change',()=>{state.edited.nativePanels=Number(native.value);draftChanged();});control('Лимит штатных секций ACF',native);
      const tip=document.createElement('input');tip.type='checkbox';tip.checked=Boolean(state.edited.separateTip);tip.dataset.field='separateTip';const tipLabel=document.createElement('label');tipLabel.className='check positions';tipLabel.textContent='Законцовки отдельно · внешние секции в Misc Wings';tipLabel.prepend(tip);tip.addEventListener('change',()=>{state.edited.separateTip=tip.checked;draftChanged();});panel.append(tipLabel);
      const custom=document.createElement('input');custom.type='checkbox';custom.checked=Boolean(state.edited.customChords);custom.dataset.field='customChords';const customLabel=document.createElement('label');customLabel.className='check positions';customLabel.textContent='Уточнять обвод внутри секций · customize chords';customLabel.prepend(custom);custom.addEventListener('change',()=>{state.edited.customChords=custom.checked;draftChanged();});panel.append(customLabel);
    }
    const positions=document.createElement('textarea');positions.rows=2;positions.dataset.field='positions';positions.value=state.positions.map(v=>Number((v*1000).toFixed(6))).join('; ');const label=document.createElement('label');label.className='positions';label.textContent='Позиции срезов, мм · разделитель «;» · можно менять вручную';label.append(positions);panel.append(label);
    const actions=document.createElement('div');actions.className='actions';
    const generate=document.createElement('button');generate.textContent='Рассчитать позиции';generate.dataset.action='generate';generate.addEventListener('click',()=>{try{positions.value=C.stationPositions(state.min,state.max,Number(count.value),mode.value,{from:Number(from.value)/1000,to:Number(to.value)/1000,density:Number(density.value)}).map(v=>Number((v*1000).toFixed(6))).join('; ');}catch(e){say(e.message,true);}});
    const apply=document.createElement('button');apply.textContent='Снять срезы STL';apply.className='primary';apply.dataset.action='resample';apply.addEventListener('click',()=>{const values=positions.value.trim().split(/[;\n]+/).map(s=>s.trim()).filter(Boolean).map(s=>Number(s.replace(',','.'))/1000);resample(target,values,false);});
    actions.append(generate,apply);panel.append(actions);container.append(panel);
  }
  function renderDraft(){
    const box=$('draftEditors');box.replaceChildren();if(!draft)return;$('closeCaps').checked=draft.closeCaps;
    function table(title,headers){const h=document.createElement('h3');h.textContent=title;const wrap=document.createElement('div');wrap.className='table-wrap';const t=document.createElement('table'),head=t.createTHead().insertRow();for(const label of headers){const th=document.createElement('th');th.textContent=label;head.append(th);}const body=t.createTBody();wrap.append(t);box.append(h,wrap);return body;}
    function field(row,target,key,scale=1000,sliceTarget=null,index=0){const td=row.insertCell(),input=document.createElement('input');input.type='number';input.step='any';input.value=Number((target[key]*scale).toFixed(4));input.setAttribute('aria-label',key);input.addEventListener('change',()=>{const value=Number(input.value)/scale;if(sliceTarget){const positions=targetState(sliceTarget).positions;positions[index]=value;resample(sliceTarget,positions);}else{target[key]=value;target.manual=[...new Set([...(target.manual||[]),key])];draftChanged();}});td.append(input);}
    function rowActions(row,target,index){const state=targetState(target),td=row.insertCell(),add=document.createElement('button'),remove=document.createElement('button');add.textContent='+';add.title='Добавить срез посередине следующего интервала';add.disabled=index===state.positions.length-1||state.positions.length>=state.maximum;add.dataset.rowDisabled=add.disabled?'true':'false';add.addEventListener('click',()=>{const positions=targetState(target).positions;positions.splice(index+1,0,(positions[index]+positions[index+1])/2);resample(target,positions);});remove.textContent='−';remove.title='Удалить срез';remove.disabled=state.positions.length<=state.minimum;remove.dataset.rowDisabled=remove.disabled?'true':'false';remove.addEventListener('click',()=>{const positions=targetState(target).positions;positions.splice(index,1);resample(target,positions);});td.append(add,remove);}
    for(const s of draft.surfaces){const target={kind:'surface',key:s.role};samplingControls(box,target);const tableBody=table(roles[s.role]+(s.role==='vertical'?'':' · правая половина'),['Взять',s.role==='vertical'?'Станция Y':'Станция X','Хорда','25% Z',s.role==='vertical'?'Центр X':'Центр Y','Угол, °','Источник','Срезы']);
      s.nodes.forEach((n,index)=>{const row=tableBody.insertRow(),td=row.insertCell(),check=document.createElement('input');check.type='checkbox';check.checked=n.enabled;check.setAttribute('aria-label','Выбрать узел');check.addEventListener('change',()=>{n.enabled=check.checked;draftChanged();});td.append(check);for(const k of ['at','chord','z','height'])field(row,n,k,1000,k==='at'?target:null,index);field(row,n,'incidence',1);row.insertCell().textContent=n.source==='root-extrapolation'?'Восстановлен корень':'Срез STL';rowActions(row,target,index);});
    }
    for(const b of draft.bodies){const target={kind:'body',key:b.group};samplingControls(box,target);const tableBody=table('Корпус · '+b.group,['№','Z','Центр X','Центр Y','Ширина','Высота','Торец','Срезы']);b.sections.forEach((s,i)=>{const row=tableBody.insertRow();row.insertCell().textContent=i;for(const k of ['z','cx','cy','width','height'])field(row,s,k,1000,k==='z'?target:null,i);row.insertCell().textContent=s.cap?'Точка рядом':'';rowActions(row,target,i);});}
    draftChanged();
  }
  function workerMain(factory){
    const C=factory();let stored=[],current=[],options={};
    self.onmessage=({data:d})=>{try{
      if(d.kind==='load'){
        stored=[];for(let i=0;i<d.files.length;i++){const f=d.files[i],p=C.parseSTL(f.buffer);stored.push({path:f.path,role:f.role,group:f.group,...p});postMessage({kind:'progress',percent:Math.round(40*(i+1)/d.files.length)});}
      }
      if(d.kind==='load'||d.kind==='analyze'){
        current=stored.map((m,i)=>{const vertices=C.transform(m.vertices,d.options);return {...m,role:d.parts[i].role,group:d.parts[i].group,vertices,bounds:C.bounds(vertices)};}).filter(m=>m.role!=='ignore');
        if(!current.length)throw Error('No geometry selected.');options=d.options;
        postMessage({kind:'progress',percent:50});const analysis=C.analyze(current,options);
        const meshes=current.map(({vertices,...m})=>({...m,preview:C.preview(vertices)}));postMessage({kind:'done',analysis,meshes});
      }
      if(d.kind==='resample'){
        postMessage({kind:'progress',percent:35});const data=C.resampleTarget(current,options,d.target,d.positions);postMessage({kind:'resampled',target:d.target,data});
      }
      if(d.kind==='export'){
        const entries=[];for(let i=0;i<current.length;i++){const m=current[i];entries.push({name:m.path.replace(/\.stl$/i,'.obj'),text:C.obj8(m.vertices)});postMessage({kind:'progress',percent:Math.round(95*(i+1)/current.length)});}postMessage({kind:'exported',entries});
      }
    }catch(e){postMessage({kind:'error',message:e.message});}};
  }
  function makeWorker(){
    const code=`(${workerMain.toString()})(${STLImporterCore.toString()});`;
    const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));const w=new Worker(url);URL.revokeObjectURL(url);return w;
  }
  function renderSurfaceMeasurements(){
    $('surfaceRows').replaceChildren();
    for(const surface of analysis.surfaces)for(const s of surface.samples){const tr=document.createElement('tr');for(const value of [roles[surface.role],number(s.at*1000),s.missing?'Нет среза':number(s.leading*1000),s.missing?'—':number(s.chord*1000),s.missing?'—':number(s.quarterChord*1000)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}$('surfaceRows').append(tr);}
  }
  function bindWorker(w,token){
    w.onerror=e=>{if(token!==job)return;say('Ошибка фонового обработчика: '+e.message,true);setBusy(false);};
    w.onmessage=({data:d})=>{
      if(token!==job)return;
      if(d.kind==='progress')$('progress').value=d.percent;
      if(d.kind==='error'){if(pendingResample){pendingResample=null;renderDraft();}say(d.message,true);setBusy(false);pendingExport=null;return;}
      if(d.kind==='resampled'){
        if(!pendingResample)return;
        const {old,preserve}=pendingResample,target=d.target,body=target.kind==='body',field=body?'sections':'nodes',coordinate=body?'z':'at';
        const fresh=P.buildDraft(body?{bodies:[d.data],surfaces:[]}:{bodies:[],surfaces:[d.data]})[body?'bodies':'surfaces'][0];
        if(!body){fresh.nativePanels=old.nativePanels;fresh.separateTip=old.separateTip;fresh.customChords=old.customChords;}
        for(const row of fresh[field]){
          const previous=old[field].find(p=>Math.abs(p[coordinate]-row[coordinate])<1e-9);
          if(!body&&preserve&&previous)row.enabled=previous.enabled;
          if(previous){for(const key of previous.manual||[])if(key!==coordinate)row[key]=previous[key];row.manual=previous.manual?.slice();}
        }
        if(!body&&!preserve)P.chooseBoundaries(fresh,fresh.nativePanels+1+(fresh.separateTip?1:0));
        if(body){const i=analysis.bodies.findIndex(b=>b.group===target.key);analysis.bodies[i]=d.data;draft.bodies[i]=fresh;appliedOptions.bodyPositions={...appliedOptions.bodyPositions,[target.key]:d.data.sections.map(s=>s.z)};}
        else{const i=analysis.surfaces.findIndex(s=>s.role===target.key);analysis.surfaces[i]=d.data;draft.surfaces[i]=fresh;appliedOptions.surfacePositions={...appliedOptions.surfacePositions,[target.key]:d.data.samples.map(s=>s.at)};}
        pendingResample=null;renderDraft();renderSurfaceMeasurements();setBusy(false);say('Сечения заново сняты по STL. Остальные детали и ручные правки на неизменённых позициях сохранены.');draw();drawSlice();return;
      }
      if(d.kind==='done'){
        analysis=d.analysis;meshes=d.meshes;draft=P.buildDraft(analysis);renderDraft();setBusy(false);$('badge').textContent='Геометрия готова';
        const wing=analysis.surfaces.find(s=>s.role==='wing');$('span').textContent=wing?number(wing.bounds.size[0]*1000)+' мм':'—';
        $('length').textContent=analysis.bodies.length?number(analysis.bodies[0].bounds.size[2]*1000)+' мм':'—';
        $('triangles').textContent=number(meshes.reduce((n,m)=>n+m.triangles,0),0);
        $('bodySelect').replaceChildren();analysis.bodies.forEach((b,i)=>{const op=document.createElement('option');op.value=i;op.textContent=b.group;$('bodySelect').append(op);});
        renderSurfaceMeasurements();
        const missing=analysis.bodies.reduce((n,b)=>n+b.sections.filter(s=>s.remainingMissing).length,0),filled=analysis.bodies.reduce((n,b)=>n+b.sections.reduce((n,s)=>n+s.interpolatedPoints.length,0),0);
        say(`Обработано деталей: ${meshes.length}. По касательным восстановлено точек: ${filled}. ${missing?'Остались неполные обводы: '+missing+'. Проверьте срезы.':'Проверьте стрелку носа, верх и наружные обводы.'} Подтвердите оси для экспорта.`);
        draw();drawSlice();
      }
      if(d.kind==='exported'){
        try{finishExport(d.entries);}catch(e){say(e.message,true);}finally{pendingExport=null;setBusy(false);}
      }
    };
  }
  function partSettings(){return inputs.map(f=>({role:f.role,group:f.group}));}
  function renderFiles(){
    $('files').replaceChildren();for(const f of inputs){const row=document.createElement('div');row.className='file';const name=document.createElement('strong');name.textContent=f.path;const size=document.createElement('small');size.textContent=number(f.file.size/1048576,2)+' МБ';
      const pair=document.createElement('div');pair.className='pair';const select=document.createElement('select');for(const [value,label]of Object.entries(roles)){const op=document.createElement('option');op.value=value;op.textContent=label;select.append(op);}select.value=f.role;select.addEventListener('change',()=>{f.role=select.value;invalidate();});
      const group=document.createElement('input');group.value=f.group;group.title='Группа: детали одного корпуса объединяются';group.setAttribute('aria-label','Группа '+f.path);group.addEventListener('change',()=>{f.group=group.value.trim()||f.path;invalidate();});pair.append(select,group);row.append(name,size,pair);$('files').append(row);}
  }
  async function load(list){
    if(busy)return;const all=[...list],stls=all.filter(f=>/\.stl$/i.test(f.name));
    if(!stls.length){say('В папке нет STL.',true);return;}
    if(stls.reduce((n,f)=>n+f.size,0)>256*1048576){say('Первая версия поддерживает до 256 МБ STL на проект.',true);return;}
    const root=(stls[0].webkitRelativePath||'').split('/')[0];if(root)$('projectName').value=root;$('modelTitle').textContent=$('projectName').value;
    inputs=stls.map(file=>{const full=file.webkitRelativePath||file.name,path=root?full.slice(root.length+1):full;const role=C.roleFor('/'+path);return {file,path,role,group:path.includes('/')?path.slice(0,path.lastIndexOf('/')):role};});
    renderFiles();analysis=null;meshes=[];$('axesConfirmed').checked=false;setBusy(true);say('Чтение STL и построение сечений…');
    if(worker)worker.terminate();const token=++job;
    try{
      const o=options(),data=[];appliedOptions=o;const templates=all.filter(f=>/\.acf$/i.test(f.name)),chosen=templates.find(f=>/_template\.acf$/i.test(f.name))||(templates.length===1?templates[0]:null);
      templateText=null;templateFile=null;if(chosen)await acceptTemplate(chosen);else useBuiltinTemplate();
      const foils=all.filter(f=>/\.afl$/i.test(f.name));acceptFoils(foils);
      for(const f of inputs)data.push({path:f.path,role:f.role,group:f.group,buffer:await f.file.arrayBuffer()});
      if(token!==job)return;worker=makeWorker();bindWorker(worker,token);worker.postMessage({kind:'load',files:data,parts:partSettings(),options:o},data.map(f=>f.buffer));
    }catch(e){if(token===job){say(e.message,true);setBusy(false);}}
  }
  function analyze(){if(!worker||busy)return;try{const o=options();appliedOptions=o;analysis=null;meshes=[];setBusy(true);say('Перестроение геометрии…');worker.postMessage({kind:'analyze',parts:partSettings(),options:o});}catch(e){say(e.message,true);setBusy(false);}}
  function save(data,name,type){const url=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  function report(){return {...C.report(meshes.map(m=>({...m,vertices:undefined,preview:undefined})),analysis,appliedOptions),project:$('projectName').value,axesConfirmed:$('axesConfirmed').checked,profiles:profiles(),draft,flightSettings:flightSettings(),templateFile:templateFile?.name||null};}
  function finishExport(entries){
    const name=safeName($('projectName').value),encode=t=>new TextEncoder().encode(t),rows=['body,station,z_m,point,x_m,y_m,origin'];
    for(const b of analysis.bodies)b.sections.forEach((s,i)=>s.ring.forEach((p,j)=>{if(p)rows.push(['"'+b.group.replace(/"/g,'""')+'"',i,s.z,j,...p,s.interpolatedPoints.find(x=>x.point===j)?.method||'measured-envelope'].join(','));}));
    const archive=entries.map(e=>({name:name+'/objects/'+e.name,data:encode(e.text)}));
    archive.push({name:name+'/project.json',data:encode(JSON.stringify(report(),null,2))},{name:name+'/body-sections.csv',data:encode(rows.join('\n'))},{name:name+'/README.txt',data:encode('Геометрический проект STL import.\nOBJ8 статические, в метрах: X вправо, Y вверх, Z назад. Общее начало координат сохранено.\nЭто не готовый ACF. OBJ можно добавить через Misc Objects в Plane Maker с нулевыми смещениями.\nАэродинамические корпуса/крылья, профили, рули, массы и двигатель нужно создавать отдельно.\nНаружные обводы радиальные, не точное булево объединение. Сравните с исходными срезами в project.json.\n')});
    save(OfflineZip.makeZip(archive),name+'_geometry.zip');say('ZIP геометрии подготовлен. Внутри статические OBJ8 и сечения; аэродинамический ACF пока не создаётся.');
  }
  function canvas(id){const c=$(id),r=c.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2),w=Math.max(1,r.width),h=Math.max(1,r.height);if(c.width!==Math.round(w*d)||c.height!==Math.round(h*d)){c.width=Math.round(w*d);c.height=Math.round(h*d);}const ctx=c.getContext('2d');ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);return {ctx,w,h};}
  function draw(){
    const {ctx,w,h}=canvas('viewer');if(!analysis){ctx.fillStyle='#8194a3';ctx.font='14px Segoe UI';ctx.fillText('Выберите папку проекта и проверьте направления осей',20,h/2);return;}
    let prop=null,gear=null,gearSpec=null,ground=[];
    try{if($('showProp').checked)prop=FlightSetup.propPreview(propSettings());}catch{}
    try{if($('showGear').checked){gearSpec=groundGear();gear=FlightSetup.gearGeometry(gearSpec);if(gear){const half=gearSpec.trackM/2+gear.radius*2,pad=Math.max(.03,(gearSpec.rearZM-gearSpec.frontZM)*.15);
      ground=[[-half,gear.loadedGroundY,gearSpec.frontZM-pad],[half,gear.loadedGroundY,gearSpec.frontZM-pad],[half,gear.loadedGroundY,gearSpec.rearZM+pad],[-half,gear.loadedGroundY,gearSpec.rearZM+pad]];}}}catch{}
    const b={min:analysis.bounds.min.slice(),max:analysis.bounds.max.slice()};
    for(const p of [...(prop?prop.ring:[]),...ground,...(gear?gear.centers:[])])for(let i=0;i<3;i++){b.min[i]=Math.min(b.min[i],p[i]);b.max[i]=Math.max(b.max[i],p[i]);}
    b.size=b.max.map((v,i)=>v-b.min[i]);const center=b.min.map((v,i)=>(v+b.max[i])/2),size=Math.max(...b.size)||1;
    function rotate(p){const x=p[0]-center[0],y=p[1]-center[1],z=p[2]-center[2],rx=x*Math.cos(yaw)+z*Math.sin(yaw),rz=-x*Math.sin(yaw)+z*Math.cos(yaw);return [rx,y*Math.cos(pitch)-rz*Math.sin(pitch),y*Math.sin(pitch)+rz*Math.cos(pitch)];}
    const corners=[];for(let mask=0;mask<8;mask++)corners.push(rotate([0,1,2].map(a=>(mask&(1<<a))?b.max[a]:b.min[a])));
    const width=Math.max(...corners.map(p=>p[0]))-Math.min(...corners.map(p=>p[0])),height=Math.max(...corners.map(p=>p[1]))-Math.min(...corners.map(p=>p[1]));
    const scale=Math.min((w-90)/(width||size),(h-80)/(height||size))*zoom;
    function project(p){const r=rotate(p);return [w/2+panX+r[0]*scale,h/2+panY-r[1]*scale,r[2]];}
    const triangles=[];for(const m of meshes){const v=m.preview;for(let i=0;i<v.length;i+=9){const p=[0,1,2].map(j=>project([v[i+j*3],v[i+j*3+1],v[i+j*3+2]]));triangles.push({p,color:colors[m.role]||'#888',depth:p.reduce((n,p)=>n+p[2],0)});}}
    triangles.sort((a,b)=>b.depth-a.depth);ctx.lineWidth=.4;
    for(const t of triangles){ctx.beginPath();t.p.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fillStyle=t.color+'28';ctx.strokeStyle=t.color+'65';ctx.fill();ctx.stroke();}
    if($('showSections').checked){ctx.lineWidth=.8;for(const body of analysis.bodies)for(const s of body.sections){const filled=new Set(s.interpolatedPoints.map(p=>p.point));for(let i=0;i<s.ring.length;i++){const j=(i+1)%s.ring.length,a=s.ring[i],b=s.ring[j];if(!a||!b)continue;ctx.strokeStyle=filled.has(i)||filled.has(j)?'#25896bcc':'#db883dcc';ctx.beginPath();ctx.moveTo(...project([a[0],a[1],s.z]).slice(0,2));ctx.lineTo(...project([b[0],b[1],s.z]).slice(0,2));ctx.stroke();}}}
    if(draft&&$('showDraft').checked){
      ctx.strokeStyle='#924fbed9';ctx.lineWidth=1.6;const lines=P.planform(draft);
      for(const body of draft.bodies)for(const [index,s]of body.sections.entries()){
        const ring=P.bodyRing(s),end=draft.closeCaps&&(index===0||index===body.sections.length-1);
        for(let i=0;i<ring.length;i++){
          const a=ring[i],b=ring[(i+1)%ring.length];
          if(a&&b)lines.push([[...a,s.z],[...b,s.z]]);
          if(end&&a&&i%4===0)lines.push([[s.cx,s.cy,s.z],[...a,s.z]]);
        }
      }
      for(const [a,b]of lines){ctx.beginPath();ctx.moveTo(...project(a).slice(0,2));ctx.lineTo(...project(b).slice(0,2));ctx.stroke();}
    }
    function path3(points,close=false){ctx.beginPath();points.forEach((p,i)=>{const xy=project(p);i?ctx.lineTo(xy[0],xy[1]):ctx.moveTo(xy[0],xy[1]);});if(close)ctx.closePath();}
    function label3(point,text,color){const p=project(point);ctx.font='bold 12px Segoe UI';const x=Math.max(8,Math.min(w-ctx.measureText(text).width-8,p[0]+10)),y=Math.max(18,Math.min(h-8,p[1]-10));ctx.lineWidth=4;ctx.strokeStyle='#f6f9fb';ctx.strokeText(text,x,y);ctx.fillStyle=color;ctx.fillText(text,x,y);}
    if(gear){
      ctx.lineWidth=1;ctx.strokeStyle='#25896b99';ctx.fillStyle='#25896b0b';ctx.setLineDash([5,4]);path3(ground,true);ctx.fill();ctx.stroke();ctx.setLineDash([]);
      gear.centers.forEach((p,i)=>{
        const contour=gearSpec.type===1?[[p[0]-gearSpec.widthM/2,p[1]-gear.radius,p[2]-gear.radius],[p[0]+gearSpec.widthM/2,p[1]-gear.radius,p[2]-gear.radius],[p[0]+gearSpec.widthM/2,p[1]-gear.radius,p[2]+gear.radius],[p[0]-gearSpec.widthM/2,p[1]-gear.radius,p[2]+gear.radius]]:
          Array.from({length:32},(_,j)=>[p[0],p[1]+gear.radius*Math.sin(j*Math.PI/16),p[2]+gear.radius*Math.cos(j*Math.PI/16)]);
        ctx.strokeStyle='#25896b';ctx.lineWidth=2;path3(contour,true);ctx.stroke();const q=project(p);ctx.fillStyle='#25896b';ctx.beginPath();ctx.arc(q[0],q[1],3,0,2*Math.PI);ctx.fill();label3(p,'Опора '+(i+1),'#25896b');
      });
      label3(ground[2],'Земля · под нагрузкой','#25896b');
    }
    if(prop){
      path3(prop.ring,true);ctx.fillStyle='#dc83251c';ctx.strokeStyle='#d67b16';ctx.lineWidth=2;ctx.fill();ctx.stroke();
      const c=prop.center;ctx.strokeStyle='#d67b16';
      for(const a of [0,1]){const p=c.slice(),q=c.slice();p[a]-=prop.radius*.3;q[a]+=prop.radius*.3;path3([p,q]);ctx.stroke();}
      path3([c,[c[0],c[1],c[2]-prop.radius*.6]]);ctx.stroke();label3(prop.ring[16],'Винт · Ø'+number(prop.radius*2000,1)+' мм','#b7650a');
    }
    if($('flightEnabled').checked&&draft){try{const m=FlightSetup.mac(draft,P),percent=Number($('cgPercent').value),y=Number($('cgY').value)/1000,z=m.leadingEdgeZM+percent/100*m.chordM;
      if(Number.isFinite(z)&&Number.isFinite(y)){const p=project([0,y,z]);ctx.strokeStyle='#b83351';ctx.fillStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p[0],p[1],7,0,2*Math.PI);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(p[0]-11,p[1]);ctx.lineTo(p[0]+11,p[1]);ctx.moveTo(p[0],p[1]-11);ctx.lineTo(p[0],p[1]+11);ctx.stroke();ctx.fillStyle='#b83351';ctx.font='bold 13px Segoe UI';ctx.fillText('ЦТ · '+number(percent)+'% САХ',p[0]+12,p[1]-10);}
    }catch{}}
    ctx.fillStyle='#62778a';ctx.font='12px Segoe UI';ctx.fillText('Оси исходного STL',14,23);
    const origin=center,from=project(origin);
    for(const [axis,sign,color,name,sourceAxis]of [[0,1,'#c34747','Право',appliedOptions.right],[1,1,'#32916b','Вверх',appliedOptions.up],[2,-1,'#326dc4','Нос',appliedOptions.nose]]){
      const p=origin.slice();p[axis]+=size*.3*sign;
      const to=project(p),angle=Math.atan2(to[1]-from[1],to[0]-from[0]);
      ctx.strokeStyle=ctx.fillStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(...from.slice(0,2));ctx.lineTo(...to.slice(0,2));ctx.stroke();
      ctx.beginPath();ctx.moveTo(to[0],to[1]);ctx.lineTo(to[0]-9*Math.cos(angle-.4),to[1]-9*Math.sin(angle-.4));ctx.lineTo(to[0]-9*Math.cos(angle+.4),to[1]-9*Math.sin(angle+.4));ctx.fill();
      const label=sourceAxis.replace('-','−')+' · '+name;ctx.font='bold 13px Segoe UI';
      const x=Math.max(8,Math.min(w-ctx.measureText(label).width-8,to[0]+7)),y=Math.max(40,Math.min(h-8,to[1]-5));
      ctx.lineWidth=4;ctx.strokeStyle='#f6f9fb';ctx.strokeText(label,x,y);ctx.fillText(label,x,y);
    }
  }
  function drawSlice(){
    const {ctx,w,h}=canvas('sliceCanvas'),body=analysis?.bodies[Number($('bodySelect').value)||0];if(!body)return;
    $('sliceIndex').max=body.sections.length-1;const s=body.sections[Math.min(Number($('sliceIndex').value),body.sections.length-1)];
    $('sliceLabel').textContent=`Z = ${number(s.z*1000,2)} мм · сегментов STL: ${s.segments.length} · достроено точек: ${s.interpolatedPoints.length} · не восстановлено: ${s.remainingMissing}`;
    const points=[...s.segments.flat(),...s.ring.filter(Boolean)];if(!points.length){ctx.fillStyle='#a65a33';ctx.font='14px Segoe UI';ctx.fillText('Нет пересечений: разрыв между деталями или край корпуса',15,h/2);return;}
    let min=[Infinity,Infinity],max=[-Infinity,-Infinity];for(const p of points)for(let a=0;a<2;a++){min[a]=Math.min(min[a],p[a]);max[a]=Math.max(max[a],p[a]);}
    const scale=Math.min((w-50)/(max[0]-min[0]||1),(h-45)/(max[1]-min[1]||1)),project=p=>[w/2+(p[0]-(min[0]+max[0])/2)*scale,h/2-(p[1]-(min[1]+max[1])/2)*scale];
    ctx.strokeStyle='#8f9daa';ctx.lineWidth=.8;ctx.beginPath();for(const [a,b]of s.segments){ctx.moveTo(...project(a));ctx.lineTo(...project(b));}ctx.stroke();
    const filled=new Set(s.interpolatedPoints.map(p=>p.point));ctx.lineWidth=2;for(let i=0;i<s.ring.length;i++){const j=(i+1)%s.ring.length,a=s.ring[i],b=s.ring[j];if(a&&b){ctx.strokeStyle=filled.has(i)||filled.has(j)?'#25896b':'#df8836';ctx.beginPath();ctx.moveTo(...project(a));ctx.lineTo(...project(b));ctx.stroke();}}
  }
  $('folderInput').addEventListener('change',e=>load(e.target.files));$('analyze').addEventListener('click',analyze);
  $('cancel').addEventListener('click',()=>{job++;if(worker)worker.terminate();worker=null;analysis=null;draft=null;pendingResample=null;meshes=[];$('draftEditors').replaceChildren();setBusy(false);$('analyze').disabled=true;say('Операция отменена. Выберите папку заново для загрузки.');draw();drawSlice();});
  for(const id of ['unit','factor','longAxis','frontSign','upAxis','upSign','stations','radii','repairGaps','maxGapDegrees','maxGapLength'])$(id).addEventListener('change',invalidate);
  $('axesConfirmed').addEventListener('change',updateDownloads);$('projectName').addEventListener('input',()=>{$('modelTitle').textContent=$('projectName').value;});
  $('foilFolderInput').addEventListener('change',e=>acceptFoils(e.target.files));$('templateInput').addEventListener('change',e=>acceptTemplate(e.target.files[0]));
  for(const id of ['wingRoot','wingTip','horizontalFoil','verticalFoil'])$(id).addEventListener('input',updateDownloads);
  $('closeCaps').addEventListener('change',draftChanged);$('showDraft').addEventListener('change',draw);
  $('flightEnabled').addEventListener('change',()=>{updateDownloads();draw();});
  const flightEdited=()=>{
    $('flightEnabled').checked=true;
    // Preview placement must update even while other flight inputs are invalid.
    draw();updateDownloads();
  };
  for(const el of $('flightPanel').querySelectorAll('input,select'))if(el.id!=='flightEnabled'){
    el.addEventListener('input',flightEdited);
    el.addEventListener('change',flightEdited);
  }
  for(const el of $('gearPanel').querySelectorAll('input,select'))el.addEventListener(el.type==='checkbox'?'change':'input',()=>{$('flightEnabled').checked=true;updateDownloads();draw();});
  for(const id of ['showProp','showGear'])$(id).addEventListener('change',draw);
  $('downloadAcfZip').addEventListener('click',async()=>{
    if(busy||acfReason())return;const token=job;setBusy(true);say('Сборка расчётной геометрии ACF…');
    try{const p=profiles(),flight=flightSettings(),parsed=new Map(),bytes=new Map();for(const name of new Set([...Object.values(p).filter(Boolean),...(flight?[flight.propFoil]:[])])){const file=foilFiles.get(name.toLowerCase()).file,data=new Uint8Array(await file.arrayBuffer());bytes.set(name,data);parsed.set(name,P.parseAFL(new TextDecoder('utf-8',{fatal:true}).decode(data),name));}
      if(token!==job)return;const name=safeName($('projectName').value),result=P.buildACF(templateText,draft,p,parsed,name,flight),encode=s=>new TextEncoder().encode(s);
      const entries=[{name:name+'/'+name+'_import.acf',data:encode(result.text)}];
      if($('includeFoils').checked)for(const foil of result.requiredAirfoils)entries.push({name:name+'/Airfoils/'+foil,data:bytes.get(foil)});
      const {text,...details}=result;entries.push({name:name+'/import-report.json',data:encode(JSON.stringify({...report(),acf:details},null,2))},{name:name+'/README_ACF.txt',data:encode('Экспериментальная модель ACF 1200.\nОткройте и сохраните ACF в Plane Maker 12 перед использованием.\nПроверьте корпуса, положение крыльев и оперения, профили AFL и закрытие торцов.\nПарные поверхности зеркальные; оперение не входит в Wings 1–4.\n'+(flight?'Масса, ЦТ и предварительная электрическая силовая установка заданы: см. import-report.json. Полная масса без дополнительной загрузки/топлива. Инерция, шасси, скорости и рули требуют настройки.':'Масса, CG, инерция, двигатель, шасси, скорости и рули НЕ НАСТРОЕНЫ.')+' Это не готовая лётная модель.\nЕсли AFL не включены в ZIP, они должны быть в Airfoils установленного X-Plane.\n')});
      save(OfflineZip.makeZip(entries),name+'_acf.zip');say('ACF подготовлен. Откройте его в Plane Maker, проверьте геометрию'+(flight?', массу, ЦТ и винт':'')+' и сохраните.');
    }catch(e){if(token===job)say(e.message,true);}finally{if(token===job)setBusy(false);}
  });
  $('downloadJson').addEventListener('click',()=>{if(analysis&&!busy&&$('axesConfirmed').checked)save(JSON.stringify(report(),null,2),safeName($('projectName').value)+'_geometry.json','application/json');});
  $('downloadZip').addEventListener('click',()=>{if(!analysis||busy||!$('axesConfirmed').checked)return;pendingExport=true;setBusy(true);say('Подготовка OBJ8 по полной сетке…');worker.postMessage({kind:'export'});});
  $('bodySelect').addEventListener('change',drawSlice);$('sliceIndex').addEventListener('input',drawSlice);$('showSections').addEventListener('change',draw);
  for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{const v=button.dataset.view;[yaw,pitch]=v==='top'?[0,Math.PI/2]:v==='side'?[Math.PI/2,0]:v==='front'?[0,0]:[.55,.5];zoom=1;panX=panY=0;for(const b of document.querySelectorAll('[data-view]'))b.classList.toggle('selected',b===button);draw();});
  $('viewer').addEventListener('contextmenu',e=>e.preventDefault());
  $('viewer').addEventListener('pointerdown',e=>{
    if(drag||![0,2].includes(e.button))return;e.preventDefault();
    drag={x:e.clientX,y:e.clientY,id:e.pointerId,rotate:e.button===2};$('viewer').setPointerCapture(e.pointerId);$('viewer').style.cursor='grabbing';
  });
  $('viewer').addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.id)return;
    if(!(e.buttons&(drag.rotate?2:1))){drag=null;$('viewer').style.cursor='';return;}
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(drag.rotate){yaw+=dx*.008;pitch=Math.max(-Math.PI/2,Math.min(Math.PI/2,pitch+dy*.008));}
    else{panX+=dx;panY+=dy;}
    drag.x=e.clientX;drag.y=e.clientY;draw();
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])$('viewer').addEventListener(event,e=>{
    if(drag&&e.pointerId!==drag.id)return;drag=null;$('viewer').style.cursor='';
  });
  $('viewer').addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.2,Math.min(8,zoom*Math.exp(-e.deltaY*.001)));draw();},{passive:false});
  new ResizeObserver(()=>{draw();drawSlice();}).observe($('viewer'));options();useBuiltinTemplate();acceptFoils([]);updateDownloads();draw();
})();
