var _sd = {nom:'',agents:[],zones:{},buts_par_agent:{},evenements:[]};
var _htnSub = 'actions';
var _htnSel = null;
var _htnRaw = {actions:'',methods:'',tasks:''};
var _htnData = {actions:[],methods:[],tasks:[]};
var _running = false;
var _interval = null;
var _lastAgs = {};
var _agColors = {};
var COLORS = ['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#84cc16'];
var TASK_TYPES = ['patrouiller','intercepter','engager','escorter','rechercher_zone','naviguer_vers_point','stopper','suivre_agent','spawn_agent'];
var MODELS = ['fremm','lrauv','x500','autre'];

function switchTab(id, el) {
  document.querySelectorAll('.tab-panel').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.remove('active');});
  document.getElementById('tp-'+id).classList.add('active');
  el.classList.add('active');
  if(id==='htn') loadHTN();
  if(id==='scenario') loadScenario();
  if(id==='map') initMap();
}

// ── HTN ──────────────────────────────────────────────────────────────
function loadHTN() {
  var files = ['actions','methods','tasks'];
  var proms = files.map(function(f){
    return fetch('/api/fichier/'+f).then(function(r){return r.json();}).then(function(d){_htnRaw[f]=d.contenu;});
  });
  Promise.all(proms).then(function(){parseHTN();renderHTNList();});
}

function parseHTN() {
  var fnRe = /^def (\w+)\(state(?:,\s*(.*?))?\)\s*:/gm;
  _htnData.actions = []; _htnData.methods = [];
  var m;
  while((m=fnRe.exec(_htnRaw.actions))!==null)
    _htnData.actions.push({name:m[1],params:(m[2]||'').split(',').map(function(p){return p.trim();}).filter(Boolean)});
  fnRe.lastIndex=0;
  while((m=fnRe.exec(_htnRaw.methods))!==null) {
    if(m[1].charAt(0)==='_') continue;
    _htnData.methods.push({name:m[1],params:(m[2]||'').split(',').map(function(p){return p.trim();}).filter(Boolean)});
  }
  _htnData.tasks=[];
  var tRe=/"(\w+)"\s*:/g;
  while((m=tRe.exec(_htnRaw.tasks))!==null)
    if(!_htnData.tasks.find(function(t){return t.name===m[1];})) _htnData.tasks.push({name:m[1]});
}

function htnSub(name,el) {
  _htnSub=name; _htnSel=null;
  document.querySelectorAll('.htn-stab').forEach(function(b){b.classList.remove('active');});
  el.classList.add('active');
  renderHTNList();
  document.getElementById('htn-main').innerHTML='<div class="htn-empty"><div><div style="font-size:36px;margin-bottom:10px">&#9672;</div>Selectionnez un element</div></div>';
}

function renderHTNList() {
  var items=_htnData[_htnSub]||[];
  var IC={actions:'ic-a',methods:'ic-m',tasks:'ic-t'};
  var EM={actions:'&#9881;',methods:'&#8644;',tasks:'&#127919;'};
  document.getElementById('htn-list').innerHTML=items.map(function(it,i){
    return '<div class="htn-item'+((_htnSel===i)?' sel':'')+'" onclick="selHTN('+i+')">'
      +'<div class="htn-icon '+IC[_htnSub]+'">'+EM[_htnSub]+'</div>'
      +'<div><div class="htn-iname">'+it.name+'</div>'
      +'<div class="htn-iparams">'+((it.params||[]).join(', ')||'-')+'</div></div></div>';
  }).join('');
}

function selHTN(i) {
  _htnSel=i; renderHTNList();
  var it=(_htnData[_htnSub]||[])[i]; if(!it) return;
  var TAG={actions:'Action',methods:'Methode',tasks:'Tache'};
  var BG={actions:'#dcfce7',methods:'#fef3c7',tasks:'#ede9fe'};
  var code=getCode(it.name);
  document.getElementById('htn-main').innerHTML=
    '<div class="htn-card">'
    +'<h3><span style="background:'+BG[_htnSub]+';padding:3px 9px;border-radius:6px;font-size:12px">'+TAG[_htnSub]+'</span> '+it.name+'</h3>'
    +'<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Parametres</div>'
    +'<div class="chips">'+((it.params&&it.params.length)?it.params.map(function(p){return '<span class="chip">'+p+'</span>';}).join(''):'<span style="color:#9ca3af;font-size:12px">Aucun parametre</span>')+'</div></div>'
    +'<div><div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Code source</div>'
    +'<div class="code-pre">'+code+'</div></div></div>';
}

