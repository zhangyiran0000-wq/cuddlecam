export async function probe(){
  const {liveFaceModel,canvas}=await import('/models.mjs'),{readFace}=await import('/engine.mjs');
  const library=await (await fetch('/library.json')).json(),net=await liveFaceModel(),results=[];
  const frame=canvas(640,360),ctx=frame.getContext('2d');let now=0;
  const times=[];
  for(const id of ['cheeks','front-4','shoulder','gaze-2','hand-5','kiss','forehead','lip-4','brow-2','sidekiss-7']){
    const pose=library.find(p=>p.id===id),img=new Image();img.src='assets/'+id+'.jpg';await img.decode();
    for(const lighting of ['normal','dim','covered']){
      const counts=[],frames=[];
      for(const scale of [.9,1,1.1]){
      net.reset();const samples=[];
      const side=381.25*scale,left=(640-side)*.5,top=(360-side)*.5;
      const centers=pose.eyes.map(([x,y],i)=>[(left+x*side)/640,(top+y*side)/360,side*Math.max(pose.heads[i][2],pose.heads[i][3])*3.25]);
      for(let i=0;i<10;i++){
        ctx.fillStyle='#474641';ctx.fillRect(0,0,640,360);
        ctx.save();ctx.filter=lighting==='dim'?'brightness(.3)':'none';ctx.drawImage(img,left,top,side,side);ctx.restore();
        if(lighting==='covered'){
          const [x,y,rx,ry]=pose.heads[0];ctx.fillStyle='#444540';
          ctx.fillRect(left+(x-rx*1.14)*side,top+(y-ry*1.15)*side,2.28*rx*side,2.3*ry*side);
        }
        const start=performance.now(),faces=net.observe(frame,readFace,centers,now+=250);times.push(performance.now()-start);
        samples.push(faces.length);
        if(lighting==='covered'&&faces.length>1)throw Error('Occlusion produced a false pair: '+id+' / '+scale+' / '+i);
      }
      counts.push(Math.max(...samples));frames.push(samples);
      }
      results.push({id,lighting,counts,frames});
    }
  }
  for(let i=0;i<10;i++){
    ctx.fillStyle='#777';ctx.fillRect(0,0,640,360);
    const faces=net.observe(frame,readFace,null,now+=250);
    if(faces.length)throw Error('Empty frame inherited previous face');
  }
  frame.width=480;frame.height=640;
  const portrait=new Image();portrait.src='assets/cheeks.jpg';await portrait.decode();
  for(let i=0;i<10;i++){
    ctx.fillStyle='#777';ctx.fillRect(0,0,480,640);ctx.drawImage(portrait,20,60,440,440);
    if(net.observe(frame,readFace,null,now+=250).length!==2)throw Error('Portrait frontal pair was missed');
  }
  times.sort((a,b)=>a-b);
  return {results,history:{medianMs:times[Math.floor(times.length/2)],p95Ms:times[Math.floor(times.length*.95)],maxMs:times.at(-1),frames:times.length,portraitFrames:10}};
}
