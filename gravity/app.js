import { observeCanvasSize } from './canvas-size.js';
import {STEP,SCENARIOS,createSystem,comparisonFrom,makeProbe,cloneParticles,advanceSystem,sampleTrails,circularSpeed,medianRadius,makeRandom} from './physics.js';

const $=selector=>document.querySelector(selector);
const canvas=$('#universe'),ctx=canvas.getContext('2d'),stage=$('.universe-stage');
const motion=matchMedia('(prefers-reduced-motion: reduce)');
const palette=['#f0b9d4','#d8ef83','#9fd5e7','#e8bc83','#c7b6ef','#7edcc2'];
const launchDescriptions={
  circular:'Start at the local circular speed. Then change the field and see what happens.',
  wide:'35% above the local circular speed. The tracer starts moving outward into a wider orbit.',
  plunge:'Launch inward and follow the path through the softened core.',
  flyby:'Start with the same diagonal velocity at different points. Compare the paths.'
};
let scenario='halo',system=createSystem(SCENARIOS.halo),other=null,compare=false;
let paused=motion.matches,speed=4,launchKind='circular',probeId=0,branchTime=0;
let width=0,height=0,yaw=.22,tilt=.91,zoom=1,drag=null,visible=true;
let raf=0,last=0,accumulator=0,ticks=0,lastReadout=-Infinity,dirty=true;
const random=makeRandom(3298);
const background=Array.from({length:100},()=>[random(),random(),random()]);