function getCode(name) {
  var src=_htnRaw[_htnSub]; var lines=src.split('\n');
  var out=[]; var started=false; var count=0;
  for(var i=0;i<lines.length;i++) {
    var line=lines[i];
    if(!started && new RegExp('^def '+name+'\\s*\\(').test(line)) started=true;
    if(started) {
      out.push(esc(line)); count++;
      if(count>2 && line.trim()==='') break;
      if(count>25) break;
    }
  }
  return out.join('\n')||'(non trouve)';
}

function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// ── SCENARIO ─────────────────────────────────────────────────────────
function loadScenario() {
  fetch('/api/scenario').then(function(r){return r.json();}).then(function(d){
    _sd=d;
    _sd.agents=_sd.agents||[]; _sd.zones=_sd.zones||{};
    _sd.buts_par_agent=_sd.buts_par_agent||{}; _sd.evenements=_sd.evenements||[];
    document.getElementById('snom').value=_sd.nom||'';
    assignColors(); renderAll();
  });
}

function assignColors() {
  (_sd.agents||[]).forEach(function(ag,i){if(!_agColors[ag.nom])_agColors[ag.nom]=COLORS[i%COLORS.length];});
}

function renderAll(){renderAgentRows();renderZones();renderEvts();}

function renderAgentRows() {
  var el=document.getElementById('ag-rows');
  if(!_sd.agents.length){el.innerHTML='<div class="no-agents">Aucun agent. Cliquez sur "+ Agent".</div>';return;}
  el.innerHTML=_sd.agents.map(function(ag,ai){
    var col=_agColors[ag.nom]||COLORS[ai%COLORS.length];
    var buts=(_sd.buts_par_agent[ag.nom]||[]);
    return '<div class="agent-row">'
      +'<div class="agent-box" style="border-color:'+col+'60;background:'+col+'0e">'
      +'<div class="agent-title" style="color:'+col+'">&#128674; '+ag.nom
        +' <button class="btn btn-danger btn-xs" onclick="rmAgent('+ai+')">x</button></div>'
      +'<label>Nom</label><input type="text" value="'+ag.nom+'" oninput="upAg('+ai+',\'nom\',this.value)">'
      +'<label>Modele</label><select onchange="upAg('+ai+',\'modele\',this.value)">'
        +MODELS.map(function(m){return '<option'+(ag.modele===m?' selected':'')+'>'+m+'</option>';}).join('')
      +'</select>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">'
        +'<div><label>X (m)</label><input type="number" value="'+ag.x+'" oninput="upAg('+ai+',\'x\',+this.value)"></div>'
        +'<div><label>Y (m)</label><input type="number" value="'+ag.y+'" oninput="upAg('+ai+',\'y\',+this.value)"></div>'
      +'</div>'
      +'<label>Vitesse (m/s)</label><input type="number" step="0.5" value="'+ag.vitesse+'" oninput="upAg('+ai+',\'vitesse\',+this.value)">'
      +'</div>'
      +'<div class="chain-arr">&#10132;</div>'
      +'<div class="chain">'
        +buts.map(function(but,bi){return taskBlock(ag.nom,bi,but,bi>0);}).join('')
        +'<button class="add-task" onclick="addTask(\''+ag.nom+'\')">+ Tache</button>'
      +'</div></div>';
  }).join('');
}

