const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const canvas=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
// Eye separation distinguishes adjacent profiles even when their boxes overlap.
// Never return a remembered face as a detection in the current frame.
export function sameFace(a,b){
  const dx=(a.eye.x-b.eye.x)/Math.max(.025,(a.width+b.width)/2);
  const dy=(a.eye.y-b.eye.y)/Math.max(.025,(a.height+b.height)/2);
  const distance=Math.hypot(dx,dy);
  const x=Math.max(0,Math.min(a.box[2],b.box[2])-Math.max(a.box[0],b.box[0]));
  const y=Math.max(0,Math.min(a.box[3],b.box[3])-Math.max(a.box[1],b.box[1]));
  const overlap=x*y/Math.max(.00001,Math.min(a.width*a.height,b.width*b.height));
  return distance<.42||overlap>.72&&distance<.68;
}
function add(all,meshes,read,transform=p=>p,confirm=null){
  for(const mesh of meshes){
    const obs=read(mesh.map(transform));
    if(obs&&all.every(f=>!sameFace(f,obs))&&(!confirm||confirm(obs)))all.push(obs);
    if(all.length>=2)break;
  }
  return all;
}
function crop(model,input,read,all,target,attempt=-1,confirm=null){
  const w=input.width,h=input.height;
  const side=Math.min(Math.max(target.size||Math.min(w,h)*.72,80),w,h);
  const x=clamp(target.x*w-side*.5,0,w-side),y=clamp(target.y*h-side*.43,0,h-side);
  const region=canvas(256,256),ctx=region.getContext('2d');
  const [degrees,brightness]=attempt<0?[0,1]:[[0,.55],[-30,1],[30,.55],[60,1],[-60,1]][attempt%5];
  const angle=degrees*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
  ctx.fillStyle='#777';ctx.fillRect(0,0,256,256);
  ctx.translate(128,128);ctx.rotate(angle);ctx.filter='brightness('+brightness+')';
  ctx.drawImage(input,x,y,side,side,-112,-112,224,224);
  const localRead=mesh=>{
    const obs=read(mesh);if(!obs)return null;
    // A retry is looking for this head, not tiny face-like patches elsewhere in the crop.
    const distance=Math.hypot((obs.eye.x-target.x)*w,(obs.eye.y-target.y)*h);
    if(distance>side*.36||Math.max(obs.width*w,obs.height*h)<side*.25)return null;
    return obs;
  };
  return add(all,model.detect(region).faceLandmarks,localRead,p=>{
    const a=(p.x*256-128)/224,b=(p.y*256-128)/224;
    return {...p,x:(x+(a*cos+b*sin+.5)*side)/w,y:(y+(-a*sin+b*cos+.5)*side)/h};
  },confirm);
}
// Exposure/roll retries are for inference only; the preview and saved photo are untouched.
export function imageFaces(model,input,read,centers=null){
  const all=model.detect(input).faceLandmarks.map(read).filter(Boolean).slice(0,2);
  if(all.length===2)return all;
  const pending=[];let view=0;
  const confirm=obs=>{
    const seen=pending.some(p=>p.view!==view&&sameFace(p.face,obs));
    pending.push({face:obs,view});return seen;
  };
  const targets=(centers||[[.31,.42],[.69,.47]]).map(([x,y,size])=>({x,y,size}));
  for(const target of targets){
    view++;crop(model,input,read,all,target,-1,confirm);if(all.length===2)return all;
  }
  for(let i=0;i<5&&all.length<2;i++)for(const target of targets){
    view++;crop(model,input,read,all,target,i,confirm);if(all.length===2)break;
  }
  return all;
}
export class FaceStream {
  constructor(video,still){this.video=video;this.still=still;this.stamp=-1;this.reset();}
  reset(){this.history=[];this.pending=[];this.at=-Infinity;this.attempt=0;this.dimensions='';}
  observe(input,read,centers=null,now=performance.now()){
    const dimensions=input.width+'x'+input.height;
    // Reopening a camera, rotating, or returning from a menu invalidates spatial history.
    const fresh=now-this.at>1200||dimensions!==this.dimensions;
    if(fresh){this.history=[];this.pending=[];}
    this.dimensions=dimensions;
    this.stamp=Math.max(this.stamp+1,now);
    let all;
    try{all=this.video.detectForVideo(input,this.stamp).faceLandmarks.map(read).filter(Boolean).slice(0,2);}
    catch{all=this.still.detect(input).faceLandmarks.map(read).filter(Boolean).slice(0,2);}
    // Confirm a new view with stateless detection before accepting temporal tracks.
    if(fresh)all=this.still.detect(input).faceLandmarks.map(read).filter(Boolean).slice(0,2);
    if(all.length<2){
      const remembered=this.history.filter(f=>now-f.at<1200&&all.every(v=>!sameFace(v,f)))
        .map(f=>({x:f.eye.x,y:f.eye.y,size:Math.max(f.width*input.width,f.height*input.height)*1.8}));
      const candidates=remembered.concat((centers||[[.28,.43],[.72,.43]]).map(([x,y,size])=>({x,y,size})));
      // One local retry plus one different roll/exposure retry per frame bounds live cost.
      const target=candidates[this.attempt%Math.max(1,candidates.length)];
      this.pending=this.pending.filter(p=>now-p.at<1000);
      let view='normal:'+target?.x+':'+target?.y;
      const confirm=obs=>{
        const seen=this.history.some(p=>now-p.at<1200&&sameFace(p,obs))||
          this.pending.some(p=>p.view!==view&&sameFace(p.face,obs));
        this.pending.push({face:obs,view,at:now});return seen;
      };
      if(target)crop(this.still,input,read,all,target,-1,confirm);
      view=this.attempt%5+':'+target?.x+':'+target?.y;
      if(all.length<2&&target)crop(this.still,input,read,all,target,this.attempt,confirm);
      this.attempt++;
    }
    const previous=this.history.filter(f=>now-f.at<1200&&all.every(v=>!sameFace(v,f)));
    this.history=all.map(f=>({...f,at:now})).concat(previous).slice(0,4);this.at=now;
    return all;
  }
}
