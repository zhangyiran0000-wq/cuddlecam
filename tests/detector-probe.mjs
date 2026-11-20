// Exercise the actual packaged detector on the same pairs at several sizes and
// exposures. These are repeatable image tests, not a field accuracy benchmark.
export async function probe(){
  const {faceModel,faceObservations,canvas}=await import('/models.mjs');
  const {readFace}=await import('/engine.mjs');
  const library=await (await fetch('/library.json')).json(),net=await faceModel();
  const results=[];
  const ids=['cheeks','front-4','shoulder','gaze-2','hand-5','kiss','forehead','lip-4','brow-2','sidekiss-7'];
  const frame=canvas(512,288),ctx=frame.getContext('2d');
  for(const id of ids){
    const pose=library.find(p=>p.id===id),img=new Image();
    img.src='assets/'+id+'.jpg';await img.decode();
    for(const lighting of ['normal','dim','covered']){
      const counts=[],rescued=[];
      for(const scale of [.9,1,1.10]){
        ctx.fillStyle='#474641';ctx.fillRect(0,0,512,288);
        const side=305*scale,left=(512-side)*.5,top=(288-side)*.50;
        ctx.save();ctx.filter=lighting==='dim'?'brightness(.3)':'none';ctx.drawImage(img,left,top,side,side);ctx.restore();
        if(lighting==='covered'){
          const [x,y,rx,ry]=pose.heads[0];
          ctx.fillStyle='#444540';ctx.fillRect(left+(x-rx*1.14)*side,top+(y-ry*1.15)*side,2.28*rx*side,2.3*ry*side);
        }
        const centers=pose.eyes.map(([x,y])=>[(left+x*side)/512,(top+y*side)/288]);
        const faces=faceObservations(net,frame,readFace,centers);
        counts.push(faces.length);
        if(faces.length<2){
          const crop=canvas(256,256),cc=crop.getContext('2d');
          for(const [i,[x,y]] of centers.entries()){
            if(faces.some(f=>Math.hypot((f.eye.x-x)*512,(f.eye.y-y)*288)<side*.07))continue;
            const r=pose.heads[i],s=Math.min(288,Math.max(90,side*Math.max(r[2],r[3])*3.25));
            const l=Math.max(0,Math.min(512-s,x*512-s*.5)),t=Math.max(0,Math.min(288-s,y*288-s*.43));
            cc.drawImage(frame,l,t,s,s,0,0,256,256);
            for(const mesh of net.detect(crop).faceLandmarks){
              const obs=readFace(mesh.map(p=>({x:(l+p.x*s)/512,y:(t+p.y*s)/288})));if(!obs)continue;
              if(Math.hypot((obs.eye.x-x)*512,(obs.eye.y-y)*288)>s*.28)continue;
              if(faces.every(f=>Math.hypot((f.eye.x-obs.eye.x)*512,(f.eye.y-obs.eye.y)*288)>Math.min(f.height,obs.height)*288*.48))faces.push(obs);
              if(faces.length===2)break;
            }
            if(faces.length===2)break;
          }
        }
        rescued.push(faces.length);
      }
      results.push({id,lighting,counts,rescued});
    }
  }
  const {GuideFollower,place,anchorOf,suggested}=await import('/framing.mjs');
  const pose=library.find(p=>p.id==='cheeks'),initial=suggested(pose,16/9,1,false);
  const photo=new Image();photo.src='assets/cheeks.jpg';await photo.decode();
  const point=anchorOf(pose,initial),tracker=new GuideFollower(),history=[];
  let guide=initial,now=0;
  for(const scale of [1,1.25,.82]){
    const g=place(pose,16/9,initial.h*scale,point.x,point.y,false);
    const centers=pose.eyes.map(([x,y])=>[g.x+x*g.w,g.y+y*g.h]);
    let paired=0;
    for(let i=0;i<14;i++){
      ctx.fillStyle='#4c4d48';ctx.fillRect(0,0,512,288);
      ctx.drawImage(photo,g.x*512+Math.sin(i),g.y*288,g.w*512,g.h*288);
      const detected=faceObservations(net,frame,readFace,centers);if(detected.length===2)paired++;
      const update=tracker.update(pose,guide,16/9,detected,now+=220);if(update.frame)guide=update.frame;
    }
    history.push({scale,paired,guideHeight:guide.h});
  }
  return {results,history};
}
