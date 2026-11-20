const bound=(n,lo,hi)=>Math.max(lo,Math.min(n,hi));
const average=list=>list.reduce((a,b)=>a+b,0)/list.length;
// The denominator varies across the screen, but y=1 always maps to y=1.
export function warp(p,x,y){
  if(!p)return {x,y};
  const u=x-p.x,v=y-p.y,d=1+p.k*u+p.l*v;
  return {x:p.x+(p.stretch*u+p.s*v)/d,y:1+(y-1)/d};
}
export function guidePoint(g,u,v){
  return warp(g.plane,g.x+(g.flip?1-u:u)*g.w,g.y+v*g.h);
}

// Anchor the frame on the midpoint of the two pairs of eyes. Distances in the
// guide are square-image units; w and h below are fractions of the viewfinder.
function eyeAnchor(pose,flip){
  const x=average(pose.eyes.map(e=>e[0]));
  return {x:flip?1-x:x,y:average(pose.eyes.map(e=>e[1]))};
}
export function anchorOf(pose,g){
  const a=eyeAnchor(pose,g.flip);
  return {x:g.x+a.x*g.w,y:g.y+a.y*g.h};
}
// In source coordinates, every scanline in this band crosses visible torso ink
// and the foreground figure. Keep it at the actual bottom of the saved frame.
const torsoCrop=pose=>pose.torsoCrop||[.23,.77,.76,.90];
export function place(pose,aspect,h,cx,cy,flip){
  const heads=pose.heads.map(([x,y,rx,ry])=>[flip?1-x:x,y,rx,ry]);
  const [u0,u1,firstRow,lastRow]=torsoCrop(pose);
  const left=Math.min(flip?1-u1:u0,...heads.map(([x,,r])=>x-r*.68));
  const right=Math.max(flip?1-u0:u1,...heads.map(([x,,r])=>x+r*.68));
  const top=Math.min(...heads.map(([,y,,r])=>y-r*.76)),bottom=Math.max(...heads.map(([,y,,r])=>y+r*.74));
  const a=eyeAnchor(pose,flip);
  const maxH=Math.min(2.25,.97*aspect/(right-left),.97/(bottom-top),.985/(firstRow-top));
  const minH=Math.min(maxH,Math.max(Math.min(aspect,1)*.48,.30/(lastRow-a.y),.015/(lastRow-bottom)));
  h=bound(h,minH,maxH);
  const w=h/aspect;
  const yMin=Math.max(.015-top*h,1-lastRow*h);
  const yMax=Math.min(.985-bottom*h,1-firstRow*h);
  return {x:bound(cx-a.x*w,.015-left*w,.985-right*w),y:bound(cy-a.y*h,yMin,yMax),w,h,flip};
}
export function suggested(pose,aspect,zoom,flip,cx=.5,cy=.45){
  const typical=average(pose.heads.map(head=>head[3]*1.72));
  const eyeY=eyeAnchor(pose,flip).y;
  const chestScale=(1-(cy+.085))/(torsoCrop(pose)[3]-eyeY);
  return place(pose,aspect,Math.max((aspect>=1?.27:.22)/typical,chestScale)*zoom,cx,cy,flip);
}
// Match the direction between the eye targets in two axes so near-vertical
// forehead poses retain their roles even if the detected faces cross horizontally.
export function orderedFaces(pose,g,aspect,faces){
  const [a,b]=pose.eyes.map(([u,v])=>guidePoint(g,u,v)),sign=g.flip?-1:1;
  const dx=(b.x-a.x)*aspect/g.h,dy=(b.y-a.y)/g.h;
  const x=(faces[1].eye.x-faces[0].eye.x)*aspect,y=faces[1].eye.y-faces[0].eye.y;
  let match=x*dx+y*dy;
  if(Math.abs(match)<.0004&&faces.every(f=>Number.isFinite(f.yaw))){
    match=sign*(faces[1].yaw-faces[0].yaw)*(pose.turn[1]-pose.turn[0])||match;
  }
  return match>=0?faces:[faces[1],faces[0]];
}
function measuredFrame(pose,g,aspect,faces){
  if(faces.length!==2)return {cue:'missing'};
  if(faces.some(f=>f.box.some((n,i)=>i<2?n<.004:n>.996)))return {cue:'back'};
  if(faces.some(f=>f.height<.055))return {cue:'nearer'};
  const ordered=orderedFaces(pose,g,aspect,faces);
  const scales=ordered.map((face,i)=>face.height/(pose.heads[i][3]*1.72));
  const h=(faces[0].height+faces[1].height)/(1.72*(pose.heads[0][3]+pose.heads[1][3]));
  const x=average(faces.map(f=>f.eye.x)),y=average(faces.map(f=>f.eye.y));
  const candidate=place(pose,aspect,h,x,y,g.flip),fitted=anchorOf(pose,candidate);
  if(candidate.h>h*1.15)return {cue:'nearer'};
  if(candidate.h<h*.85)return {cue:'back'};
  if(Math.max(...scales)>1.85*Math.min(...scales))return {cue:'center'};
  const dx=(x-fitted.x)*aspect,dy=y-fitted.y;
  const cue=Math.hypot(dx,dy)>.065?(Math.abs(dx)>Math.abs(dy)?'center':dy>0?'lower':'raise'):null;
  return {frame:candidate,cue};
}
export function faceFrame(pose,g,aspect,faces){
  const m=measuredFrame(pose,g,aspect,faces);
  return !m.cue&&m.frame||null;
}
// Use a rolling three-sample median, a dead band for small movements and a
// bounded adjustment per observation. Missing detections never supply a size.
export class GuideFollower {
  constructor(){this.reset();}
  reset(){this.window=[];this.last=-Infinity;}
  update(pose,g,aspect,faces,now){
    const {frame,cue}=measuredFrame(pose,g,aspect,faces);
    if(!frame){this.reset();return {cue,ready:false};}
    const point={...anchorOf(pose,frame),h:frame.h},previous=this.window.at(-1);
    if(now-this.last>1200||previous&&(Math.abs(Math.log(point.h/previous.h))>.16||
      Math.hypot((point.x-previous.x)*aspect,point.y-previous.y)>.09))this.window=[];
    const elapsed=bound(now-this.last,30,450);this.last=now;
    this.window.push(point);if(this.window.length>3)this.window.shift();
    if(this.window.length<3)return {cue,ready:false};
    const mid=k=>this.window.map(p=>p[k]).sort((a,b)=>a-b)[1];
    const a=anchorOf(pose,g),dh=Math.log(mid('h')/g.h),dx=mid('x')-a.x,dy=mid('y')-a.y;
    const distance=Math.hypot(dx*aspect,dy);
    const ready=!cue&&Math.abs(dh)<.08&&distance<.05;
    if(Math.abs(dh)<.023&&distance<.012)return {cue,ready};
    const gain=1-Math.exp(-elapsed/350),step=Math.min(gain,.045/Math.max(.0001,distance));
    return {cue,ready,frame:place(pose,aspect,g.h*Math.exp(bound(dh*gain,-.11,.11)),a.x+dx*step,a.y+dy*step,g.flip)};
  }
}
export function transformGuide(pose,g,aspect,from,to,factor){
  const a=anchorOf(pose,g);
  const size=place(pose,aspect,g.h*factor,a.x,a.y,g.flip),s=size.h/g.h;
  return place(pose,aspect,size.h,to.x+(a.x-from.x)*s,to.y+(a.y-from.y)*s,g.flip);
}
