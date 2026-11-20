import {anchorOf,guidePoint,orderedFaces,place} from './framing.mjs';

const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
export function cssPlane(p,w,h){
  if(!p||!w||!h)return '';
  const {x,y,k,l,s,stretch}=p,c=1-k*x-l*y;
  return 'matrix3d('+[stretch+x*k,k*h/w,0,k/w,(x*l+s)*w/h,1+l,0,l/h,0,0,1,0,
    (x*(c-stretch)-s*y)*w,(c-1)*h,0,c].join(',')+')';
}
export function projected(pose,g,aspect,roll,pitch,side=0){
  if(Math.abs(roll)+Math.abs(pitch)+Math.abs(side)<.002)return g;
  const a=anchorOf(pose,g),[left,right]=pose.torsoCrop||[.23,.77];
  const crop=(1-g.y)/g.h,check=[[left,crop],[right,crop]];
  for(const [x,y,rx,ry] of pose.heads)check.push([x-rx*.68,y],[x+rx*.68,y],[x,y-ry*.76],[x,y+ry*.74]);
  for(let strength=1;strength>=.0625;strength*=.5){
    const plane={...a,k:clamp(roll*aspect/Math.max(.25,1-a.y)+side,-.38,.38)*strength,
      stretch:1-Math.abs(side)*.4*strength,l:clamp(pitch,-.16,.16)*strength,s:-roll/aspect*strength};
    const next={...g,plane};
    if(check.every(([u,v])=>{const {x,y}=guidePoint(next,u,v);return x>=.004&&x<=.996&&y>=.003&&y<=1.00001;}))return next;
  }
  return g;
}
// The template already encodes head-size differences. Compare changes from
// that reference, ordered by screen position, over multiple observations.
function relativeDepth(pose,g,aspect,faces){
  if(faces.length!==2||faces.some(f=>f.height<.08||f.box.some((v,i)=>i<2?v<.012:v>.988)))return null;
  const [a,b]=orderedFaces(pose,g,aspect,faces),dx=b.eye.x-a.eye.x;
  if(Math.abs(dx)*aspect<.11)return null;
  const ratio=(a.height/pose.heads[0][3])/(b.height/pose.heads[1][3]);
  if(ratio<.61||ratio>1.65)return null;
  const delta=Math.log(ratio)*Math.sign(dx);
  return Math.abs(delta)<.095?0:clamp((delta-Math.sign(delta)*.095)*.46,-.105,.105);
}
// Without gravity data, only infer roll if the two faces agree with the
// change in the pair's eye line. One partner leaning in is part of the pose.
function visualRoll(pose,g,aspect,faces){
  if(faces.length!==2||!pose.roll)return 0;
  const pair=orderedFaces(pose,g,aspect,faces),targets=pose.eyes.map(([x,y])=>guidePoint(g,x,y));
  const angle=(a,b)=>Math.atan2(b.y-a.y,(b.x-a.x)*aspect);
  const angleChange=angle(pair[0].eye,pair[1].eye)-angle(targets[0],targets[1]);
  const roll=Math.atan2(Math.sin(angleChange),Math.cos(angleChange)),sign=g.flip?-1:1;
  if(!pair.every((f,i)=>Number.isFinite(f.roll)&&f.height>.07&&Math.sign(f.roll-pose.roll[i]*sign)===Math.sign(roll)))return 0;
  return clamp(roll,-.13,.13);
}
// Compare the same rows on either side. Omit both members of a sample pair
// when either lands on a detected head or its approximate shoulder region.
export function sceneBalance(scene,faces){
  if(scene.light<.08||scene.light>.92||scene.clipped>.83)return null;
  const {w,h,sal}=scene;
  const boxes=faces.map(({box:[l,t,r,b]})=>({x:(l+r)/2,w:r-l,t,b,h:b-t}));
  function person(x,y){return boxes.some(b=>y>b.t-b.h*.15&&Math.abs(x-b.x)<b.w*(y>b.b?.94:.65));}
  let left=0,right=0,count=0,possible=0;
  for(let y=Math.ceil(.08*h);y<h*.88;y+=2)for(let x=Math.max(1,Math.ceil(.06*w));x<w*.46;x+=2){
    possible++;
    const u=(x+.5)/w,v=(y+.5)/h;
    if(person(u,v)||person(1-u,v))continue;
    left+=sal[y*w+x];right+=sal[y*w+w-1-x];count++;
  }
  if(!count||count<possible*.25)return null;
  const difference=(left-right)/count;
  if(Math.abs(difference)<.052)return 0;
  return clamp(difference/.40,-1,1);
}
export class FloatingGuide {
  constructor(){this.reset();}
  reset(){
    this.roll=0;this.pitch=0;this.side=0;this.depth=[];this.offset=0;this.balance=0;this.votes=[];this.lastScene=-Infinity;this.last=-Infinity;this.lastPair=-Infinity;
  }
  update(pose,base,aspect,faces,now,tilt,readScene){
    const elapsed=now-this.last,dt=clamp(elapsed,0,360);this.last=now;
    if(faces.length!==2||elapsed>900)this.depth=[];
    if(faces.length===2)this.lastPair=now;
    if(faces.length<2&&now-this.lastPair<2000)return null;
    if(now-this.lastScene>=760){
      if(now-this.lastScene>1700)this.votes=[];
      this.lastScene=now;
      const signal=sceneBalance(readScene(),faces);
      if(signal===null)this.votes=[];
      else{
        this.votes.push(signal);if(this.votes.length>3)this.votes.shift();
        if(this.votes.length===3&&this.votes.every(v=>Math.sign(v)===Math.sign(signal)))this.balance=[...this.votes].sort((a,b)=>a-b)[1];
      }
    }
    const gain=1-Math.exp(-dt/620),offGain=1-Math.exp(-dt/1150);
    const smooth=(prev,next,f,dead)=>Math.abs(next-prev)<dead?prev:prev+(next-prev)*f;
    const roll=tilt?clamp(tilt[0],-.14,.14):visualRoll(pose,base,aspect,faces);
    const pitch=tilt?clamp(tilt[1]*.30,-.16,.16):0;
    this.roll=smooth(this.roll,roll,gain,.004);this.pitch=smooth(this.pitch,pitch,gain,.004);
    const depth=relativeDepth(pose,base,aspect,faces);
    if(depth===null)this.depth=[];
    else{
      this.depth.push(depth);if(this.depth.length>3)this.depth.shift();
    }
    const sideTarget=this.depth.length===3?[...this.depth].sort((a,b)=>a-b)[1]:0;
    this.side=smooth(this.side,sideTarget,offGain,.003);
    this.offset=smooth(this.offset,this.balance*(faces.length===2?.018:faces.length===1?.045:.12),offGain,.002);
    const anchor=anchorOf(pose,base);
    const g=Math.abs(this.offset)>.0001?place(pose,aspect,base.h,anchor.x+this.offset,anchor.y,base.flip):base;
    return projected(pose,g,aspect,this.roll,this.pitch,this.side);
  }
}