function taskBlock(agNom,bi,but,showArr) {
  var type=but[0]||'';
  var zoneNames=Object.keys(_sd.zones||{});
  var argHtml='';
  if(type==='patrouiller'||type==='rechercher_zone') {
    argHtml='<label>Zone</label><select class="task-arg" onchange="setTaskArg(\''+agNom+'\','+bi+',2,this.value)">'
      +zoneNames.map(function(z){return '<option'+(but[2]===z?' selected':'')+'>'+z+'</option>';}).join('')
      +(!zoneNames.length?'<option value="">-- aucune zone --</option>':'')+'</select>';
  } else if(['intercepter','engager','escorter','suivre_agent'].indexOf(type)>=0) {
    argHtml='<label>Cible</label><input type="text" value="'+(but[2]||'cible')+'" oninput="setTaskArg(\''+agNom+'\','+bi+',2,this.value)" placeholder="nom cible">';
  } else if(type==='naviguer_vers_point') {
    argHtml='<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">'
      +'<div><label>X</label><input type="number" value="'+(but[2]||0)+'" oninput="setTaskArg(\''+agNom+'\','+bi+',2,+this.value)"></div>'
      +'<div><label>Y</label><input type="number" value="'+(but[3]||0)+'" oninput="setTaskArg(\''+agNom+'\','+bi+',3,+this.value)"></div>'
      +'</div>';
  } else if(type==='spawn_agent') {
    argHtml='<label>Modele</label><input type="text" value="'+(but[2]||'x500')+'" oninput="setTaskArg(\''+agNom+'\','+bi+',2,this.value)">';
  }
  return (showArr?'<div class="chain-arr">&#10132;</div>':'')
    +'<div class="task-blk"><div class="task-blk-top">'
    +'<select onchange="setTaskType(\''+agNom+'\','+bi+',this.value)">'
      +TASK_TYPES.map(function(t){return '<option'+(t===type?' selected':'')+'>'+t+'</option>';}).join('')
    +'</select>'
    +'<button class="task-blk-rm" onclick="rmTask(\''+agNom+'\','+bi+')">x</button>'
    +'</div>'+argHtml+'</div>';
}

function upAg(ai,field,val) {
  if(!_sd.agents[ai]) return;
  var old=_sd.agents[ai].nom;
  _sd.agents[ai][field]=val;
  if(field==='nom'){
    var buts=_sd.buts_par_agent[old];
    if(buts){_sd.buts_par_agent[val]=buts;delete _sd.buts_par_agent[old];}
    _agColors[val]=_agColors[old]; delete _agColors[old];
  }
}

function rmAgent(ai){
  var nom=_sd.agents[ai].nom;
  _sd.agents.splice(ai,1); delete _sd.buts_par_agent[nom]; renderAgentRows();
}

function addAgent(){
  var nom='agent'+_sd.agents.length;
  _sd.agents.push({nom:nom,modele:'fremm',x:0,y:0,vitesse:5.0,dispo:1});
  _agColors[nom]=COLORS[_sd.agents.length%COLORS.length];
  _sd.buts_par_agent[nom]=[]; renderAgentRows();
}

function addTask(agNom){
  if(!_sd.buts_par_agent[agNom]) _sd.buts_par_agent[agNom]=[];
  _sd.buts_par_agent[agNom].push(['patrouiller',agNom,'']); renderAgentRows();
}

function rmTask(agNom,bi){
  if(_sd.buts_par_agent[agNom]) _sd.buts_par_agent[agNom].splice(bi,1); renderAgentRows();
}

function setTaskType(agNom,bi,val){
  if(!_sd.buts_par_agent[agNom]||!_sd.buts_par_agent[agNom][bi]) return;
  _sd.buts_par_agent[agNom][bi]=[val,agNom,'']; renderAgentRows();
}

function setTaskArg(agNom,bi,idx,val){
  var but=(_sd.buts_par_agent[agNom]||[])[bi]; if(!but) return;
  while(but.length<=idx) but.push(''); but[idx]=val;
}

