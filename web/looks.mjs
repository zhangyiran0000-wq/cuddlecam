import {canvas} from './models.mjs';

export const looks=[
  {id:'original',label:'原图'},
  {id:'anime',label:'动画人像'},
  {id:'strip',label:'暖光绘本'},
  {id:'manga',label:'黑白线稿'}
];
function resized(source,scale){
  const out=canvas(Math.max(1,Math.round(source.width*scale)),Math.max(1,Math.round(source.height*scale)));
  const c=out.getContext('2d',{willReadFrequently:true});c.imageSmoothingQuality='high';c.drawImage(source,0,0,out.width,out.height);
  return out;
}
export function reduced(source,limit){return resized(source,Math.min(1,limit/Math.max(source.width,source.height)));}
function drawingScale(source,id,meshes){
  const edge=Math.max(source.width,source.height);
  if(id!=='strip')return 512/edge;
  // Use one scale for the whole frame so that overlapping profiles keep their shared contour.
  const heights=meshes.map(points=>{
    const ys=points.map(p=>p.y);
    return (Math.max(...ys)-Math.min(...ys))*source.height;
  }).filter(h=>Number.isFinite(h)&&h>0);
  const average=heights.reduce((sum,h)=>sum+h,0)/heights.length;
  const target=heights.length?Math.max(480,Math.min(768,210*edge/average)):576;
  return target/edge;
}
export function requestDrawing(source,id,success,failure,meshes=[]){
  const small=resized(source,drawingScale(source,id,meshes));
  const context=small.getContext('2d');
  let worker=null,timer=0,ended=false;
  function cleanup(){clearTimeout(timer);worker?.terminate();worker=null;}
  function stop(){ended=true;cleanup();}
  function fail(){if(ended)return;stop();failure();}
  function start(scalar){
    if(ended)return;
    try{
      worker=new Worker('style-worker.js');
      worker.onerror=fail;
      worker.onmessage=({data})=>{
        if(ended)return;
        cleanup();
        if(data.error==='engine'&&!scalar){start(true);return;}
        if(data.error){fail();return;}
        try{
          const {w,h,rgba}=data,out=canvas(w,h);
          out.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba),w,h),0,0);
          ended=true;success(out);
        }catch{fail();}
      };
      const data=context.getImageData(0,0,small.width,small.height).data;
      worker.postMessage({id,scalar,width:small.width,height:small.height,rgba:data.buffer},[data.buffer]);
      timer=setTimeout(fail,120000);
    }catch{fail();}
  }
  start(false);return stop;
}
export function applyLook(source,amount,drawing){
  if(!drawing||!amount)return source;
  const out=canvas(source.width,source.height),ctx=out.getContext('2d',{willReadFrequently:true});
  if(amount<100)ctx.drawImage(source,0,0);
  ctx.globalAlpha=amount/100;ctx.imageSmoothingQuality='high';ctx.drawImage(drawing,0,0,out.width,out.height);
  return out;
}
