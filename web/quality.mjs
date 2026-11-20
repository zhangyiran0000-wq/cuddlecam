const ramp=(x,lo,hi)=>Math.max(0,Math.min(1,(x-lo)/(hi-lo)));
const luma=(d,k)=>(54*d[k]+183*d[k+1]+19*d[k+2])>>8;
function percentile(hist,count,fraction){
  let sum=0;for(let i=0;i<256;i++){sum+=hist[i];if(sum>=count*fraction)return i;}return 255;
}
// Meter each face inside its oval so a window, lamp or black background cannot
// dominate it. Use luminance percentiles and local contrast, not a target skin tone.
function region(img,box){
  const {width:w,height:h,data}=img;
  const [x0,y0,x1,y1]=box||[0,0,1,1],cx=(x0+x1)*w/2,cy=(y0+y1)*h/2;
  const rx=Math.max(2,(x1-x0)*w*.48),ry=Math.max(2,(y1-y0)*h*.46);
  const hist=new Uint32Array(256),grad=new Uint32Array(256),residual=new Uint32Array(256);
  let count=0,crushed=0,blown=0,smoothCount=0;
  const read=(x,y)=>luma(data,4*(y*w+x));
  for(let y=Math.max(2,Math.floor(y0*h));y<Math.min(h-2,Math.ceil(y1*h));y++)
    for(let x=Math.max(2,Math.floor(x0*w));x<Math.min(w-2,Math.ceil(x1*w));x++){
      if(box&&((x-cx)/rx)**2+((y-cy)/ry)**2>1)continue;
      const b=read(x,y);hist[b]++;count++;if(b<15)crushed++;if(b>245)blown++;
      // Sobel gradient after short-range averaging suppresses isolated sensor noise.
      const gx=(read(x+1,y-1)+2*read(x+1,y)+read(x+1,y+1)-read(x-1,y-1)-2*read(x-1,y)-read(x-1,y+1))/4;
      const gy=(read(x-1,y+1)+2*read(x,y+1)+read(x+1,y+1)-read(x-1,y-1)-2*read(x,y-1)-read(x+1,y-1))/4;
      const edge=Math.hypot(gx,gy);grad[Math.min(255,Math.round(edge))]++;
      if(edge<22){
        const neighbor=(read(x-1,y)+read(x+1,y)+read(x,y-1)+read(x,y+1))/4;
        residual[Math.round(Math.abs(b-neighbor))]++;smoothCount++;
      }
    }
  if(!count)return {exposure:0,sharp:0,dark:true,bright:false,unreadable:true};
  const p12=percentile(hist,count,.12),p50=percentile(hist,count,.50),p85=percentile(hist,count,.85);
  const shadows=ramp(p85,17,91)*(1-.77*ramp(crushed/count,.12,.87));
  const lights=(1-ramp(p12,207,248))*(1-.82*ramp(blown/count,.12,.86));
  const exposure=Math.min(shadows,lights);
  const contrast=ramp(p85-p12,5,52),edges=percentile(grad,count,.92);
  const grain=smoothCount>40?ramp(percentile(residual,smoothCount,.6),4,19):0;
  const sharp=ramp(edges,3,31)*(.32+.68*contrast)*(1-.8*grain);
  return {exposure,sharp,dark:shadows<.62,bright:lights<.62,unreadable:p85<21||p12>244||(p85-p12<7&&(p50<38||p50>226))};
}
export function meter(img,faces=[]){
  const regions=faces.length?faces.map(f=>region(img,f.box)):[region(img,null)];
  const exposure=Math.min(...regions.map(r=>r.exposure)),sharp=Math.min(...regions.map(r=>r.sharp));
  return {exposure,sharp,quality:exposure*(.38+.62*sharp),dark:regions.some(r=>r.dark),bright:regions.some(r=>r.bright),unreadable:regions.some(r=>r.unreadable)};
}
