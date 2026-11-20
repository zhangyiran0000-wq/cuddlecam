import {canvas} from './models.mjs';
import {applyLook,looks,reduced,requestDrawing} from './looks.mjs';

// Masks and deformation anchors are derived from the captured frame's face meshes.
const oval=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
const features=[
  [33,246,161,160,159,158,157,173,133,155,154,153,145,144,163,7],
  [263,466,388,387,386,385,384,398,362,382,381,380,374,373,390,249],
  [70,63,105,66,107,55,65,52,53,46],[336,296,334,293,300,276,283,282,295,285],
  [61,40,37,0,267,270,291,321,314,17,84,91],[98,97,2,326,327,278,4,48]
];
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const luminance=(r,g,b)=>.24*r+.65*g+.11*b;
export const naturalPortrait={tone:35,slim:15,smooth:30};
function polygon(ctx,points,indices){
  ctx.beginPath();indices.forEach((v,i)=>{const p=points[v];if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);});ctx.closePath();
}
export function drawSkinMask(ctx,points,size,skin,lip,detail){
  ctx.fillStyle=skin;ctx.filter='blur('+Math.max(.7,size*.009)+'px)';polygon(ctx,points,oval);ctx.fill();
  ctx.filter='blur('+Math.max(.6,size*.004)+'px)';ctx.lineWidth=Math.max(1,size*.019);
  for(const [index,f] of features.entries()){
    ctx.fillStyle=ctx.strokeStyle=index===4?lip:detail;polygon(ctx,points,f);ctx.fill();ctx.stroke();
  }
}
function retouchFace(out,original,mesh,other,settings){
  const width=out.width,height=out.height;
  const face=oval.map(i=>mesh[i]);
  const left=Math.min(...face.map(p=>p.x))*width,right=Math.max(...face.map(p=>p.x))*width;
  const top=Math.min(...face.map(p=>p.y))*height,bottom=Math.max(...face.map(p=>p.y))*height;
  const size=right-left,pad=Math.ceil(size*.21)+2;
  const x0=Math.max(0,Math.floor(left)-pad),y0=Math.max(0,Math.floor(top)-pad);
  const w=Math.min(width,Math.ceil(right)+pad)-x0,h=Math.min(height,Math.ceil(bottom)+pad)-y0;
  if(w<5||h<5||size<8)return;
  const coords=m=>m.map(p=>({x:p.x*width-x0,y:p.y*height-y0}));
  const pts=coords(mesh),patch=canvas(w,h),cx=patch.getContext('2d',{willReadFrequently:true});
  cx.drawImage(original,x0,y0,w,h,0,0,w,h);
  const raw=cx.getImageData(0,0,w,h).data;
  const oc=out.getContext('2d',{willReadFrequently:true}),result=oc.getImageData(x0,y0,w,h),dst=result.data;
  const mask=canvas(w,h),mc=mask.getContext('2d',{willReadFrequently:true});
  // R marks skin, G protects neighbouring faces and B marks lips for the colour control.
  drawSkinMask(mc,pts,size,'#f00','#0000ff','#000');
  for(const m of other){mc.fillStyle='#00ff00';polygon(mc,coords(m),oval);mc.fill();}
  const masks=mc.getImageData(0,0,w,h).data;
  for(let i=0;i<masks.length;i+=4){
    const alpha=masks[i+3]/255;if(alpha===1)continue;
    masks[i]*=alpha;masks[i+1]*=alpha;masks[i+2]*=alpha;
  }
  let low=null;
  if(settings.smooth){
    cx.filter='blur('+Math.max(.9,size*.014)+'px)';cx.drawImage(original,x0,y0,w,h,0,0,w,h);
    low=cx.getImageData(0,0,w,h).data;
  }
  const tone=settings.tone/100,smoothing=settings.smooth/100,slim=settings.slim/100;
  const l=pts[172],r=pts[397],jawWidth=Math.hypot(r.x-l.x,r.y-l.y);
  const ux=(r.x-l.x)/Math.max(1,jawWidth),uy=(r.y-l.y)/Math.max(1,jawWidth);
  const radius=Math.max(2,jawWidth*.32),inv=1/(radius*radius),pull=jawWidth*.083*slim;
  // A jaw touching the second face cannot be narrowed independently of that face.
  // Keep the shared silhouette intact while allowing the outer cheek to move.
  let leftPull=pull,rightPull=pull;
  if(pull){
    mc.lineWidth=2*(radius+pull);mc.lineJoin='round';
    for(const m of other){
      polygon(mc,coords(m),oval);
      if(mc.isPointInPath(l.x,l.y)||mc.isPointInStroke(l.x,l.y))leftPull=0;
      if(mc.isPointInPath(r.x,r.y)||mc.isPointInStroke(r.x,r.y))rightPull=0;
    }
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const at=(y*w+x)*4,free=1-masks[at+1]/255;
    if(free<.02)continue;
    let move=0;
    if(slim){
      const lx=x-l.x-pull*.5*ux,ly=y-l.y-pull*.5*uy;
      const rx=x-r.x+pull*.5*ux,ry=y-r.y+pull*.5*uy;
      const a=Math.max(0,1-(lx*lx+ly*ly)*inv),b=Math.max(0,1-(rx*rx+ry*ry)*inv);
      move=(b*b*rightPull-a*a*leftPull)*free;
    }
    if(Math.abs(move)<.004&&!(masks[at]*tone||masks[at]*smoothing||masks[at+2]*tone))continue;
    const sx=clamp(x+move*ux,0,w-1.001),sy=clamp(y+move*uy,0,h-1.001);
    const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
    const k=(iy*w+ix)*4,down=k+w*4,nearest=(Math.round(sy)*w+Math.round(sx))*4;
    // A contact pose can put another person's face immediately next to this jaw.
    if(masks[nearest+1]>128)continue;
    const skin=masks[nearest]/255*free,lip=masks[nearest+2]/255*free;
    let mix=0;
    if(low&&skin){
      const err=Math.abs(luminance(raw[nearest]-low[nearest],raw[nearest+1]-low[nearest+1],raw[nearest+2]-low[nearest+2]));
      mix=smoothing*skin*.76/(1+(err/14)**2);
    }
    for(let ch=0;ch<3;ch++){
      const a=raw[k+ch]+(raw[k+4+ch]-raw[k+ch])*fx;
      const b=raw[down+ch]+(raw[down+4+ch]-raw[down+ch])*fx;
      let v=a+(b-a)*fy;
      if(mix)v+=(low[nearest+ch]-v)*mix;
      if(tone){
        const mid=4*(v/255)*(1-v/255);
        v+=tone*mid*(skin*(ch===0?14:ch===1?6:3)+lip*(ch===0?13:ch===1?-4:-1));
      }
      dst[at+ch]=v;
    }
  }
  oc.putImageData(result,x0,y0);
}
export function retouch(original,meshes,settings){
  if(!meshes.length||!(settings.slim||settings.smooth||settings.tone))return original;
  const out=canvas(original.width,original.height);
  out.getContext('2d',{willReadFrequently:true}).drawImage(original,0,0);
  meshes.forEach((m,i)=>retouchFace(out,original,m,meshes.filter((_,j)=>i!==j),settings));
  return out;
}

