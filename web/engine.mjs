import {suggested,orderedFaces,guidePoint as map} from './framing.mjs';
import {brief,instruction,invitations,lines} from './guidance.mjs';
// Coordinates in each square illustration refer to the midpoint between the outer eye corners.
export const poses = [
  {id:'cheeks', name:'贴脸看镜头', level:'轻松', eyes:[[.37,.32],[.67,.46]], turn:[0,0], heads:[[.34,.32,.24,.31],[.69,.50,.23,.28]], setup:'两人脸颊轻靠，一起看镜头。'},
  {id:'kiss', name:'侧脸轻吻', level:'进阶', eyes:[[.45,.32],[.61,.30]], turn:[.72,-.67], heads:[[.31,.24,.25,.28],[.74,.34,.26,.28]], setup:'肩膀靠近，两人侧过脸，轻轻靠近。'},
  {id:'forehead', name:'亲额头', level:'进阶', eyes:[[.49,.25],[.58,.48]], turn:[.55,-.2], heads:[[.34,.19,.28,.29],[.68,.52,.23,.27]], setup:'拿手机的人稍高一点，低头轻吻对方的额头。'},
  {id:'temple', name:'亲脸侧', level:'进阶', eyes:[[.40,.35],[.62,.30]], turn:[0,-.65], heads:[[.38,.35,.20,.26],[.73,.34,.25,.26]], setup:'拿手机的人看镜头，另一位从侧面靠近脸颊。'},
  {id:'shoulder', name:'依肩合照', level:'轻松', eyes:[[.40,.29],[.67,.49]], turn:[0,-.12], heads:[[.38,.29,.22,.28],[.70,.48,.21,.25]], setup:'另一位稍退半步，把下巴轻轻靠在拿手机那一侧的肩上。'},
  {id:'turn', name:'回眸轻吻', level:'挑战', eyes:[[.47,.33],[.62,.37]], turn:[.72,-.65], heads:[[.33,.28,.25,.24],[.72,.39,.25,.24]], setup:'另一位从肩后靠近。拿手机的人稳住手，回头轻吻。'}
];
export const clamp=(x,lo=0,hi=1)=>Math.min(hi,Math.max(lo,x));
const mean=a=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length);
const fit=(error,tol)=>clamp(1-Math.max(0,error-tol*.22)/tol);
const averagePoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
export function readFace(points) {
  const eye=averagePoint(points[33],points[263]);
  const minX=Math.min(...points.map(p=>p.x)), maxX=Math.max(...points.map(p=>p.x));
  const minY=Math.min(...points.map(p=>p.y)), maxY=Math.max(...points.map(p=>p.y));
  const width=maxX-minX, height=maxY-minY;
  if(!Number.isFinite(eye.x+eye.y+width+height)||width<.045||height<.045)return null;
  const yaw=clamp((points[1].x-(maxX+minX)/2)/Math.max(width*.52,.025),-1,1);
  const roll=(points[263].y-points[33].y)/height;
  const openness=(Math.abs(points[159].y-points[145].y)+Math.abs(points[386].y-points[374].y))/(2*height);
  return {eye,yaw,roll,openness,width,height,box:[minX,minY,maxX,maxY],lip:averagePoint(points[13],points[14]),brow:averagePoint(points[10],eye)};
}
export function features(img){
  const {width:w,height:h,data:p}=img, n=w*h, l=new Float32Array(n), sal=new Float32Array(n);
  let clipped=0;
  for(let i=0;i<n;i++){l[i]=(.2126*p[i*4]+.7152*p[i*4+1]+.0722*p[i*4+2])/255; if(l[i]<.035||l[i]>.97)clipped++;}
  let energy=0,lap=0,lap2=0;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=y*w+x, d=4*i, local=Math.abs(l[i+1]-l[i-1])+Math.abs(l[i+w]-l[i-w]);
    const far=Math.abs(l[i]-l[Math.max(0,y-5)*w+Math.max(0,x-5)]);
    const rgb=[p[d],p[d+1],p[d+2]], chroma=(Math.max(...rgb)-Math.min(...rgb))/255;
    sal[i]=.035+local*1.5+far*.8+chroma*.27+Math.max(0,l[i]-.72)*.9;energy+=sal[i];
    const v=l[i+1]+l[i-1]+l[i+w]+l[i-w]-4*l[i];lap+=v;lap2+=v*v;
  }
  const count=(w-2)*(h-2);
  return {w,h,sal,energy,light:mean(l),clipped:clipped/n,detail:Math.sqrt(Math.max(0,lap2/count-(lap/count)**2)),pixels:p};
}
function covered(pose,g,x,y){
  let u=(x-g.x)/g.w; if(g.flip)u=1-u;const v=(y-g.y)/g.h;
  if(v<0||v>1||u<0||u>1)return false;
  if(pose.mask){const i=clamp(Math.floor(v*24),0,23)*24+clamp(Math.floor(u*24),0,23);return pose.mask.charCodeAt(i)>100;}
  return pose.heads.some(([cx,cy,rx,ry])=>{
    const inHead=((u-cx)/rx)**2+((v-cy)/ry)**2<1;
    const torso=v>cy+ry*.72 && Math.abs(u-cx)<Math.min(.52,rx*.58+(v-cy-ry*.72)*.98);
    return inHead||torso;
  });
}
export function recommend(scene,aspect,library=poses,embedding=null){
  const grid=[];
  for(let y=1;y<scene.h;y+=4)for(let x=1;x<scene.w;x+=4)grid.push([(x+.5)/scene.w,(y+.5)/scene.h,scene.sal[y*scene.w+x]]);
  const total=grid.reduce((s,c)=>s+c[2],0);
  const norm=v=>Math.sqrt(v.reduce((s,n)=>s+n*n,0));
  const eNorm=embedding?norm(embedding):0;
  return library.map(pose=>{
    const sim=embedding&&pose.vector?clamp(pose.vector.reduce((s,n,i)=>s+n*embedding[i],0)/(eNorm*norm(pose.vector)||1),-1,1):0;
    let best;
    for(const flip of [false,true])for(const zoom of [1,1.12])for(const pos of [.5,.37,.63])for(const eyeY of [.45,.39]){
      const g=suggested(pose,aspect,zoom,flip,pos,eyeY);let hidden=0,faceBusy=0,near=0,area=0, centerY=0,centerX=0;
      const eyes=pose.eyes.map(([a,b])=>map(g,a,b));
      for(const [u,v,sal] of grid){
        if(covered(pose,g,u,v)){hidden+=sal;area++;}
        else {centerY+=v*sal;centerX+=u*sal;}
        if(eyes.some(e=>Math.abs(u-e.x)<.15*g.w&&Math.abs(v-e.y)<.065*g.h)){faceBusy+=sal;near++;}
      }
      const reserved=1-hidden/Math.max(.001,total);
      const ease=pose.level==='挑战'?0:pose.level==='进阶'?.45:1;
      const busyOverlap=Math.max(0,1-reserved-area/grid.length);
      const cx=(eyes[0].x+eyes[1].x)/2,cy=(eyes[0].y+eyes[1].y)/2;
      const rank=100*(reserved*.49+.12*(1-clamp(faceBusy/Math.max(1,near)/1.25))+.34*(sim+1)/2+.05*ease*(.35+.65*clamp((.35-scene.light)*6)))-Math.abs(cx-.5)*12-Math.abs(cy-.45)*7-32*busyOverlap;
      const vis=Math.max(.001,total-hidden);
      const region=centerY/vis<.40?'上方':centerX/vis<.43?'左侧':centerX/vis>.57?'右侧':'四周';
      const reason=cx<.43?'两人靠左入镜，把右侧留给风景。':cx>.57?'两人靠右入镜，把左侧留给风景。':region==='上方'?'两人靠近画面中央，头顶给风景留一点空间。':'两人居中入镜，让风景从肩膀两侧露出来。';
      const framingNote=cx<.43?'右侧留景':cx>.57?'左侧留景':region==='上方'?'头顶留景':'居中合影';
      if(!best||rank>best.rank)best={pose,g,rank,reserved,area:area/grid.length,reason,framingNote};
    }
    return best;
  }).sort((a,b)=>b.rank-a.rank);
}
export function assess(faces,choice,aspect){
  if(faces.length!==2)return {cue:'missing',count:faces.length,visible:faces[0]?.eye};
  const {pose,g}=choice;
  const ordered=orderedFaces(pose,g,aspect,faces);
  const targets=pose.eyes.map(([x,y])=>map(g,x,y));
  const errors=ordered.map((f,i)=>Math.hypot((f.eye.x-targets[i].x)*aspect,f.eye.y-targets[i].y));
  const actual=ordered.map(f=>f.eye);
  const delta=(a,b)=>Math.hypot((a.x-b.x)*aspect,a.y-b.y);
  const gap=delta(actual[0],actual[1])-delta(targets[0],targets[1]);
  const offsetY=(actual[0].y+actual[1].y-targets[0].y-targets[1].y)/2;
  const offsetX=(actual[0].x+actual[1].x-targets[0].x-targets[1].x)/2;
  const facing=g.flip?-1:1;
  const yaws=ordered.map((f,i)=>Math.abs(f.yaw*facing-pose.turn[i]));
  const yawError=mean(yaws);
  const heightError=Math.abs((actual[1].y-actual[0].y)-(targets[1].y-targets[0].y));
  const edge=ordered.some(f=>f.box[0]<.014||f.box[1]<.014||f.box[2]>.986||f.box[3]>.986);
  const faceScale=mean(ordered.map(f=>f.height)), expectedScale=mean(pose.heads.map(h=>h[3]*1.72*g.h));
  const scaleError=Math.abs(faceScale-expectedScale);
  let contactError=0;
  if(['kiss','turn','forehead','lip','brow'].includes(pose.family||pose.id)){
    const target=['forehead','brow'].includes(pose.family||pose.id)?ordered[1].brow:ordered[1].lip;
    contactError=Math.max(0,delta(ordered[0].lip,target)-.055);
  }
  const rolls=ordered.map((f,i)=>{
    if(!pose.roll)return 0;
    const [x,y]=pose.eyes[i],r=pose.heads[i][2]*.5;
    const tilt=g.plane?(map(g,x+r,y).y-map(g,x-r,y).y)/Math.max(.05,f.height):0;
    return Math.abs(f.roll*facing-pose.roll[i]-tilt);
  });
  const rollError=mean(rolls);
  const eyeError=pose.open?mean(ordered.map((f,i)=>Math.abs(f.openness-pose.open[i]))):0;
  const poseFit=.22*fit(Math.abs(gap),.14)+.27*fit(yawError,.66)+.16*fit(heightError,.13)+.17*fit(contactError,.115)+.12*fit(rollError,.37)+.06*fit(eyeError,.08);
  const framing=.7*fit(mean(errors),.21)+.3*fit(scaleError,.28);
  let cue='hold';
  if(edge||faceScale>expectedScale+.14)cue='back';
  else if(mean(errors)>.14&&Math.abs(offsetX)>.16)cue='center';
  else if(Math.abs(offsetY)>.14)cue=offsetY>0?'lower':'raise';
  else if(gap>.075)cue='closer';
  else if(['forehead','brow'].includes(pose.family||pose.id)&&heightError>.09)cue='height';
  else if(yawError>.38||rollError>.21)cue='turn';
  else if(contactError>.064)cue='closer';
  else if(faceScale<expectedScale-.14)cue='nearer';
  const actorErrors=cue==='turn'?yaws.map((e,i)=>Math.max(e/.38,rolls[i]/.21)):errors;
  const actor=actorErrors[0]>=actorErrors[1]?0:1;
  const toward=pose.eyes[1-actor][0]>=pose.eyes[actor][0]?1:-1;
  const target=pose.turn[actor],turnMore=(target-ordered[actor].yaw*facing)*Math.sign(target)>.12;
  let turnAction=turnMore&&Math.abs(target)>.38?(target*toward>0?'in':'out'):'front';
  if(rolls[actor]/.21>yaws[actor]/.38){
    const tilt=pose.roll[actor];
    turnAction=Math.abs(tilt)>.16?(tilt*toward>0?'tilt':'away'):'straight';
  }
  return {cue,count:2,poseFit,framing:framing*(edge?.72:1),ordered,targets,actor,turnAction,tooLow:actual[actor].y>targets[actor].y,
    closeEnough:!edge&&gap<.10&&yawError<.52&&heightError<.11,aspect};
}
export const messages={back:'把手机拿远一点，让两张脸都留在画面里。',center:'把镜头移向两人中间。',lower:'镜头往下瞄一点。',raise:'镜头往上瞄一点。',closer:'两个人再靠近一点。',height:'拿手机的人稍微抬高，另一位轻轻低头。',nearer:'手机拿近一点。',hold:'位置很好，保持一下。',missing:'暂未检测到人脸，试着把手机拿远一点。','one-face':'目前只确认到一张脸，另一位稍转向镜头。','manual-shot':'双人检测暂未成功，可直接按快门或用三秒倒计时。',occluded:'保持刚才的位置。',turn:'按参考姿势，轻轻转头。'};
messages.dark='脸上光线太暗，转向灯光或窗边。';
messages.bright='脸上光线太强，避开直射的光。';
export class Coach {
  constructor(listenAfter=0){
    this.listenAfter=listenAfter;this.lastSeen=-Infinity;this.lastEyes=[];this.since=0;this.key='';
    this.said='';this.at=-Infinity;this.lastFrame=-Infinity;this.alignedSince=null;this.invited=null;
    this.missingSince=null;this.missingSpoken=new Set();this.pairFrames=0;
  }
  update(now,assessment,pose){
    if(now-this.lastFrame>1400){this.since=now;this.key='';this.invited=null;this.alignedSince=null;}
    this.lastFrame=now;
    const a=assessment,invite=invitations[pose.family],waiting=now<this.listenAfter;
    let key=instruction(a,pose),occluded=false;
    if(a.count===2){
      if(++this.pairFrames>=3){this.missingSince=null;this.missingSpoken.clear();}
    }else{
      this.pairFrames=0;
      if(this.missingSince===null)this.missingSince=now;
      if(a.cue==='missing')key=now-this.missingSince>=9000?'manual-shot':a.count===1?'one-face':'missing';
    }
    if(assessment.count===2){
      this.lastSeen=now;this.lastEyes=a.ordered?.map(f=>f.eye)||[];this.aspect=a.aspect||1;
      if(!waiting&&invite&&a.closeEnough&&a.poseFit>.53&&a.framing>.50&&['turn','hold','closer'].includes(a.cue)){
        if(this.alignedSince===null)this.alignedSince=now;
      }else{this.alignedSince=null;this.invited=null;}
    }else{
      const samePlace=a.visible&&this.lastEyes.some(p=>Math.hypot((a.visible.x-p.x)*this.aspect,a.visible.y-p.y)<.20);
      occluded=a.cue==='missing'&&a.count===1&&samePlace&&now-this.lastSeen<1800;
      if(occluded)key='occluded';
      else{this.alignedSince=null;this.invited=null;}
    }
    if(key!==this.key){this.key=key;this.since=now;}
    const duration=now-this.since;
    const cueNow=invite&&this.invited===null&&this.alignedSince!==null&&now-this.alignedSince>=650&&a.count===2;
    if(cueNow)this.invited=now;
    const contact=this.invited!==null,acted=contact&&now-this.invited>=1450;
    let speak=!!cueNow;
    if(cueNow)key=invite;
    else if(contact)key=occluded?'occluded':invite;
    else if(!waiting&&key!=='occluded'&&duration>=(['missing','one-face','manual-shot'].includes(key)?1400:600)&&now-this.at>=3000&&
      (key!==this.said||now-this.at>=10500)&&!this.missingSpoken.has(key))speak=true;
    if(speak){this.said=key;this.at=now;if(['missing','one-face','manual-shot'].includes(key))this.missingSpoken.add(key);}
    const still=a.count===2&&a.cue==='hold'&&duration>=900;
    const ready=!waiting&&(invite?acted&&(still||occluded&&duration>=240):still);
    const text=waiting?brief(pose):lines[key]||(key.startsWith('pose-')?brief(pose):messages[key]);
    return {key,text,speak,ready,cueNow:!!cueNow,contact,occluded};
  }
}