function renderZones(){
  var el=document.getElementById('zones-row');
  var entries=Object.entries(_sd.zones||{});
  el.innerHTML=entries.length?entries.map(function(kv){
    var nom=kv[0]; var z=kv[1];
    return '<div class="zone-card"><div class="zone-card-top">'
      +'<span class="zone-card-title">&#128205; '+nom+'</span>'
      +'<button class="btn btn-danger btn-xs" onclick="rmZone(\''+nom+'\')">x</button></div>'
      +'<label style="font-size:10px;color:#78350f;font-weight:600">Points [[x,y],...]</label>'
      +'<textarea rows="2" id="zw-'+nom+'" style="border-color:#fdba74;border-radius:4px" onchange="upZoneWP(\''+nom+'\',this.value)">'+JSON.stringify(z.waypoints||[])+'</textarea>'
      +'</div>';
  }).join(''):'<div style="color:#9ca3af;font-size:12px;padding:0 4px">Aucune zone definie</div>';
}

function addZone(){
  var nom=prompt('Nom de la zone :'); if(!nom) return;
  _sd.zones[nom]={waypoints:[[0,0],[200,0],[200,200],[0,200]]}; renderZones();
}

function rmZone(nom){delete _sd.zones[nom]; renderZones();}
function upZoneWP(nom,val){try{_sd.zones[nom].waypoints=JSON.parse(val);}catch(e){}}

function renderEvts(){
  var el=document.getElementById('evts-list');
  el.innerHTML=(_sd.evenements||[]).map(function(evt,i){
    var q=evt.quand||[]; var a=evt.alors||{}; var q0=q[0]||[];
    return '<div class="evt-card"><div class="evt-card-top">'
      +'<input class="evt-name-in" type="text" value="'+(evt.nom||'')+'" oninput="upEvt('+i+',\'nom\',this.value)">'
      +'<button class="btn btn-danger btn-xs" onclick="rmEvt('+i+')">x</button></div>'
      +'<div class="evt-grid">'
      +'<div><label>Agent surveille</label><select onchange="upEvtQ('+i+',0,1,this.value)">'
        +(_sd.agents||[]).map(function(ag){return '<option'+(q0[1]===ag.nom?' selected':'')+'>'+ag.nom+'</option>';}).join('')+'</select></div>'
      +'<div><label>Operateur</label><select onchange="upEvtQ('+i+',0,2,this.value)">'
        +['inferieur','superieur','egal'].map(function(op){return '<option'+(q0[2]===op?' selected':'')+'>'+op+'</option>';}).join('')+'</select></div>'
      +'<div><label>Seuil</label><input type="number" value="'+(q0[3]||600)+'" oninput="upEvtQ('+i+',0,3,+this.value)"></div>'
      +'<div><label>Cible variable</label><input type="text" value="'+(q0[4]||'cible')+'" oninput="upEvtQ('+i+',0,4,this.value)"></div>'
      +'<div><label>Action - Agent</label><select onchange="upEvtA('+i+',\'agent\',this.value)">'
        +(_sd.agents||[]).map(function(ag){return '<option'+(a.agent===ag.nom?' selected':'')+'>'+ag.nom+'</option>';}).join('')+'</select></div>'
      +'<div><label>Tache declenchee</label><select onchange="upEvtTask('+i+',this.value)">'
        +TASK_TYPES.map(function(t){return '<option'+(((a.but||[])[0])===t?' selected':'')+'>'+t+'</option>';}).join('')+'</select></div>'
      +'<div><label>Rearmable</label><select onchange="upEvt('+i+',\'rearmable\',this.value===\'Oui\')">'
        +'<option'+(evt.rearmable?' selected':'')+'>Oui</option><option'+(!evt.rearmable?' selected':'')+'>Non</option>'
      +'</select></div>'
      +'</div></div>';
  }).join('')||'<div style="color:#9ca3af;font-size:12px">Aucun evenement defini</div>';
}

function upEvt(i,f,v){if(_sd.evenements[i])_sd.evenements[i][f]=v;}
function upEvtQ(i,ci,fi,v){
  var e=_sd.evenements[i]; if(!e) return;
  e.quand=e.quand||[]; while(e.quand.length<=ci) e.quand.push([]);
  var c=e.quand[ci]; while(c.length<=fi) c.push(''); c[0]='distance'; c[fi]=v;
}
function upEvtA(i,f,v){var e=_sd.evenements[i];if(!e)return;e.alors=e.alors||{};e.alors[f]=v;}
function upEvtTask(i,t){
  var e=_sd.evenements[i]; if(!e) return; e.alors=e.alors||{};
  var agNom=e.alors.agent||((_sd.agents[0]||{}).nom||'');
  e.alors.but=[t,agNom,'cible'];
}
function addEvt(){
  var agNom=(_sd.agents[0]||{}).nom||'agent0';
  _sd.evenements.push({nom:'evenement_'+_sd.evenements.length,
    quand:[['distance',agNom,'inferieur',600,'cible']],
    alors:{agent:agNom,but:['intercepter',agNom,'cible']},rearmable:false});
  renderEvts();
}
function rmEvt(i){_sd.evenements.splice(i,1);renderEvts();}

