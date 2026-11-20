import {canvas,openAestheticModel,rateImage} from './models.mjs';

const groups={front:'natural',gaze:'natural',back:'natural',cheek:'close',shoulder:'close',temples:'close',nose:'close',
  lip:'kiss',brow:'kiss',sidekiss:'kiss',hand:'play',play:'play'};
export const templateGroup=pose=>groups[pose.family]||'natural';
// Curated per picture: 1 for flirtatious gestures, 2 for the closest contact.
// The bonus is bounded so a poor scene match can still lose its place.
export const preferenceScore=(record,enabled)=>record.rank+(enabled?12*(record.pose.intimacy||0):0);

// Prefer different interactions while letting a strong scene match win. The same
// choice rule applies if the comparison model is unavailable or a group is small.
export function variedPicks(records,count,score=r=>r.rank){
  const pool=[...records],out=[];
  while(pool.length&&out.length<count){
    let best=-Infinity,index=0;
    for(const [i,r] of pool.entries()){
      let value=score(r);
      for(const chosen of out){
        if(chosen.pose.family===r.pose.family)value-=10;
        if(templateGroup(chosen.pose)===templateGroup(r.pose))value-=7;
      }
      if(value>best){best=value;index=i;}
    }
    out.push(pool.splice(index,1)[0]);
  }
  return out;
}

export async function sceneThumbnail(record,background){
  const scale=384/Math.max(background.width,background.height);
  const thumb=canvas(Math.max(1,Math.round(background.width*scale)),Math.max(1,Math.round(background.height*scale)));
  const {width:w,height:h}=thumb,c=thumb.getContext('2d'),g=record.g;
  c.drawImage(background,0,0,w,h);
  const load=async src=>{const im=new Image();im.src=src;await im.decode();return im;};
  const [figure,ink]=await Promise.allSettled([load('figures/'+record.pose.id+'.webp'),load('sketches/'+record.pose.id+'.webp')]);
  const layer=canvas(w,h),art=layer.getContext('2d'),left=w*g.x,right=w*(g.x+g.w);
  art.save();art.translate(g.flip?right:left,h*g.y);if(g.flip)art.scale(-1,1);
  if(figure.status==='fulfilled'){
    art.drawImage(figure.value,0,0,g.w*w,g.h*h);
  }
  if(ink.status==='fulfilled'){
    art.globalAlpha=figure.status==='fulfilled'?.62:1;
    art.filter='brightness(0) invert(1) drop-shadow(0 0 1.1px #211b15)';art.drawImage(ink.value,0,0,g.w*w,g.h*h);
  }
  art.restore();
  // Soften only the side seams of the square photo. Leave the chest opaque
  // where the photograph and the live guide meet the bottom of the frame.
  art.globalCompositeOperation='destination-in';
  function fade(x1,x2){
    const ramp=art.createLinearGradient(x1,0,x2,0);
    ramp.addColorStop(0,'transparent');ramp.addColorStop(1,'black');
    art.fillStyle=ramp;art.fillRect(0,0,w,h);
  }
  if(left>1)fade(left,left+.06*g.w*w);
  if(right<w-1)fade(right,right-.06*g.w*w);
  c.drawImage(layer,0,0);
  return thumb.toDataURL('image/jpeg',.90);
}

// Compare a small, diverse shortlist on exactly the same captured background.
// Each transparent reference figure is positioned with its own proposed guide.
export async function compositionPicks(records,background,isCurrent,preferIntimate=false){
  const score=r=>preferenceScore(r,preferIntimate);
  const shortlist=variedPicks(records,6,score);
  const fallback=shortlist.slice(0,3);
  if(!shortlist.length)return fallback;
  let net;
  try{
    const figures=await Promise.all(shortlist.map(async r=>{
      const im=new Image();im.src='figures/'+r.pose.id+'.webp';await im.decode();return im;
    }));
    if(!isCurrent())return fallback;
    net=await openAestheticModel();
    const preview=canvas(224,224),ctx=preview.getContext('2d'),scores=new Map();
    for(const [i,r] of shortlist.entries()){
      if(!isCurrent())return fallback;
      const g=r.g;ctx.drawImage(background,0,0,224,224);ctx.save();
      ctx.translate(224*(g.x+(g.flip?g.w:0)),224*g.y);
      if(g.flip)ctx.scale(-1,1);
      ctx.drawImage(figures[i],0,0,224*g.w,224*g.h);ctx.restore();
      const value=rateImage(net,preview);
      if(value===null)return fallback;
      scores.set(r,score(r)+5*(value-5));
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    return variedPicks(shortlist,3,r=>scores.get(r));
  }catch{return fallback;}finally{net?.close();}
}
