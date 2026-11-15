/** Dimensionless, fixed-potential test-particle model. No observational data. */
export const STEP = 0.02;
export const SOFTENING = 0.06;
export const SCENARIOS = Object.freeze({
  halo: { label: 'Invisible halo', mass: 1, scale: 1, halo: 1, description: 'The halo keeps circular speeds high farther from the center. Take it away without changing the stars’ velocities and watch the orbits spread out.' },
  bare: { label: 'Central mass only', mass: 1, scale: 1, halo: 0, description: 'The central mass supplies the whole gravitational field. Circular orbits at the same outer radii now need less speed.' },
  compact: { label: 'Compact core', mass: 2, scale: 0.35, halo: 0.45, description: 'More mass near the center, less halo. Compare the faster inner motion with what happens farther out.' }
});
export function acceleration(x,y,z,p){
  const s2=x*x+y*y+z*z+SOFTENING**2, s=Math.sqrt(s2);
  const k=p.mass/(s*(s+p.scale)**2)+p.halo/(s2+4);
  return [-k*x,-k*y,-k*z];
}
export function circularSpeed(radius,p){
  if(radius<=0)return 0;
  const [ax]=acceleration(radius,0,0,p);
  return Math.sqrt(-radius*ax);
}
export function potential(x,y,z,p){
  const s=Math.sqrt(x*x+y*y+z*z+SOFTENING**2);
  return -p.mass/(s+p.scale)+0.5*p.halo*Math.log(s*s+4);
}
export function energy(p,params){return .5*(p.vx*p.vx+p.vy*p.vy+p.vz*p.vz)+potential(p.x,p.y,p.z,params);}
export function advance(p,dt,params){
  let [ax,ay,az]=acceleration(p.x,p.y,p.z,params);
  p.vx+=ax*dt*.5;p.vy+=ay*dt*.5;p.vz+=az*dt*.5;
  p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;
  [ax,ay,az]=acceleration(p.x,p.y,p.z,params);
  p.vx+=ax*dt*.5;p.vy+=ay*dt*.5;p.vz+=az*dt*.5;
}
export function makeRandom(seed=81491){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
export function makeGalaxy(params,count=660,seed=81491){
  const random=makeRandom(seed);
  return Array.from({length:count},(_,i)=>{
    const radius=.65+random()**.68*11.3;
    // The initial spiral is a drawing arrangement, not self-consistent spiral dynamics.
    const a=(i%3)*Math.PI*2/3+Math.log(radius)*1.55+(random()-.5)*.65;
    const v=circularSpeed(radius,params);
    return {x:Math.cos(a)*radius,y:(random()-.5)*.1,z:Math.sin(a)*radius,vx:-Math.sin(a)*v,vy:0,vz:Math.cos(a)*v,size:.5+random(),homeRadius:radius};
  });
}
export function makeProbe(x,z,params,kind='circular'){
  const r=Math.max(.1,Math.hypot(x,z)),speed=circularSpeed(r,params);
  let vx=-z/r*speed,vz=x/r*speed;
  if(kind==='wide'){vx*=1.35;vz*=1.35;}
  if(kind==='plunge'){vx=-x/r*.65;vz=-z/r*.65;}
  if(kind==='flyby'){vx=-.75;vz=.55;}
  const p={x,y:0,z,vx,vy:0,vz,size:3,trail:[],kind,homeRadius:r};
  p.initialEnergy=energy(p,params);return p;
}
export function cloneParticles(items){return items.map(p=>({...p,trail:p.trail?p.trail.map(q=>[...q]):undefined}));}
export function advanceSystem(system,dt=STEP){
  for(const p of system.stars)advance(p,dt,system.params);
  for(const p of system.probes)for(let sub=0;sub<8;sub++)advance(p,dt/8,system.params);
  system.time+=dt;
}
export function sampleTrails(system,limit=420){
  for(const p of system.probes){p.trail.push([p.x,p.y,p.z]);if(p.trail.length>limit)p.trail.splice(0,p.trail.length-limit);}
}
export function medianRadius(stars){const sorted=stars.map(p=>Math.hypot(p.x,p.z)).sort((a,b)=>a-b);return sorted.length?sorted[Math.floor(sorted.length/2)]:0;}
export function createSystem(params,seed=81491){return {params:{...params},stars:makeGalaxy(params,660,seed),probes:[],time:0};}
export function comparisonFrom(source){return {params:{...source.params,halo:source.params.halo>0?0:1},stars:cloneParticles(source.stars),probes:cloneParticles(source.probes),time:source.time};}