function saveScenario(){
  _sd.nom=document.getElementById('snom').value;
  fetch('/api/scenario',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(_sd)})
    .then(function(r){return r.json();}).then(function(d){
      showToast('smsg',d.ok?'Sauvegarde !':d.erreur||'Erreur',d.ok);
      if(d.ok) document.getElementById('hdr-scen').textContent=_sd.nom;
    });
}

// ── MAP ──────────────────────────────────────────────────────────────
function initMap(){resizeCanvas();renderAgLegend(_lastAgs);drawMap(_lastAgs);}

function resizeCanvas(){
  var area=document.getElementById('map-area');
  var r=area.getBoundingClientRect();
  var c=document.getElementById('map-canvas');
  c.width=Math.max(400,r.width-24); c.height=Math.max(300,r.height-24);
}

function renderAgLegend(ags){
  var keys=Object.keys(ags);
  var html=keys.length
    ?keys.map(function(n){var a=ags[n];var col=_agColors[n]||COLORS[0];
       return '<div class="ag-leg"><div class="ag-dot" style="background:'+col+'"></div><div>'
         +'<div>'+n+' <span style="color:#9ca3af">'+a.modele+'</span></div>'
         +'<div style="font-size:11px;color:#6b7280">'+Math.round(a.x)+'m, '+Math.round(a.y)+'m - '+a.phase+'</div>'
         +'</div></div>';}).join('')
    :(_sd.agents||[]).map(function(ag,i){return '<div class="ag-leg"><div class="ag-dot" style="background:'+(_agColors[ag.nom]||COLORS[i%COLORS.length])+'"></div><span>'+ag.nom+'</span></div>';}).join('')
      ||'<div style="color:#9ca3af;font-size:12px">Aucun agent</div>';
  document.getElementById('ag-legend').innerHTML=html;
}

var MAP_MAR=40;