function panels(){
  if(!compare)return [{x:0,y:0,w:width,h:height,system}];
  return width<560
    ? [{x:0,y:0,w:width,h:height/2,system},{x:0,y:height/2,w:width,h:height/2,system:other}]
    : [{x:0,y:0,w:width/2,h:height,system},{x:width/2,y:0,w:width/2,h:height,system:other}];
}
function project(x,y,z,panel){
  const xx=x*Math.cos(yaw)-z*Math.sin(yaw),zz=x*Math.sin(yaw)+z*Math.cos(yaw);
  const yy=y*Math.cos(tilt)-zz*Math.sin(tilt),depth=y*Math.sin(tilt)+zz*Math.cos(tilt);
  const scale=Math.min(panel.w,panel.h)*.037*zoom;
  return {x:panel.x+panel.w/2+xx*scale,y:panel.y+panel.h*.51+yy*scale,depth,scale};
}
function unproject(px,py,panel){
  const scale=Math.min(panel.w,panel.h)*.037*zoom;
  const xx=(px-panel.x-panel.w/2)/scale,zz=-(py-panel.y-panel.h*.51)/(scale*Math.sin(tilt));
  let x=xx*Math.cos(yaw)+zz*Math.sin(yaw),z=-xx*Math.sin(yaw)+zz*Math.cos(yaw);
  const r=Math.hypot(x,z);
  if(r>14){x*=14/r;z*=14/r;}
  if(r<.65){x=.65;z=0;}
  return [x,z];
}
function circle(panel,r,color){
  ctx.strokeStyle=color;ctx.lineWidth=.7;ctx.beginPath();
  for(let i=0;i<=100;i++){const a=i/100*Math.PI*2,p=project(Math.cos(a)*r,0,Math.sin(a)*r,panel);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);}
  ctx.stroke();
}
function drawPanel(panel,index){
  const state=panel.system;if(!state)return;
  ctx.save();ctx.beginPath();ctx.rect(panel.x,panel.y,panel.w,panel.h);ctx.clip();
  ctx.fillStyle='#07100d';ctx.fillRect(panel.x,panel.y,panel.w,panel.h);
  for(const [x,y,a] of background){ctx.fillStyle=`rgba(169,189,176,${.1+a*.24})`;ctx.fillRect(panel.x+x*panel.w,panel.y+y*panel.h,1,1);}
  const center=project(0,0,0,panel),base=Math.min(panel.w,panel.h);
  if(state.params.halo>0){
    const cloud=ctx.createRadialGradient(center.x,center.y,0,center.x,center.y,base*.51*zoom);
    cloud.addColorStop(0,'#83669832');cloud.addColorStop(.55,'#73658c24');cloud.addColorStop(1,'#62538000');
    ctx.fillStyle=cloud;ctx.fillRect(panel.x,panel.y,panel.w,panel.h);
    [4,8,12].forEach(r=>circle(panel,r,'#b898d32e'));
    ctx.save();ctx.setLineDash([2,6]);circle(panel,14,'#b4a2cb20');ctx.restore();
  }else{[4,8,12].forEach(r=>circle(panel,r,'#a2b38a12'));}
  const projected=state.stars.map(p=>({p,...project(p.x,p.y,p.z,panel)})).filter(p=>p.x>panel.x-10&&p.x<panel.x+panel.w+10&&p.y>panel.y-10&&p.y<panel.y+panel.h+10).sort((a,b)=>b.depth-a.depth);
  for(const p of projected){
    const near=Math.min(1,Math.max(0,(14-p.depth)/28));
    ctx.fillStyle=Math.hypot(p.p.x,p.p.z)<2.5?'#eff2c9':index?'#e6d4e2':'#d6e7c2';
    ctx.globalAlpha=.34+near*.58;ctx.beginPath();ctx.arc(p.x,p.y,p.p.size*(.55+near*.9),0,Math.PI*2);ctx.fill();
  }
  ctx.globalAlpha=1;
  for(const p of state.probes){
    ctx.strokeStyle=p.color;ctx.lineWidth=1.4;ctx.lineJoin='round';ctx.beginPath();
    for(let i=0;i<p.trail.length;i++){const q=project(...p.trail[i],panel);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);}
    ctx.stroke();const q=project(p.x,p.y,p.z,panel);
    ctx.fillStyle=p.color;ctx.shadowColor=p.color;ctx.shadowBlur=12;ctx.beginPath();ctx.arc(q.x,q.y,3.8,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    ctx.fillStyle=p.color;ctx.font='9px ui-monospace,monospace';ctx.fillText(String(p.id).padStart(2,'0'),q.x+8,q.y-7);
  }
  const glow=ctx.createRadialGradient(center.x,center.y,0,center.x,center.y,base*.065);
  glow.addColorStop(0,'#f3efbedb');glow.addColorStop(.13,'#dfecad99');glow.addColorStop(1,'#e4efb200');
  ctx.fillStyle=glow;ctx.fillRect(center.x-base*.07,center.y-base*.07,base*.14,base*.14);
  ctx.restore();
}
function draw(){
  if(!ctx||!width||!height)return;
  panels().forEach(drawPanel);
  if(compare){ctx.strokeStyle='#78946377';ctx.lineWidth=1;ctx.beginPath();if(width<560){ctx.moveTo(0,height/2);ctx.lineTo(width,height/2);}else{ctx.moveTo(width/2,0);ctx.lineTo(width/2,height);}ctx.stroke();}
  dirty=false;
}
let displayedProbe, displayedComparison;
function updateReadouts(force=false){
  if(!force&&system.time-lastReadout<.6)return;lastReadout=system.time;
  $('#time-value').textContent=system.time.toFixed(1);
  const left=medianRadius(system.stars),right=other?medianRadius(other.stars):null;
  $('#radius-value').innerHTML=right===null?left.toFixed(2):`${left.toFixed(2)} <small>/ ${right.toFixed(2)}</small>`;
  $('#speed-value').innerHTML=`${circularSpeed(10,system.params).toFixed(3)}${other?` <small>/ ${circularSpeed(10,other.params).toFixed(3)}</small>`:''}`;
  const latest=system.probes.at(-1),alt=other?.probes.at(-1),box=$('#tracer-readout');
  // Keep the live values and their narration controls mounted between simulation ticks.
  if (latest !== displayedProbe || Boolean(alt) !== displayedComparison) {
    displayedProbe = latest;
    displayedComparison = Boolean(alt);
    if (latest) {
      const row = label => `<dt>${label}</dt><dd><span data-tracer-value></span></dd>`;
      box.innerHTML = `<span class="mono" style="color:${latest.color}">TRACER ${String(latest.id).padStart(2,'0')} / ${latest.kind.toUpperCase()}</span><dl>${row('Radius')}${row('Speed')}${alt ? row('Alternate radius') : ''}</dl><p>${system.probes.length} of 6 tracer slots in use. Trails retain the latest 42 simulation units.</p>`;
    } else {
      box.innerHTML = '<span class="mono">NO TRACER YET</span><p>Launch one, or tap a point in the galaxy. Each colored line records a path.</p>';
    }
  }
  if (latest) {
    const values = [Math.hypot(latest.x,latest.y,latest.z).toFixed(2), Math.hypot(latest.vx,latest.vy,latest.vz).toFixed(3)];
    if (alt) values.push(Math.hypot(alt.x,alt.y,alt.z).toFixed(2));
    box.querySelectorAll('[data-tracer-value]').forEach((node,index) => {
      if (node.textContent !== values[index]) node.textContent = values[index];
    });
  }
  $('#clear-trails').disabled=!latest;
}
function updateCurve(){
  const svg=$('#rotation-curve'),left=48,top=22,w=532,h=209,ymax=1.6;
  const point=(r,v)=>`${(left+r/14*w).toFixed(2)},${(top+h-v/ymax*h).toFixed(2)}`;
  let grid='';for(const y of [0,.4,.8,1.2,1.6])grid+=`<line x1="${left}" x2="580" y1="${top+h-y/ymax*h}" y2="${top+h-y/ymax*h}" stroke="#34492b" stroke-width=".7"/><text x="35" y="${top+h-y/ymax*h+4}" fill="#9daf90" text-anchor="end" font-size="10">${y.toFixed(1)}</text>`;
  for(const x of [0,4,8,12,14])grid+=`<text x="${left+x/14*w}" y="251" fill="#9daf90" text-anchor="middle" font-size="10">${x}</text>`;
  const line=params=>Array.from({length:141},(_,i)=>`${i?'L':'M'}${point(i/10,circularSpeed(i/10,params))}`).join(' ');
  const bare={...system.params,halo:0};
  svg.innerHTML=`<title id="curve-title">Illustrative circular speed versus radius</title><desc id="curve-desc">Calculated model curves, not observations. Current circular speed at radius ten is ${circularSpeed(10,system.params).toFixed(3)}. The central mass alone gives ${circularSpeed(10,bare).toFixed(3)}.</desc><g font-family="ui-monospace,monospace">${grid}<path d="${line(bare)}" fill="none" stroke="#cda2c0" stroke-width="2" stroke-dasharray="5 4"/><path d="${line(system.params)}" fill="none" stroke="#d8f287" stroke-width="2.5"/><text x="314" y="275" text-anchor="middle" font-size="10" fill="#9daf90">RADIUS · DIMENSIONLESS</text><text x="48" y="12" font-size="9" fill="#9daf90">CIRCULAR SPEED</text></g>`;
  $('#model-parameters').textContent=`M = ${system.params.mass} · a = ${system.params.scale} · H = ${system.params.halo} · ε = 0.06`;
  $('#curve-description').textContent=system.params.halo?`At r = 10, the current model needs ${circularSpeed(10,system.params).toFixed(3)} speed units for a circular orbit. The central component alone needs ${circularSpeed(10,bare).toFixed(3)}.`:'With the halo off, the two curves coincide. A star that keeps its earlier, faster velocity will no longer be on a circular orbit.';
}
function sync(){
  $('#telemetry').textContent=paused?'TIME HELD':`${system.stars.length} TRACERS${compare?' / EACH UNIVERSE':''} · ${speed}× TIME`;
  $('#pause').textContent=paused?'Play':'Pause';$('#pause').setAttribute('aria-pressed',paused);
  $('#compare').textContent=compare?'Back to one view':'Compare halo on / off';$('#compare').setAttribute('aria-pressed',compare);
  $('#halo-switch').textContent=system.params.halo?'Remove halo':'Add halo';$('#halo-switch').setAttribute('aria-pressed',system.params.halo>0);
  $('#left-label').textContent=compare?`CURRENT · HALO ${system.params.halo?'ON':'OFF'}`:SCENARIOS[scenario].label.toUpperCase()+` / HALO ${system.params.halo?'ON':'OFF'}`;
  $('#right-label').textContent=other?`ALTERNATE · HALO ${other.params.halo?'ON':'OFF'}`:'';$('#right-label').hidden=!compare;
  stage.classList.toggle('comparing',compare);
  $('#compare-note').textContent=compare?`Same positions and velocities at t = ${branchTime.toFixed(1)}; only the halo differs. Paired readouts show current / alternate. No forces pass between the two panels.`:'660 stars. One fixed gravitational field. The spiral is an initial arrangement, not a self-gravitating spiral galaxy.';
  document.querySelectorAll('[data-scenario]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.scenario===scenario));
  document.querySelectorAll('#sandbox [data-speed]').forEach(b=>b.setAttribute('aria-pressed',Number(b.dataset.speed)===speed));
  document.querySelectorAll('[data-launch]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.launch===launchKind));
  $('#launch-copy').textContent=launchDescriptions[launchKind];
  dirty=true;updateReadouts(true);updateCurve();requestDraw();
}
function requestDraw(){if(!raf&&!document.hidden&&visible)raf=requestAnimationFrame(frame);}
function frame(now){
  raf=0;const elapsed=last?Math.min((now-last)/1000,.1):0;last=now;
  if(!paused&&visible&&!document.hidden){
    accumulator=Math.min(accumulator+elapsed*speed,STEP*64);
    let count=0;while(accumulator>=STEP&&count<64){advanceSystem(system);if(other)advanceSystem(other);accumulator-=STEP;count++;ticks++;if(ticks%5===0){sampleTrails(system);if(other)sampleTrails(other);}}
    dirty=true;updateReadouts();
  }
  if(dirty)draw();
  if(!paused&&visible&&!document.hidden)requestDraw();else last=0;
}
function setPaused(value){paused=value;last=0;accumulator=0;sync();}
function setScenario(key){
  scenario=key;system=createSystem(SCENARIOS[key]);probeId=0;ticks=0;accumulator=0;last=0;lastReadout=-Infinity;branchTime=0;
  other=compare?comparisonFrom(system):null;
  $('#scenario-title').textContent=SCENARIOS[key].label;$('#scenario-copy').textContent=SCENARIOS[key].description;
  $('#gravity-status').textContent=`${SCENARIOS[key].label} restarted from the same seeded stars.${paused?' Press Play when ready.':''}`;sync();
}
function setCompare(value){compare=value;other=value?comparisonFrom(system):null;branchTime=system.time;sync();$('#gravity-status').textContent=value?'Same positions and velocities. One view has a halo; the other doesn’t.':'Back to one view. Your current paths are still there.';}
function launchAt(x=8,z=-3){
  const probe=makeProbe(x,z,system.params,launchKind);probeId++;probe.id=probeId;probe.color=palette[(probeId-1)%palette.length];probe.trail=[[probe.x,probe.y,probe.z]];
  if(system.probes.length===6)system.probes.shift();system.probes.push(probe);
  if(other){if(other.probes.length===6)other.probes.shift();other.probes.push(cloneParticles([probe])[0]);}
  $('#gravity-status').textContent=`Tracer ${probeId} launched${other?' with the same velocity in both universes':''}.${paused?' Press Play to follow it.':''}`;dirty=true;updateReadouts(true);requestDraw();
}
function setLaunch(kind){launchKind=kind;sync();}
function resetCamera(){yaw=.22;tilt=.91;zoom=1;$('#view').textContent='Face-on';dirty=true;requestDraw();}
function cameraChange(){dirty=true;$('#view').textContent=tilt>1.4?'Tilt the view':'Face-on';requestDraw();}

for(const b of document.querySelectorAll('[data-scenario]'))b.onclick=()=>setScenario(b.dataset.scenario);
for(const b of document.querySelectorAll('#sandbox [data-speed]'))b.onclick=()=>{speed=Number(b.dataset.speed);last=0;sync();};
for(const b of document.querySelectorAll('[data-launch]'))b.onclick=()=>setLaunch(b.dataset.launch);
$('#pause').onclick=()=>setPaused(!paused);
$('#reset').onclick=()=>{setScenario(scenario);resetCamera();};
$('#compare').onclick=()=>setCompare(!compare);
$('#halo-switch').onclick=()=>{
  system.params.halo=system.params.halo?0:(SCENARIOS[scenario].halo||1);
  if(compare){other=comparisonFrom(system);branchTime=system.time;}
  $('#gravity-status').textContent=`Halo ${system.params.halo?'added':'removed'}. Velocities stay unchanged.${compare?' Comparison restarted from this instant.':''}`;sync();
};
$('#launch').onclick=()=>launchAt();
$('#clear-trails').onclick=()=>{system.probes=[];if(other)other.probes=[];$('#gravity-status').textContent='Tracer paths cleared. Star positions are preserved.';dirty=true;updateReadouts(true);requestDraw();};
$('#view').onclick=()=>{tilt=tilt>1.4?.91:Math.PI/2;cameraChange();};
$('#zoom-in').onclick=()=>{zoom=Math.min(1.8,zoom*1.18);cameraChange();};
$('#zoom-out').onclick=()=>{zoom=Math.max(.5,zoom/1.18);cameraChange();};
canvas.onpointerdown=e=>{if(e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,yaw,tilt,moved:false};canvas.setPointerCapture(e.pointerId);};
canvas.onpointermove=e=>{if(!drag||e.pointerId!==drag.id)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>7)drag.moved=true;if(drag.moved){yaw=drag.yaw+dx*.006;tilt=Math.max(.25,Math.min(Math.PI/2,drag.tilt+dy*.006));cameraChange();}};
canvas.onpointerup=e=>{if(!drag||e.pointerId!==drag.id)return;const click=!drag.moved;drag=null;if(click){const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,p=panels().find(p=>x>=p.x&&x<=p.x+p.w&&y>=p.y&&y<=p.y+p.h);if(p)launchAt(...unproject(x,y,p));}};
canvas.onpointercancel=canvas.onlostpointercapture=()=>drag=null;
canvas.onkeydown=e=>{
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-',' ','l','L','r','R'].includes(e.key))e.preventDefault();else return;
  if(e.key==='ArrowLeft')yaw-=.12;if(e.key==='ArrowRight')yaw+=.12;
  if(e.key==='ArrowUp')tilt=Math.min(Math.PI/2,tilt+.1);if(e.key==='ArrowDown')tilt=Math.max(.25,tilt-.1);
  if(e.key==='+'||e.key==='=')zoom=Math.min(1.8,zoom*1.12);if(e.key==='-')zoom=Math.max(.5,zoom/1.12);
  if(e.key===' '&&!e.repeat)setPaused(!paused);if(e.key.toLowerCase()==='l'&&!e.repeat)launchAt();if(e.key.toLowerCase()==='r'&&!e.repeat){setScenario(scenario);resetCamera();}cameraChange();
};
for(const b of document.querySelectorAll('[data-experiment]'))b.onclick=()=>{
  const key=b.dataset.experiment;
  if(key==='strip'){compare=true;setScenario('halo');$('#gravity-status').textContent='Watch the halo-off view. Those stars kept the speeds they had with the halo on.';}
  if(key==='orbit'){compare=false;setScenario('halo');setLaunch('wide');launchAt(10,0);}
  if(key==='core'){compare=false;setScenario('compact');setLaunch('plunge');launchAt(7,0);}
  speed=4;setPaused(false);stage.scrollIntoView({block:'center',behavior:motion.matches?'auto':'smooth'});
};
observeCanvasSize(canvas, ctx, (w, h) => {
  width = w;
  height = h;
  stage.classList.toggle('narrow', width < 560);
  draw();
});
new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;last=0;if(visible){dirty=true;requestDraw();}else if(raf){cancelAnimationFrame(raf);raf=0;}},{rootMargin:'100px'}).observe(canvas);
document.addEventListener('visibilitychange',()=>{last=0;if(document.hidden){if(raf)cancelAnimationFrame(raf);raf=0;accumulator=0;}else{dirty=true;requestDraw();}});
motion.addEventListener('change',e=>{if(e.matches)setPaused(true);});
if(!ctx){$('#gravity-status').textContent='Canvas graphics are unavailable in this browser. The model explanation and calculated curve are still available.';paused=true;}
setScenario('halo');requestDraw();
