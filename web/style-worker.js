// Runs only for the lifetime of one local photo-to-drawing request.
const base=new URL('vendor/style/',self.location.href).href;
const models={
  anime:{file:'face-portrait.onnx',channels:3,fixed:512},
  strip:{file:'dct-storybook.onnx',channels:3,multiple:16,border:0,bgr:true},
  manga:{file:'manga-lines.onnx',channels:1,multiple:8,border:8}
};
function reflect(i,n){
  const v=((i%(2*n))+2*n)%(2*n);
  return v<n?v:2*n-1-v;
}
function tensor(pixels,w,h,iw,ih,model){
  const area=iw*ih,values=new Float32Array(area*3);
  const x0=Math.floor((iw-w)/2),y0=Math.floor((ih-h)/2);
  const color=model.channels===3,gain=color?2/255:1/255,offset=color?-1:0;
  for(let y=0;y<ih;y++){
    const row=reflect(y-y0,h)*w;
    for(let x=0;x<iw;x++){
      const k=(row+reflect(x-x0,w))*4,i=y*iw+x;
      for(let c=0;c<3;c++)values[i+c*area]=pixels[k+(model.bgr?2-c:c)]*gain+offset;
    }
  }
  return new ort.Tensor('float32',values,[1,3,ih,iw]);
}
// Return RGBA display pixels, keeping the generator's colours and full composition.
function crop(output,w,h,iw,ih,model){
  const result=new Uint8ClampedArray(w*h*4),stride=iw*ih;
  const x0=Math.floor((iw-w)/2),y0=Math.floor((ih-h)/2);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=(y+y0)*iw+x+x0,k=(y*w+x)*4;
    if(model.channels===3){
      for(let c=0;c<3;c++)result[k+c]=(output[i+(model.bgr?2-c:c)*stride]+1)*127.5;
    }else result[k]=result[k+1]=result[k+2]=output[i]*255;
    result[k+3]=255;
  }
  return result;
}
self.onmessage=async({data})=>{
  const {width:w,height:h,id,scalar}=data,model=models[id];
  if(!model){self.postMessage({error:'model'});return;}
  let stage='engine',net;
  try{
    importScripts(base+'ort.wasm.min.js');
    ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.simd=!scalar;ort.env.wasm.wasmPaths=base;
    const weights=await fetch(base+model.file);
    if(!weights.ok){stage='model';throw Error('Model asset unavailable');}
    net=await ort.InferenceSession.create(await weights.arrayBuffer(),{executionProviders:['wasm'],executionMode:'sequential'});
    stage='draw';
    const size=n=>model.fixed||Math.max(16,Math.ceil((n+2*model.border)/model.multiple)*model.multiple);
    const iw=size(w),ih=size(h);
    const input=tensor(new Uint8ClampedArray(data.rgba),w,h,iw,ih,model);
    const output=(await net.run({[net.inputNames[0]]:input}))[net.outputNames[0]];
    if(output.dims[2]!==ih||output.dims[3]!==iw||output.dims[1]!==model.channels)throw Error('Unexpected model output');
    const art=crop(output.data,w,h,iw,ih,model);
    input.dispose();output.dispose();await net.release();net=null;
    self.postMessage({w,h,rgba:art.buffer},[art.buffer]);
  }catch(error){self.postMessage({error:stage,detail:String(error.message||error)});}
};