function drawMap(agMap){
  var canvas=document.getElementById('map-canvas');
  var ctx=canvas.getContext('2d');
  var W=canvas.width; var H=canvas.height;
  var pts=[];
  var agKeys=Object.keys(agMap);
  if(agKeys.length) agKeys.forEach(function(k){var a=agMap[k];pts.push([a.x,a.y]);});
  else (_sd.agents||[]).forEach(function(a){pts.push([a.x,a.y]);});
  Object.values(_sd.zones||{}).forEach(function(z){(z.waypoints||[]).forEach(function(p){pts.push(p);});});
  var minX=-100,maxX=100,minY=-100,maxY=100;
  if(pts.length){
    minX=Math.min.apply(null,pts.map(function(p){return p[0];}));
    maxX=Math.max.apply(null,pts.map(function(p){return p[0];}));
    minY=Math.min.apply(null,pts.map(function(p){return p[1];}));
    maxY=Math.max.apply(null,pts.map(function(p){return p[1];}));
    var px=Math.max((maxX-minX)*0.15,80),py2=Math.max((maxY-minY)*0.15,80);
    minX-=px;maxX+=px;minY-=py2;maxY+=py2;
  }
  var scx=(W-2*MAP_MAR)/(maxX-minX)||1;
  var scy=(H-2*MAP_MAR)/(maxY-minY)||1;
  var sc=Math.min(scx,scy);
  function ts(x,y){return {px:MAP_MAR+(x-minX)*sc, py:H-MAP_MAR-(y-minY)*sc};}
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);
  var rng=Math.max(maxX-minX,maxY-minY);
  var logv=Math.floor(Math.log(rng/5)/Math.LN10)||0;
  var gs=Math.pow(10,logv);
  ctx.strokeStyle='#f3f4f6';ctx.lineWidth=1;
  for(var gx=Math.ceil(minX/gs)*gs;gx<=maxX;gx+=gs){
    var p1=ts(gx,0); ctx.beginPath();ctx.moveTo(p1.px,0);ctx.lineTo(p1.px,H);ctx.stroke();
    ctx.fillStyle='#d1d5db';ctx.font='9px sans-serif';ctx.textAlign='center';ctx.fillText(Math.round(gx)+'m',p1.px,H-4);
  }
  for(var gy=Math.ceil(minY/gs)*gs;gy<=maxY;gy+=gs){
    var p2=ts(0,gy); ctx.beginPath();ctx.moveTo(0,p2.py);ctx.lineTo(W,p2.py);ctx.stroke();
    ctx.fillStyle='#d1d5db';ctx.font='9px sans-serif';ctx.textAlign='left';ctx.fillText(Math.round(gy)+'m',2,p2.py-2);
  }
  Object.entries(_sd.zones||{}).forEach(function(kv){
    var nom=kv[0];var z=kv[1];var wps=z.waypoints||[];
    if(wps.length<2) return;
    ctx.beginPath();
    wps.forEach(function(wp,i){var p=ts(wp[0],wp[1]);i?ctx.lineTo(p.px,p.py):ctx.moveTo(p.px,p.py);});
    ctx.closePath();ctx.fillStyle='rgba(251,191,36,.08)';ctx.fill();
    ctx.strokeStyle='#fbbf24';ctx.lineWidth=1.5;ctx.setLineDash([5,4]);ctx.stroke();ctx.setLineDash([]);
    var cx=wps.reduce(function(s,p){return s+p[0];},0)/wps.length;
    var cy=wps.reduce(function(s,p){return s+p[1];},0)/wps.length;
    var cp=ts(cx,cy);ctx.fillStyle='#d97706';ctx.font='11px sans-serif';ctx.textAlign='center';ctx.fillText(nom,cp.px,cp.py);
  });
  var agList=agKeys.length
    ?agKeys.map(function(n){var a=agMap[n];return {n:n,x:a.x,y:a.y,phase:a.phase};})
    :(_sd.agents||[]).map(function(a){return {n:a.nom,x:a.x,y:a.y,phase:'init'};});
  for(var i=0;i<agList.length;i++) for(var j=i+1;j<agList.length;j++){
    var a=agList[i];var b=agList[j];
    var d=Math.sqrt((a.x-b.x)*(a.x-b.x)+(a.y-b.y)*(a.y-b.y));
    if(d<2000){
      var pa=ts(a.x,a.y);var pb=ts(b.x,b.y);
      ctx.beginPath();ctx.moveTo(pa.px,pa.py);ctx.lineTo(pb.px,pb.py);
      ctx.strokeStyle=d<600?'rgba(239,68,68,.25)':'rgba(251,191,36,.2)';
      ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.stroke();ctx.setLineDash([]);
    }
  }
  agList.forEach(function(ag){
    var col=_agColors[ag.n]||COLORS[0];var p=ts(ag.x,ag.y);
    ctx.beginPath();ctx.arc(p.px,p.py,9,0,2*Math.PI);ctx.fillStyle=col+'22';ctx.fill();
    ctx.beginPath();ctx.arc(p.px,p.py,6,0,2*Math.PI);ctx.fillStyle=col;ctx.fill();
    ctx.strokeStyle='white';ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle='#1a1a2e';ctx.font='bold 11px sans-serif';ctx.textAlign='left';ctx.fillText(ag.n,p.px+10,p.py-3);
    if(ag.phase&&ag.phase!=='init'){ctx.fillStyle='#6b7280';ctx.font='10px sans-serif';ctx.fillText(ag.phase,p.px+10,p.py+10);}
  });
}

