import {guidePoint} from './framing.mjs';
// Sample the underlying camera pixels along the actual strokes. The guide is a
// separate DOM layer, so it cannot influence the samples or appear in a capture.
export function contrastInk(outline,photo){
  const surface=document.createElement('canvas'),size=48;surface.width=surface.height=size;
  const c=surface.getContext('2d',{willReadFrequently:true});
  let dots=[],last=0,previous='',waiting=0;
  let candidate='',since=0;
  function resetFocus(){candidate='';since=0;delete outline.dataset.focus;}
  function track(a,coach,pose,now){
    let focus='full';
    if(coach.contact||coach.occluded||a.count===2&&a.cue==='hold')focus='quiet';
    else if(a.count===2&&a.framing>.47){
      if(a.cue==='hand'&&pose.hand)focus='hand';
      else if(['turn','height','closer'].includes(a.cue))focus=(pose.family==='shoulder'&&a.cue==='closer'?'shoulder':'head')+a.actor;
    }
    if(focus!==candidate){candidate=focus;since=now;return;}
    if(now-since<350||outline.dataset.focus===focus)return;
    if(!['quiet','full'].includes(focus)){
      const id=a.actor??0,[cx,cy,rx,ry]=pose.heads[id];
      let x=cx,y=cy,w=rx*1.5,h=ry*1.35;
      if(focus==='hand'){[x,y]=pose.hand;w=.19;h=.17;}
      if(focus.startsWith('shoulder')){y=cy+ry*1.15;w=rx*1.75;h=ry;}
      for(const [name,v] of Object.entries({x,y,w,h}))outline.style.setProperty('--focus-'+name,(v*100)+'%');
    }
    outline.dataset.focus=focus;
  }
  function readGuide(){
    c.clearRect(0,0,size,size);c.drawImage(outline,0,0,size,size);
    const d=c.getImageData(0,0,size,size).data;dots=[];
    for(let i=0;i<size*size;i++)if(d[4*i+3]>24)dots.push([((i%size)+.5)/size,(Math.floor(i/size)+.5)/size,d[i*4+3]]);
    last=0;previous='';waiting=0;
  }
  return {readGuide,resetFocus,track,update(g,force=false){
    const now=performance.now();if(!dots.length||!g||!force&&now-last<480)return;
    last=now;c.drawImage(photo,0,0,size,size);const d=c.getImageData(0,0,size,size).data;
    let weight=0,bright=0;
    for(const [u,v,w] of dots){
      const point=guidePoint(g,u,v),x=Math.floor(point.x*size),y=Math.floor(point.y*size);
      if(x<0||x>=size||y<0||y>=size)continue;
      const i=(y*size+x)*4;weight+=w;if(.21*d[i]+.72*d[i+1]+.07*d[i+2]>157)bright+=w;
    }
    if(!weight)return;
    const share=bright/weight,current=outline.dataset.ink||'light';
    const next=share>.66?'dark':share<.43?'light':current;
    waiting=next===previous?waiting+1:1;previous=next;
    if(force||waiting>=2)outline.dataset.ink=next;
  }};
}