export function portraitEditor(onEdit,onCompare){
  const $=id=>document.getElementById(id),sliders=['tone','slim','smooth'].map($);
  let source=null,small=null,meshes=[],preview=null,full=null,compare=false,frame=0;
  let look=looks[0],strength=100,job=null,previousLayer=null;
  const drawings=new Map(),buttons=new Map();
  function values(){return Object.fromEntries(sliders.map(s=>[s.id,Number(s.value)]));}
  function beautyActive(){return meshes.length>0&&sliders.some(s=>Number(s.value)>0);}
  function changed(){return beautyActive()||(look.id!=='original'&&strength>0);}
  function pending(){return !!job&&strength>0;}
  function stopJob(){if(job)job.cancel?.();job=null;}
  function update(){
    for(const s of sliders)s.nextElementSibling.value=s.value;
    $('resetEdit').disabled=!beautyActive();$('compare').disabled=!changed();
    $('strength').value=strength;$('strengthValue').value=strength+'%';
    preview=full=null;compare=false;onEdit();
    cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>onCompare());
  }
  function tile(id,source){
    const thumb=buttons.get(id).firstChild,side=Math.min(source.width,source.height);
    thumb.getContext('2d').drawImage(source,(source.width-side)/2,(source.height-side)/2,side,side,0,0,thumb.width,thumb.height);
  }
  function drawSelected(){
    if(!strength||look.id==='original'||drawings.has(look.id)){stopJob();$('styleNote').textContent='';return;}
    if(job?.id===look.id)return;
    stopJob();const active={id:look.id};job=active;
    $('styleNote').textContent='正在本机绘制'+look.label+'…';
    const fail=()=>{
      if(job!==active)return;
      job=null;choose(looks[0]);$('styleNote').textContent='这次绘制未完成，原图已保留。可再点画风重试。';
    };
    try{active.cancel=requestDrawing(source,active.id,layer=>{
      if(job!==active)return;
      job=null;
      drawings.set(active.id,layer);tile(active.id,layer);
      $('styleNote').textContent='';update();
    },fail,meshes);}catch{fail();}
  }
  function choose(next){
    if(look!==next)previousLayer=look.id==='original'?null:(drawings.get(look.id)||previousLayer);
    look=next;
    for(const [id,button] of buttons)button.setAttribute('aria-pressed',String(id===next.id));
    $('strengthRow').hidden=next.id==='original';
    drawSelected();update();
  }
  for(const preset of looks){
    const b=document.createElement('button'),label=document.createElement('span');
    b.className='look';b.dataset.look=preset.id;b.setAttribute('aria-pressed',String(preset.id==='original'));
    const thumb=canvas(128,128);thumb.className='look-tile';thumb.setAttribute('aria-hidden','true');
    if(preset.id!=='original')thumb.style.backgroundImage='url("vendor/style/'+preset.id+'.webp")';
    label.textContent=preset.label;b.append(thumb,label);b.onclick=()=>{if(look!==preset)choose(preset);};
    buttons.set(preset.id,b);$('lookRail').append(b);
  }
  $('strength').oninput=e=>{strength=Number(e.target.value);drawSelected();update();};
  function set(v){for(const s of sliders)s.value=v[s.id]||0;update();}
  for(const s of sliders)s.oninput=update;
  $('natural').onclick=()=>set(naturalPortrait);$('resetEdit').onclick=()=>set({});
  const button=$('compare');
  const compareTo=state=>{if(compare===state)return;compare=state;onCompare();};
  button.onpointerdown=e=>{if(e.button!==0||!changed())return;e.preventDefault();button.setPointerCapture(e.pointerId);compareTo(true);};
  button.onpointerup=button.onpointercancel=button.onlostpointercapture=button.onblur=()=>compareTo(false);
  button.onkeydown=e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();compareTo(true);}};
  button.onkeyup=e=>{if([' ','Enter'].includes(e.key))compareTo(false);};
  return {
    changed,pending,
    clear(){
      cancelAnimationFrame(frame);stopJob();drawings.clear();
      source=small=full=preview=previousLayer=null;meshes=[];compare=false;
    },
    load(photo,faces,levels=null){
      this.clear();source=photo;meshes=faces.map(f=>f.mesh).filter(Boolean);
      for(const s of sliders){s.value=meshes.length?(levels?.[s.id]||0):0;s.nextElementSibling.value=s.value;}
      $('portraitTools').open=false;$('faceTools').hidden=!meshes.length;
      $('faceNote').textContent=meshes.length?(meshes.length===2?'已识别两张脸。':'仅调整检测到的这一张脸。'):'画面里没有检测到清晰的人脸，整图风格仍可使用。';
      for(const b of buttons.values())b.firstChild.getContext('2d').clearRect(0,0,128,128);
      tile('original',photo);
      strength=100;choose(looks[0]);$('lookRail').scrollLeft=0;
    },
    render(isPreview){
      if(!source||!changed())return source;
      if(isPreview&&compare)return source;
      const layer=drawings.get(look.id)||(isPreview&&pending()?previousLayer:null);
      const process=base=>retouch(applyLook(base,strength,layer),meshes,values());
      if(!isPreview)return full||=process(source);
      if(!small)small=Math.max(source.width,source.height)>960?reduced(source,960):source;
      return preview||=process(small);
    }
  };
}