function doPreview(){
  fetch('/api/scenario').then(function(r){return r.json();}).then(function(sd){
    return fetch('/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({buts_par_agent:sd.buts_par_agent})});
  }).then(function(r){return r.json();}).then(function(d){
    var div=document.getElementById('plan-div');
    if(!d.ok){div.innerHTML='<span style="color:#dc2626">'+d.erreur+'</span>';return;}
    div.innerHTML=Object.entries(d.plans).map(function(kv){
      var ag=kv[0];var plan=kv[1];var col=_agColors[ag]||'#374151';
      return '<div style="margin-bottom:8px"><div style="font-weight:600;color:'+col+';font-size:11px;margin-bottom:3px">&#9656; '+ag+'</div>'
        +(plan.length?plan.map(function(a,i){return '<div class="plan-item">'+(i+1)+'. '+a.action+'('+a.args.join(', ')+')</div>';}).join('')
          :'<div style="color:#dc2626;font-size:11px">Aucun plan</div>')+'</div>';
    }).join('');
  });
}

function lancer(){
  fetch('/api/scenario').then(function(r){return r.json();}).then(function(sd){
    _sd=sd; assignColors();
    return fetch('/api/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({buts_par_agent:sd.buts_par_agent})});
  }).then(function(){setRunning(true);_interval=setInterval(refreshStatus,1000);});
}

function arreter(){
  fetch('/api/stop',{method:'POST'}).then(function(){setRunning(false);clearInterval(_interval);});
}

function setRunning(r){
  _running=r;
  document.getElementById('btn-go').style.display=r?'none':'inline';
  document.getElementById('btn-stop').style.display=r?'inline':'none';
  document.getElementById('hdr-badge').textContent=r?'ACTIF':'INACTIF';
  document.getElementById('hdr-badge').className='status-badge '+(r?'active':'inactive');
}

function refreshStatus(){
  fetch('/api/status').then(function(r){return r.json();}).then(function(d){
    if(!d.running&&_running){setRunning(false);clearInterval(_interval);}
    _lastAgs=d.agents||{};
    document.getElementById('hdr-t').textContent='t = '+d.t+'s';
    resizeCanvas(); drawMap(_lastAgs); renderAgLegend(_lastAgs);
    var noms=Object.keys(_lastAgs);var dh='';
    for(var i=0;i<noms.length;i++) for(var j=i+1;j<noms.length;j++){
      var a=_lastAgs[noms[i]];var b=_lastAgs[noms[j]];
      var dist=Math.round(Math.sqrt((a.x-b.x)*(a.x-b.x)+(a.y-b.y)*(a.y-b.y)));
      var cls=dist<600?'dp-r':dist<1500?'dp-y':'dp-g';
      dh+='<div class="dist-row">'+noms[i]+' - '+noms[j]+'<span class="dist-pill '+cls+'">'+dist+'m</span></div>';
    }
    document.getElementById('dists').innerHTML=dh||'-';
    var el2=document.getElementById('evts-log');
    (d.nouveaux_evenements||[]).forEach(function(e){el2.innerHTML+='<div class="ll evt">* [t='+e.t+'s] '+e.nom+'</div>';});
    var elog=document.getElementById('elog');
    (d.nouveaux_logs||[]).forEach(function(l){
      var cls=l.indexOf('*')>=0?'evt':(l.indexOf('Plan')>=0||l.indexOf('->')>=0)?'act':'inf';
      elog.innerHTML+='<div class="ll '+cls+'">'+l+'</div>';
    });
    elog.scrollTop=elog.scrollHeight;
  });
}

function showToast(id,msg,ok){
  var el=document.getElementById(id);
  el.textContent=msg; el.className='toast '+(ok?'ok':'err'); el.style.display='block';
  setTimeout(function(){el.style.display='none';},3000);
}

window.onload=function(){
  loadHTN();
  fetch('/api/scenario').then(function(r){return r.json();}).then(function(d){
    _sd=d; _sd.agents=_sd.agents||[]; _sd.zones=_sd.zones||{};
    _sd.buts_par_agent=_sd.buts_par_agent||{}; _sd.evenements=_sd.evenements||[];
    assignColors();
    document.getElementById('hdr-scen').textContent=_sd.nom||'';
  });
  window.addEventListener('resize',function(){resizeCanvas();drawMap(_lastAgs);});
};
