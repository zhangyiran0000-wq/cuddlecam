import {FilesetResolver, FaceLandmarker, HandLandmarker, ImageEmbedder,ImageSegmenter,PoseLandmarker,ImageClassifier} from './vendor/vision_bundle.mjs';
import {guidePoint} from './framing.mjs';
import {imageFaces,FaceStream} from './face-detection.mjs';
const files=()=>FilesetResolver.forVisionTasks(new URL('./vendor/wasm',import.meta.url).href);
const base=name=>({modelAssetPath:new URL('./vendor/'+name,import.meta.url).href,delegate:'CPU'});
const cache=new Map();
function once(key,create){
  if(!cache.has(key))cache.set(key,create().catch(e=>{cache.delete(key);throw e;}));
  return cache.get(key);
}
export const faceModel=()=>once('face',async()=>FaceLandmarker.createFromOptions(await files(),{baseOptions:base('face.task'),runningMode:'IMAGE',numFaces:2,minFaceDetectionConfidence:.37,minFacePresenceConfidence:.4}));
export const liveFaceModel=()=>once('live-face',async()=>{
  const still=await faceModel();
  try{
    const video=await FaceLandmarker.createFromOptions(await files(),{baseOptions:base('face.task'),runningMode:'VIDEO',numFaces:2,minFaceDetectionConfidence:.37,minFacePresenceConfidence:.4,minTrackingConfidence:.5});
    return new FaceStream(video,still);
  }catch{return new FaceStream({detectForVideo:input=>still.detect(input)},still);}
});
export const handModel=()=>once('hand',async()=>HandLandmarker.createFromOptions(await files(),{baseOptions:base('hand.task'),runningMode:'IMAGE',numHands:2,minHandDetectionConfidence:.40,minHandPresenceConfidence:.45}));
export const embedModel=()=>once('embed',async()=>ImageEmbedder.createFromOptions(await files(),{baseOptions:base('embed.tflite'),l2Normalize:true,runningMode:'IMAGE'}));
export const segmentModel=()=>once('segment',async()=>ImageSegmenter.createFromOptions(await files(),{baseOptions:base('segment.tflite'),outputCategoryMask:false,outputConfidenceMasks:true}));
export const bodyModel=()=>once('body',async()=>PoseLandmarker.createFromOptions(await files(),{baseOptions:base('pose.task'),numPoses:2,runningMode:'IMAGE',minPoseDetectionConfidence:.40,minPosePresenceConfidence:.45}));
export async function openAestheticModel(){
  return ImageClassifier.createFromOptions(await files(),{baseOptions:base('nima-aesthetic.tflite'),runningMode:'IMAGE',maxResults:10,scoreThreshold:0});
}
export function rateImage(net,photo){
  const input=canvas(224,224),ctx=input.getContext('2d');
  ctx.imageSmoothingQuality='high';ctx.drawImage(photo,0,0,224,224);
  const bins=net.classify(input).classifications[0]?.categories||[];
  if(bins.length!==10||new Set(bins.map(c=>c.index)).size!==10)return null;
  let mass=0,mean=0;
  for(const {index,score} of bins){
    if(!Number.isInteger(index)||index<0||index>9||!Number.isFinite(score)||score<0)return null;
    mass+=score;mean+=(index+1)*score;
  }
  return Math.abs(1-mass)<.02?mean/mass:null;
}
export async function foreground(input,w,h){
  const model=await segmentModel();
  const result=model.segment(input);
  try{
    const ms=result.confidenceMasks,mask=ms[ms.length-1],arr=mask.getAsFloat32Array(),out=new Uint8Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)out[y*w+x]=arr[Math.floor((y+.5)/h*mask.height)*mask.width+Math.floor((x+.5)/w*mask.width)]>.56?1:0;
    return out;
  }finally{result.close();}
}
export function vector(model,input){return model.embed(input).embeddings[0].floatEmbedding;}
export const canvas=(width,height)=>Object.assign(document.createElement('canvas'),{width,height});
// Reframe the two half profiles separately when the full view yields fewer than two faces.
// Spatial deduplication prevents a repeated detection of one person from becoming a second face.
export function faceObservations(model,input,read,centers=null){
  return model.observe?model.observe(input,read,centers):imageFaces(model,input,read,centers);
}
export function fitted(out,source,mirror=false){
  const ctx=out.getContext('2d',{willReadFrequently:true});
  const sw=source.videoWidth||source.naturalWidth||source.width,sh=source.videoHeight||source.naturalHeight||source.height;
  if(!sw||!sh)return false;
  const z=Math.max(out.width/sw,out.height/sh);
  ctx.save();if(mirror){ctx.translate(out.width,0);ctx.scale(-1,1);}
  ctx.drawImage(source,(out.width-sw*z)/2,(out.height-sh*z)/2,sw*z,sh*z);ctx.restore();return true;
}
export function handMatch(hands,choice){
  if(!choice.pose.hand)return null;
  if(!hands.length)return {value:null,ok:false};
  const g=choice.g, target=choice.pose.hand;
  let best=0;
  for(const points of hands){
    const {x:xt,y:yt}=guidePoint(g,target[0],target[1]);
    const placement=Math.hypot((points[9].x-xt)/g.w,(points[9].y-yt)/g.h);
    const w=points[0],span=Math.hypot((points[9].x-w.x)/g.w,(points[9].y-w.y)/g.h)||.01;
    const shape=[4,8,12,16,20].map((index,i)=>Math.abs(Math.hypot((points[index].x-w.x)/g.w,(points[index].y-w.y)/g.h)/span-target[2+i]));
    const error=placement*2+shape.reduce((a,b)=>a+b,0)/shape.length*.31;
    best=Math.max(best,Math.max(0,1-error));
  }
  return {value:best,ok:best>.58};
}
