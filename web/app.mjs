import {poses,features,recommend,readFace,assess,Coach,messages} from './engine.mjs';
import {faceModel,liveFaceModel,handModel,embedModel,handMatch,vector,canvas,fitted,faceObservations} from './models.mjs';
import {anchorOf,guidePoint,place,GuideFollower,transformGuide} from './framing.mjs';
import {FloatingGuide,cssPlane,projected} from './floating.mjs';
import {meter} from './quality.mjs';
import {brief,holderIndex,invitations} from './guidance.mjs';
import {compositionPicks,sceneThumbnail,templateGroup,preferenceScore} from './composition.mjs';
import {contrastInk} from './ink.mjs';
import {portraitEditor} from './retouch.mjs';
import {beautyView} from './beauty-view.mjs';
import {beautyControls} from './beauty-controls.mjs';
import {initSound,shotFeedback,silence,voice} from './sound.mjs';
import {sceneCoach} from './scene-coach.mjs';
import {initCompactPanels,resultPage} from './compact-panels.mjs';
import {SoloCue} from './solo-cue.mjs';
import {AdaptiveGuide} from './adaptive-guide.mjs';
const $=id=>document.getElementById(id),photo=$('photo'),video=$('video'),outline=$('outline');
initCompactPanels();
const soloCue=new SoloCue(),adaptiveGuide=new AdaptiveGuide();
let soloUntil=0,lastPairAt=-Infinity;
const modalOpen=()=>!!document.querySelector('dialog[open]');
const ctx=photo.getContext('2d',{willReadFrequently:true}), mode=matchMedia('(orientation: landscape)');
const ink=contrastInk(outline,photo);
outline.onload=()=>{ink.readGuide();ink.update(choice?.g,true);};
const status=text=>{$('status').textContent=text;};
const beauty=beautyView($('beautyLayer'),()=>status('这台设备将于拍后应用美颜。'));
const beautyPanel=$('beautyPanel'),follower=new GuideFollower();
const floating=new FloatingGuide(),planeLayer=$('guidePlane'),floatSwitch=$('floatingGuide');
let baseGuide=null;
let reopenDeck=false,beautyLoading=null,beautyModelError=false,beautyFaces=0;
const beautySettings=beautyControls(()=>{
  if(beautySettings.values)loadBeautyModel();else beauty.hide();
  beautyNotice();
});
const show=(id,visible)=>{$(id).hidden=!visible;};
const image=async src=>{const i=new Image();i.src=src;await i.decode();return i;};
const nextFrame=()=>new Promise(r=>requestAnimationFrame(r));
let library=[],ranked=[],choice=null,bg=null,refFeatures=null,phase='select',source='',stream=null,mirror=false;
let face=null,hand=null,motion=new Coach(),tick=0,epoch=0,rankEpoch=0;
let latestPhoto=null,importedPhoto=false,timerEnd=0,autoEnabled=true,liveReady=false,activeUrl=null,frameTime=-1,lastDetect=0,busy=false;
let refMode='',previewTick=0,opening=false,resumeCamera=false,fitMode='waiting',fitTime=0,fitFrame=-1,rankAspect=0;
const touches=new Map();
let dragging=false;
let trayOpen=false,loadingPicks=false,displayedType='',displayedIntimate=false,seenPoses=new Set(),readyPulse=false,lastPulse=-Infinity;
let guideStyle='study',rolesUntil=0;
const ambient=$('ambient'),ambientContext=ambient.getContext('2d',{willReadFrequently:true});
let ambientAt=-Infinity,lastScene=null,rankScene=null,openingDeckAt=0,changedFrames=0;
const editor=portraitEditor(()=>{
  $('save').disabled=editor.pending();$('save').textContent='保存照片';status('');
},resultPreview);
const aspect=()=>photo.width/photo.height;
const sceneAdvisor=sceneCoach({
  frame:()=>choice&&['chosen','live'].includes(phase)&&(source||refMode==='所选背景')?photo:null,
  pose:()=>choice?.pose,signature:sceneSignature,difference:sceneDifference,speak:voice,
  allowSpeech:()=>liveReady&&phase==='live'&&performance.now()>rolesUntil&&performance.now()-motion.at>2600&&
    motion.invited==null&&!busy&&!trayOpen&&!timerEnd&&!touches.size&&!modalOpen()&&performance.now()>soloUntil&&$('poseOptions').hidden,
  canAdjust:()=>!!choice&&!busy&&!timerEnd&&!touches.size&&fitMode!=='manual'&&motion.invited==null,
  adjust({scene}){
    if(!choice||busy||timerEnd||touches.size||fitMode==='manual'||motion.invited!=null)return null;
    const old=adaptiveGuide.snapshot();adaptiveGuide.accept(scene,performance.now());return old;
  },
  restore(old){adaptiveGuide.restore(old);},
  clearAdjustment:()=>adaptiveGuide.clear()
});
const fallback={front:'cheeks',cheek:'cheeks',temples:'kiss',nose:'kiss',lip:'kiss',brow:'forehead',sidekiss:'temple',shoulder:'shoulder',gaze:'kiss',back:'shoulder',hand:'cheeks',play:'cheeks'};
function resizeCanvas(){
  photo.style.objectFit='';$('view').style.aspectRatio='';$('view').style.width='';
  const ratio=mode.matches?16/9:3/4;
  photo.width=mode.matches?1280:864;photo.height=Math.round(photo.width/ratio);
  $('ratio').textContent=mode.matches?'16:9':'3:4';
  return ratio;
}
function sampleInput(input,width=108){
  const small=canvas(width,Math.max(1,Math.round(width*input.height/input.width)));
  const c=small.getContext('2d',{willReadFrequently:true});c.drawImage(input,0,0,small.width,small.height);
  return c.getImageData(0,0,small.width,small.height);
}
function syncTilt(){window.Phone?.setGuideMotion?.(source==='camera'&&!!choice&&['chosen','live'].includes(phase)&&floatSwitch.checked&&fitMode!=='manual');}
function readTilt(){
  if(source!=='camera')return null;
  const raw=window.Phone?.guideTilt?.();if(!raw)return null;
  const pair=raw.split(',').map(Number);
  return pair.length===2&&pair.every(Number.isFinite)?pair:null;
}
function resetFloating(g){
  const {plane,...flat}=g;baseGuide=flat;floating.reset();
}
function stopMedia(){
  face?.reset?.();lastPairAt=-Infinity;
  soloCue.reset();soloUntil=0;adaptiveGuide.clear();
  sceneAdvisor.reset();
  beauty.hide();beautyFaces=0;follower.reset();window.Phone?.setGuideMotion?.(false);
  ++epoch;opening=false;cancelAnimationFrame(tick);cancelAnimationFrame(previewTick);timerEnd=0;liveReady=false;frameTime=-1;silence();touches.clear();
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  video.pause();video.srcObject=null;video.removeAttribute('src');video.load();
  if(activeUrl){URL.revokeObjectURL(activeUrl);activeUrl=null;}source='';
}
function panels(p){
  if(p==='result')resultPage();
  sceneAdvisor.reset();
  beauty.hide();
  phase=p;document.body.dataset.phase=p;document.querySelector('aside').scrollTop=0;window.scrollTo(0,0);
  syncTilt();
  const finder=p==='live'||(p==='select'&&source==='camera');
  document.body.toggleAttribute('data-finder',finder);
  closeTray();
  show('poseOptions',p!=='live');$('settings').setAttribute('aria-expanded','false');
  show('select',p==='select'&&!finder);show('selected',p==='chosen'||p==='live');show('result',p==='result');
  ink.resetFocus();show('roles',false);show('switchHand',finder);show('sceneAlbum',true);
  show('sceneControls',finder&&p==='select');show('settings',p==='live');show('finderSound',finder);
  show('guideBeauty',p==='live');
  $('hint').removeAttribute('data-ready');
  show('liveControls',p==='live');show('hint',p==='live');show('scan',p==='select'&&source==='camera');show('openCam',source!=='camera');
  $('step').textContent={select:'实景选姿',chosen:'姿势预览',live:'自拍引导',result:'照片后期'}[p];
}
function drawBackground(){
  if(bg&&refMode==='所选背景'){fitted(photo,bg);$('tag').textContent=refMode;}
  else {ctx.clearRect(0,0,photo.width,photo.height);$('tag').textContent='等待相机';}
}
function guide(){
  if(!choice)return;
  const g=choice.g;
  const src=guideStyle==='comic'?'assets/'+choice.pose.id+'-guide.png':'sketches/'+choice.pose.id+'.webp';
  outline.dataset.style=guideStyle;if(outline.getAttribute('src')!==src)outline.src=src;
  outline.style.left=g.x*100+'%';outline.style.top=g.y*100+'%';outline.style.width=g.w*100+'%';outline.style.height=g.h*100+'%';
  outline.style.transform=g.flip?'scaleX(-1)':'';show('outline',true);
  renderPlane();
  $('ref').style.transform=g.flip?'scaleX(-1)':'';
  $('poseThumb').style.transform=$('ref').style.transform;
  ink.update(g);
  for(const [i,label] of [...$('roles').children].entries()){
    const [x,y,_,ry]=choice.pose.heads[i];label.textContent=i===holderIndex(choice.pose)?'拿手机的人':'另一位';
    const point=guidePoint(g,x,y-ry);
    label.style.left=(100*Math.max(.11,Math.min(.89,point.x)))+'%';
    label.style.top=(100*Math.max(.09,Math.min(.93,point.y)))+'%';
  }
}
function renderPlane(){
  const p=choice?.g.plane;
  planeLayer.style.transform=p?cssPlane(p,planeLayer.clientWidth,planeLayer.clientHeight):'';
}
new ResizeObserver(renderPlane).observe(planeLayer);
function card(c,thumbnail=null){
  const b=document.createElement('button');b.className='card';const i=document.createElement('img');
  i.src=thumbnail||'assets/'+c.pose.id+'.jpg';i.alt='';i.loading=thumbnail?'eager':'lazy';
  if(thumbnail){b.classList.add('scene-card');b.setAttribute('aria-label',c.pose.name+'，'+c.pose.level+'。'+c.reason);}
  if(!thumbnail&&c.g.flip)i.style.transform='scaleX(-1)';
  const t=document.createElement('span'),name=document.createElement('b'),detail=document.createElement('small');
  name.textContent=c.pose.name;detail.textContent=thumbnail?c.framingNote:c.pose.level;t.append(name,detail);b.append(i,t);
  b.dataset.pose=c.pose.id;b.setAttribute('aria-pressed',String(c.pose.id===choice?.pose.id));
  b.onclick=()=>usePose(c).catch(error);return b;
}
function matchesType(c){return $('templateType').value==='all'||templateGroup(c.pose)===$('templateType').value;}
function listAll(){
  const q=$('search').value.trim(),matched=ranked.filter(c=>matchesType(c)&&(c.pose.name+c.pose.level+c.pose.setup).includes(q));
  if($('intimateFirst').checked)matched.sort((a,b)=>preferenceScore(b,true)-preferenceScore(a,true));
  const pages=Math.ceil(matched.length/3);
  libraryPage=Math.max(0,Math.min(libraryPage,pages-1));
  $('allCards').replaceChildren(...matched.slice(libraryPage*3,libraryPage*3+3).map(c=>card(c)));
  show('noMatches',!matched.length);show('libraryPager',pages>1);
  $('prevPage').disabled=libraryPage===0;$('nextPage').disabled=libraryPage>=pages-1;
  $('pageCount').textContent=(libraryPage+1)+' / '+pages;
}
let libraryPage=0;
event('prevPage',()=>{libraryPage--;listAll();});
event('nextPage',()=>{libraryPage++;listAll();});
function catalog(open){
  libraryPage=0;
  $('select').classList.toggle('library-open',open);show('catalog',open);
  $('deckTitle').textContent=open?'模板库':'情侣模板';
  $('browse').textContent=open?'返回推荐':'模板库 · '+library.length;
  $('browse').setAttribute('aria-expanded',String(open));
  if(open)listAll();else $('search').value='';
  $('select').scrollTop=0;
}
function closeTray(){
  if(trayOpen){++rankEpoch;loadingPicks=false;}
  trayOpen=false;document.body.removeAttribute('data-tray');
  $('scan').setAttribute('aria-expanded','false');$('posePicker').setAttribute('aria-expanded','false');
  catalog(false);
  $('cards').hidden=false;show('rankStatus',false);
  show('select',phase==='select'&&!document.body.hasAttribute('data-finder'));
}
function openTray(automatic=false){
  if(trayOpen||busy||!document.body.hasAttribute('data-finder'))return;
  beauty.hide();
  if(phase==='live'&&!$('poseOptions').hidden)settings(false);
  trayOpen=true;document.body.setAttribute('data-tray','');show('select',true);show('recommendHead',true);
  show('poseLinks',!!ranked.length);$('nextBatch').disabled=!ranked.length;
  const trigger=phase==='live'?'posePicker':'scan';$(trigger).setAttribute('aria-expanded','true');
  silence();timerEnd=0;motion=new Coach();readyPulse=false;ink.resetFocus();show('roles',false);
  $('select').scrollTop=0;
  for(const el of $('cards').children)el.setAttribute('aria-pressed',String(el.dataset.pose===choice?.pose.id));
  if(!automatic)$('closeTray').focus({preventScroll:true});
  if(!ranked.length||rankAspect!==aspect()||displayedType!==$('templateType').value||displayedIntimate!==$('intimateFirst').checked){
    $('rankStatus').textContent='正在匹配当前取景…';show('rankStatus',true);
    if((automatic&&!bg)||!library.length){openingDeckAt=performance.now();return;}
    return rank({input:bg||captureRawBackground()});
  }
}
function dismissTray(){
  closeTray();timerEnd=0;motion=new Coach();readyPulse=false;
  $(phase==='live'?'posePicker':'scan').focus({preventScroll:true});
}
async function rank({input=bg,more=false,modeName=refMode}={}){
  if(!input||!library.length)return false;
  const version=++rankEpoch,a=aspect(),type=$('templateType').value,current=()=>version===rankEpoch;
  const intimate=$('intimateFirst').checked;
  const background=canvas(photo.width,photo.height);fitted(background,input);
  const reuse=ranked.length&&rankAspect===a&&input===bg;
  loadingPicks=true;show('recommendHead',true);show('poseLinks',!!ranked.length);show('cards',false);
  $('nextBatch').disabled=true;$('rankStatus').textContent='正在匹配当前取景…';show('rankStatus',true);
  try{
    let scene=refFeatures,records=ranked;
    if(!reuse){
      scene=features(sampleInput(background));let embedding=null;
      try{const model=await embedModel();if(!current())return false;embedding=vector(model,background);}catch{}
      if(!current())return false;
      records=[];
      for(let i=0;i<library.length;i+=12){
        records.push(...recommend(scene,a,library.slice(i,i+12),embedding));
        await new Promise(resolve=>setTimeout(resolve,0));if(!current())return false;
      }
      records.sort((x,y)=>y.rank-x.rank);
    }
    const candidates=records.filter(matchesType),seen=more&&reuse?new Set(seenPoses):new Set();
    if(candidates.every(c=>seen.has(c.pose.id)))seen.clear();
    const remaining=candidates.filter(c=>!seen.has(c.pose.id));
    const top=await compositionPicks(remaining,background,current,intimate);
    if(!current())return false;
    const thumbs=await Promise.all(top.map(c=>sceneThumbnail(c,background)));if(!current())return false;
    if(!reuse){
      rankScene=sceneSignature(background);changedFrames=0;
      $('rescan').removeAttribute('data-changed');$('rescan').textContent='更新取景';
    }
    bg=input;refMode=modeName||'相机背景';refFeatures=scene;ranked=records;rankAspect=a;displayedType=type;displayedIntimate=intimate;
    for(const c of top)seen.add(c.pose.id);seenPoses=seen;
    $('cards').replaceChildren(...top.map((c,i)=>card(c,thumbs[i])));
    $('nextBatch').querySelector('span').textContent=seen.size===candidates.length?'再看一轮':'换一组';
    if(!$('catalog').hidden)listAll();
    return true;
  }finally{
    if(current()){loadingPicks=false;show('rankStatus',false);show('cards',true);show('poseLinks',!!ranked.length);$('nextBatch').disabled=!ranked.length;}
  }
}
async function usePose(c){
  if(busy)return;
  if(phase==='live'&&choice?.pose.id===c.pose.id){dismissTray();return;}
  const kind=source,instant=kind==='camera'||(kind==='movie'&&phase==='live');
  cancelAnimationFrame(tick);silence();select(c,instant);
  if(instant)await startLive(kind);
}
function select(c,instant=false){
  editor.clear();latestPhoto=null;
  ++rankEpoch;loadingPicks=false;
  choice={...c,g:{...c.g}};newFit();panels(instant?'live':'chosen');if(!source)drawBackground();guide();
  if(source==='camera')loadFitModel();
  $('mediaOptions').open=false;
  $('poseTitle').textContent=c.pose.name;$('livePose').textContent=c.pose.name;$('poseThumb').src=$('ref').src='assets/'+c.pose.id+'.jpg';
  $('difficulty').textContent=c.pose.level;$('setup').textContent=brief(c.pose);$('why').textContent=c.reason;
  status(source==='camera'?'两张脸入镜后会自动适配参考线，也可以直接拖动。':'可先调整参考线，或打开前置相机按人脸适配。');
}
function newFit(){
  adaptiveGuide.clear();
  ink.resetFocus();resetFloating(choice.g);choice.g=baseGuide;
  fitMode='waiting';follower.reset();fitTime=0;fitFrame=-1;motion=new Coach();timerEnd=0;touches.clear();readyPulse=false;
  fitLabel();
}
function fitLabel(){
  syncTilt();
  $('fitFaces').setAttribute('aria-pressed',String(fitMode!=='manual'));
  $('fitState').textContent=fitMode==='manual'?'手动锁定':fitMode==='fitted'?'跟随双人距离':'等待双人稳定入镜';
}
function loadFitModel(){liveFaceModel().then(m=>{face=m;}).catch(()=>{if(choice)status('人脸适配暂不可用，可拖动参考线或点加减调整。');});}
function tryFit(faces,now){
  if(faces.length===2)lastPairAt=now;
  if(fitMode==='manual'||touches.size)return;
  if(faces.length<2&&now-lastPairAt<8000)return;
  if(timerEnd||floatSwitch.checked&&faces.length<2&&now-motion.lastSeen<2000||
     motion.invited!=null&&(faces.length<2||now-motion.invited<2100)){follower.reset();return;}
  const update=follower.update(choice.pose,baseGuide,aspect(),faces,now);
  if(update.frame)baseGuide=update.frame;
  const hold=motion.invited!==null||update.ready&&(motion.alignedSince!==null||autoEnabled&&readyPulse);
  let nextGuide=baseGuide;
  if(floatSwitch.checked){
    nextGuide=hold?null:floating.update(choice.pose,baseGuide,aspect(),faces,now,readTilt(),()=>features(sampleInput(photo,64)));
  }
  if(nextGuide&&!hold){
    nextGuide=adaptiveGuide.update(choice.pose,nextGuide,aspect(),faces,now,()=>features(sampleInput(photo,64)));
    if(floatSwitch.checked)nextGuide=projected(choice.pose,nextGuide,aspect(),floating.roll,floating.pitch,floating.side);
  }
  if(nextGuide&&differentGuide(choice.g,nextGuide)){choice.g=nextGuide;guide();}
  const next=update.ready?'fitted':'waiting';
  if(fitMode!==next){fitMode=next;fitLabel();}
  return update.cue;
}
function differentGuide(a,b){
  if(Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+Math.abs(a.h-b.h)>.0002||!!a.plane!==!!b.plane)return true;
  return b.plane&&['x','y','k','l','s','stretch'].some(key=>Math.abs(a.plane[key]-b.plane[key])>.0002);
}
async function acquire(){
  if(!navigator.mediaDevices?.getUserMedia)throw Error('此设备的相机接口不可用，可以导入照片或视频。');
  const cam=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'user'},width:{ideal:1920},height:{ideal:1080}},audio:false});
  return cam;
}
async function attachCamera(){
  if(source==='camera'&&stream?.active)return true;
  if(opening)return false;
  stopMedia();opening=true;const my=epoch;
  try{
    const cam=await acquire();if(my!==epoch){cam.getTracks().forEach(t=>t.stop());return false;}
    stream=cam;mirror=cam.getVideoTracks()[0].getSettings().facingMode!=='environment';
    video.srcObject=cam;await video.play();if(my!==epoch)return false;
    if(!video.videoWidth||video.readyState<2)throw Error('未收到摄像头画面，请重新打开相机。');
    source='camera';loadBeautyModel();loadFitModel();cam.getVideoTracks()[0].onended=()=>{
      if(stream!==cam)return;window.pauseCapture();resumeCamera=false;status('相机取景中断，请重新打开相机。');
    };
    return true;
  }catch(e){if(my!==epoch)return false;stopMedia();throw e;}
  finally{if(my===epoch)opening=false;}
}
const cameraTag=()=>mirror?'前置取景':'相机取景';
function sceneSignature(frame){
  const small=canvas(ambient.width,ambient.height),c=small.getContext('2d',{willReadFrequently:true});
  c.drawImage(frame,0,0,small.width,small.height);return c.getImageData(0,0,small.width,small.height).data;
}
function sceneDifference(a,b){
  if(!a||!b)return 1;
  let d=0;for(let i=0;i<a.length;i+=4)d+=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);
  return d/(a.length*.75*255);
}
function updateScene(){
  const now=performance.now();if(now-ambientAt<400)return;ambientAt=now;
  ambientContext.drawImage(photo,0,0,ambient.width,ambient.height);
  if(phase!=='select'||!trayOpen||source!=='camera'||loadingPicks||busy||$('soundPanel').open)return;
  const sig=ambientContext.getImageData(0,0,ambient.width,ambient.height).data;
  const still=sceneDifference(lastScene,sig)<.06;lastScene=sig;
  if(!ranked.length&&openingDeckAt&&library.length&&(still||now-openingDeckAt>1500)){
    openingDeckAt=0;rank({input:captureRawBackground(),modeName:'相机背景'}).catch(error);return;
  }
  if(!rankScene||!$('catalog').hidden)return;
  changedFrames=still&&sceneDifference(rankScene,sig)>.14?changedFrames+1:0;
  if(changedFrames>=2&&!$('rescan').hasAttribute('data-changed')){
    $('rescan').toggleAttribute('data-changed',true);$('rescan').textContent='新取景 · 更新';
  }else if(still&&sceneDifference(rankScene,sig)<.08&&$('rescan').hasAttribute('data-changed')){
    $('rescan').removeAttribute('data-changed');$('rescan').textContent='更新取景';
  }
}
function drawSource(){
  const drawn=fitted(photo,video,mirror);
  if(drawn){updateScene();if(choice)ink.update(choice.g);}
  return drawn;
}
function captureRawBackground(){
  if(video.readyState<2||!video.videoWidth)return null;
  const snap=canvas(video.videoWidth,video.videoHeight);fitted(snap,video,mirror);return snap;
}
function preview(){
  cancelAnimationFrame(previewTick);
  const my=epoch;
  function draw(now){
    if(my!==epoch||!['select','chosen'].includes(phase)||source!=='camera')return;
    if(video.readyState>=2&&drawSource()){
      const levels=beautySettings.values,follow=phase==='chosen'&&fitMode!=='manual';
      if(face&&(follow||levels||$('soloVoice').checked)&&now-fitTime>280&&fitFrame!==video.currentTime){
        fitTime=now;fitFrame=video.currentTime;
        try{
          const {faces}=measurements(photo,false,!!levels);
          if(follow)tryFit(faces,now);
          if(levels)trackBeauty(faces);
          checkSolo(faces,now,meter(sampleInput(photo),faces));
        }catch{follower.reset();beauty.hide();}
      }
      if(levels)beauty.draw(photo,now,levels);
    }
    previewTick=requestAnimationFrame(draw);
  }
  previewTick=requestAnimationFrame(draw);
}
function clearRanks(){
  ++rankEpoch;loadingPicks=false;displayedType='';ranked=[];seenPoses.clear();bg=null;refFeatures=null;refMode='';$('cards').replaceChildren();$('allCards').replaceChildren();
  openingDeckAt=0;rankScene=lastScene=null;changedFrames=0;ambientAt=-Infinity;
  $('rescan').removeAttribute('data-changed');$('rescan').textContent='更新取景';
  show('catalog',false);show('poseLinks',false);show('recommendHead',false);
}
async function scanCamera(){
  if(opening||busy)return;
  resumeCamera=false;const oldPhase=phase;$('openCam').disabled=true;
  if(phase==='select'){clearRanks();drawBackground();}
  status('正在打开相机…');
  try{
    if(!await attachCamera())return;
    if(oldPhase!==phase)return;
    panels(phase);$('tag').textContent=cameraTag();drawSource();preview();
    if(choice){loadFitModel();guide();}
    status(choice?'两人一起入镜，可拖动参考线或点按人脸适配。':'');
    if(phase==='select'&&!choice)openTray(true);
  }finally{$('openCam').disabled=false;}
}
async function resetToSelection(){
  if(busy)return;
  editor.clear();
  if(importedPhoto){clearRanks();importedPhoto=false;}
  cancelAnimationFrame(tick);liveReady=false;timerEnd=0;silence();choice=null;latestPhoto=null;
  panels('select');show('outline',false);resizeCanvas();
  if(source==='camera'){
    preview();$('tag').textContent=cameraTag();
    await openTray(true);
    status('可以换个姿势，或按眼前的新背景重新推荐。');
  }
  else if(refMode==='所选背景'){stopMedia();drawBackground();await rank();}
  else await scanCamera();
}
async function prepare(){
  face=await liveFaceModel();
  hand=null;
  if(choice?.pose.hand){try{hand=await handModel();}catch{status('手势模型暂不可用，保留面部引导。');}}
}
function measurements(frame,withHands=true,keepMesh=false){
  const scale=Math.min(1,640/Math.max(frame.width,frame.height));
  const reduced=canvas(Math.round(frame.width*scale),Math.round(frame.height*scale));
  reduced.getContext('2d').drawImage(frame,0,0,reduced.width,reduced.height);
  const g=choice?.g,centers=g?choice.pose.eyes.map(([a,b],i)=>{
    const {x,y}=guidePoint(g,a,b),head=choice.pose.heads[i];
    return [x,y,Math.max(head[2]*g.w*reduced.width,head[3]*g.h*reduced.height)*3.25];
  }):null;
  const observe=keepMesh?points=>{const f=readFace(points);return f?{...f,mesh:points}:null;}:readFace;
  const faces=face?faceObservations(face,reduced,observe,centers):[];
  const hands=withHands&&hand?hand.detect(reduced).landmarks:[];
  const gesture=withHands&&choice?handMatch(hands,choice):null;return {faces,gesture};
}
function loadBeautyModel(){
  if(face||beautyLoading||!beautySettings.values)return;
  beautyModelError=false;
  beautyLoading=liveFaceModel().then(m=>{face=m;}).catch(()=>{beautyModelError=true;}).finally(()=>{beautyLoading=null;beautyNotice();});
}
function beautyNotice(){
  if(!beautyPanel.open)return;
  const text=!beautySettings.values?'美颜已关闭':beautyModelError?'人脸检测暂不可用':beauty.failed?'本机将在拍后应用美颜':beautyLoading?'正在准备人脸检测…':beautyFaces?'已识别'+(beautyFaces===2?'两张脸':'一张脸')+' · 实时预览':'面向镜头可预览效果';
  if($('beautyNote').textContent!==text)$('beautyNote').textContent=text;
}
function trackBeauty(faces){
  beautyFaces=faces.filter(f=>f.mesh).length;beauty.track(faces,photo);beautyNotice();
}
function checkSolo(faces,now,light=null){
  if(faces.length>=2)soloUntil=0;
  const blocked=source!=='camera'||phase!=='select'||busy||!!timerEnd||trayOpen||modalOpen()||
    (phase==='live'&&!$('poseOptions').hidden)||!!light?.dark||!!light?.bright||
    (phase==='live'&&motion.invited!=null);
  const reliable=faces.filter(f=>f.height>=.08&&f.box.every((v,i)=>i<2?v>=.005:v<=.995));
  if(soloCue.update(reliable.length===faces.length?faces.length:0,now,{
    enabled:$('soloVoice').checked&&$('guideAudio').checked,blocked,
    canSpeak:now>rolesUntil&&now-motion.at>3500
  })){
    soloUntil=now+4500;voice('你需要先找一个对象呢','solo',true);
    if(phase==='select')status('你需要先找一个对象呢');
  }
}
async function startLive(kind,file){
  const selected=choice;liveReady=false;$('start').disabled=true;
  let loadingFrame=0;
  for(const id of ['posePicker','timer','settings','guideBeauty'])$(id).disabled=true;
  status('正在准备双人检测…');$('hint').textContent=brief(choice.pose);
  try{
    if(kind==='camera'){if(!await attachCamera())return;}
    else if(file){
      stopMedia();mirror=false;source='movie';activeUrl=URL.createObjectURL(file);video.src=activeUrl;await video.play();
    }
    const my=epoch;
    if(phase==='live'){
      const previewWhileLoading=()=>{
        if(my!==epoch||choice!==selected||liveReady||phase!=='live')return;
        drawSource();loadingFrame=requestAnimationFrame(previewWhileLoading);
      };
      previewWhileLoading();
    }
    try{await prepare();}catch{face=hand=null;}if(my!==epoch||choice!==selected||!['chosen','live'].includes(phase))return;
    const openingLine=brief(choice.pose);
    let calibrating=!!face&&!!invitations[choice.pose.family]&&fitMode==='waiting';
    const startLine=openingLine;
    rolesUntil=performance.now()+Math.max(2500,startLine.length*165);
    motion=new Coach(calibrating?0:rolesUntil);liveReady=true;autoEnabled=$('auto').checked;lastDetect=0;frameTime=-1;
    panels('live');guide();$('tag').textContent=kind==='camera'?cameraTag():'视频回放';
    $('hint').textContent=startLine;show('roles',true);status(face?'':'人脸模型暂不可用，可手动拍照。');
    voice(startLine,'pose-'+choice.pose.id,true);
    motion.at=performance.now();motion.listenAfter=rolesUntil;
    function step(now){
      if(my!==epoch||phase!=='live')return;
      if(!drawSource()){tick=requestAnimationFrame(step);return;}
      if(trayOpen||(modalOpen()&&!beautyPanel.open)||!$('poseOptions').hidden||touches.size){soloCue.update(0,now);tick=requestAnimationFrame(step);return;}
      if(beautyPanel.open){
        const levels=beautySettings.values;
        if(levels&&now-lastDetect>=220&&video.currentTime!==frameTime){
          lastDetect=now;frameTime=video.currentTime;
          try{trackBeauty(measurements(photo,false,true).faces);}catch{beauty.hide();}
        }
        if(levels)beauty.draw(photo,now,levels);
        tick=requestAnimationFrame(step);return;
      }
      show('roles',now<rolesUntil);
      sceneAdvisor.tick(now);
      if(timerEnd&&now>=timerEnd){take(false).catch(error);return;}
      if(now-lastDetect>=220&&video.currentTime!==frameTime){
        frameTime=video.currentTime;lastDetect=now;
        try{
          const beautify=!!beautySettings.values;
          const {faces,gesture}=measurements(photo,true,beautify),fitCue=tryFit(faces,now);
          if(beautify)trackBeauty(faces);
          const a=assess(faces,choice,aspect());
          if(calibrating&&fitMode!=='waiting'){
            calibrating=false;rolesUntil=now+Math.max(2500,openingLine.length*165);
            motion=new Coach(rolesUntil);voice(openingLine,'pose-'+choice.pose.id,true);
          }
          if(calibrating&&!fitCue&&faces.length===2)a.cue='hold';
          if(fitMode==='waiting'){a.closeEnough=false;if(fitCue)a.cue=fitCue;}
          const light=meter(sampleInput(photo),faces);
          checkSolo(faces,now,light);
          if(light.dark||light.bright)a.cue=light.dark?'dark':'bright';
          if(a.cue==='hold'&&['hand','play'].includes(choice.pose.family)&&(!gesture||!gesture.ok))a.cue='hand';
          const coaching=motion.update(now,a,choice.pose);
          if(fitMode!=='waiting'&&now>=rolesUntil)ink.track(a,coaching,choice.pose,now);
          const message=!face&&a.cue==='missing'?'可轻点屏幕快门拍照。':coaching.text;
          $('hint').textContent=timerEnd?'倒计时 '+Math.max(1,Math.ceil((timerEnd-now)/1000)):now<soloUntil?'你需要先找一个对象呢':calibrating&&a.cue==='hold'?'正在按双人距离调整参考线…':message;
          const aligned=(coaching.cueNow||coaching.contact||coaching.ready)&&!light.dark&&!light.bright&&fitMode!=='waiting'&&!touches.size&&$('poseOptions').hidden&&!timerEnd;
          $('hint').toggleAttribute('data-ready',aligned);
          if(aligned&&!readyPulse&&now-lastPulse>2200&&$('haptic').checked){
            window.Phone?.alignedPulse?.();lastPulse=now;
          }
          readyPulse=aligned;
          if(coaching.speak&&now>=soloUntil&&!timerEnd&&$('poseOptions').hidden&&(face||light.dark||light.bright))voice(message,coaching.key,coaching.cueNow);
          if(autoEnabled&&coaching.ready&&$('poseOptions').hidden&&!timerEnd&&!touches.size&&!light.dark&&!light.bright&&fitMode!=='waiting'){take(false).catch(error);return;}
        }catch(e){status('这一帧检测失败，可手动拍照。');}
      }
      if(beautySettings.values)beauty.draw(photo,performance.now(),beautySettings.values);
      if(kind==='movie'&&video.ended){take(false).catch(error);return;}
      tick=requestAnimationFrame(step);
    }
    tick=requestAnimationFrame(step);
  }catch(e){stopMedia();panels('chosen');drawBackground();guide();throw e;}
  finally{
    cancelAnimationFrame(loadingFrame);
    for(const id of ['start','posePicker','shutter','timer','settings','guideBeauty'])$(id).disabled=false;
  }
}
async function take(isSample,external=null){
  const quick=!external&&phase==='select'&&source==='camera'&&video.readyState>=2;
  if(busy||modalOpen()||(!choice&&!external&&!quick))return;busy=true;
  $('selected').inert=true;$('result').inert=true;
  try{
    if(!external&&!liveReady&&!quick&&!(phase==='live'&&source==='camera'&&video.readyState>=2))return;
    if(trayOpen)closeTray();
    const ratio=photo.width/photo.height;
    const original=external||video;
    const sw=original.naturalWidth||original.videoWidth||photo.width,sh=original.naturalHeight||original.videoHeight||photo.height;
    importedPhoto=!!external&&!isSample;
    const pictureAspect=importedPhoto?sw/sh:ratio;
    const width=importedPhoto?Math.max(1,Math.round(sw*Math.min(1,2560/Math.max(sw,sh)))):isSample?photo.width:Math.max(1,Math.round(Math.min(sw,sh*ratio,2560)));
    const capture=canvas(width,Math.max(1,Math.round(width/pictureAspect)));
    if(external){
      if(isSample){
        // The sample occupies the same square as its guide, retaining the chosen scene around it.
        if(bg)fitted(capture,bg);
        const g=choice.g,c=capture.getContext('2d');c.save();
        if(g.flip){c.translate((2*g.x+g.w)*capture.width,0);c.scale(-1,1);}
        c.drawImage(external,g.x*capture.width,g.y*capture.height,g.w*capture.width,g.h*capture.height);c.restore();
      }else fitted(capture,external);
    }else{fitted(capture,video,mirror);}
    const fromCamera=source==='camera';stopMedia();
    if(!external){shotFeedback(fromCamera,!quick);$('tag').textContent='已拍摄';}
    show('outline',false);show('roles',false);show('hint',false);status(external?'正在打开照片…':'已拍摄');
    ctx.drawImage(capture,0,0,photo.width,photo.height);await nextFrame();
    let faces=[];
    try{
      const stillFace=await faceModel();
      const scale=Math.min(1,640/Math.max(capture.width,capture.height));
      const frame=canvas(Math.max(1,Math.round(capture.width*scale)),Math.max(1,Math.round(capture.height*scale)));
      frame.getContext('2d').drawImage(capture,0,0,frame.width,frame.height);
      faces=faceObservations(stillFace,frame,points=>{const f=readFace(points);return f?{...f,mesh:points}:null;});
    }catch{ /* The whole-photo editor is available without face detection. */ }
    latestPhoto=capture;editor.load(capture,faces,external?null:beautySettings.values);panels('result');resultPreview();
    $('tag').textContent=isSample?'参考照演示':importedPhoto?'相册照片':'成片';
    $('resultType').textContent=importedPhoto?'相册照片':quick?'随手拍':choice.pose.name+(isSample?' · 参考照演示':'');
    $('retry').textContent=importedPhoto?'另选照片':'再拍一张';
    $('again').textContent=importedPhoto?'回到相机':quick?'选个姿势':'换个姿势';
    status('');
  }finally{busy=false;$('selected').inert=false;$('result').inert=false;}
}
function resultPreview(){
  if(!latestPhoto||phase!=='result')return;
  const out=editor.render(true),ratio=out.width/out.height;
  const scale=Math.min(1,1280/Math.max(out.width,out.height));
  photo.width=Math.max(1,Math.round(out.width*scale));photo.height=Math.max(1,Math.round(out.height*scale));
  $('view').style.aspectRatio=String(ratio);$('view').style.width=mode.matches?'min(100%, calc((100vh - 100px) * '+ratio+'))':'min(100%, '+Math.min(95,47*ratio)+'vh)';
  ctx.drawImage(out,0,0,photo.width,photo.height);$('ratio').textContent=importedPhoto?latestPhoto.width+' × '+latestPhoto.height:latestPhoto.width>latestPhoto.height?'16:9':'3:4';
}
function error(e){const m=e?.name==='NotAllowedError'?'相机权限未开启，可在系统应用权限中允许相机，或导入照片。':e?.name==='NotFoundError'?'未找到可用相机，可导入视频或照片。':(e?.message||'操作失败，请重试。');status(m);}
function event(id,fn){$(id).onclick=()=>Promise.resolve().then(fn).catch(error);}
const view=$('view');
function editGuide(from,to,factor){
  if(!choice||busy)return;
  if(Math.abs(to.x-from.x)+Math.abs(to.y-from.y)<.0001&&Math.abs(factor-1)<.0001)return;
  sceneAdvisor.clearProposal();
  adaptiveGuide.clear();
  baseGuide=transformGuide(choice.pose,choice.g,aspect(),from,to,factor);
  choice.g=projected(choice.pose,baseGuide,aspect(),floating.roll,floating.pitch,floating.side);fitMode='manual';fitLabel();follower.reset();timerEnd=0;motion=new Coach();
  ink.resetFocus();$('why').textContent='语音将以当前参考线为准。';guide();
}
function fingers(){
  const [a,b]=[...touches.values()],r=view.getBoundingClientRect();
  const x=(a.x+(b?.x??a.x))/2,y=(a.y+(b?.y??a.y))/2;
  return {x:(x-r.left)/r.width,y:(y-r.top)/r.height,d:b?Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)):1};
}
view.onpointerdown=e=>{
  if(e.target.closest('button'))return;
  if(trayOpen){dismissTray();return;}
  if(!['chosen','live'].includes(phase)||busy||touches.size>=2||e.button!==0)return;
  if(phase==='live'&&!$('poseOptions').hidden){settings(false);return;}
  if(!touches.size)dragging=false;
  view.setPointerCapture(e.pointerId);touches.set(e.pointerId,{x:e.clientX,y:e.clientY});timerEnd=0;motion=new Coach();
};
view.onpointermove=e=>{
  const point=touches.get(e.pointerId);if(!point)return;
  if(!dragging&&Math.hypot(e.clientX-point.x,e.clientY-point.y)<(touches.size===1?6:3))return;
  dragging=true;const before=fingers();
  touches.set(e.pointerId,{x:e.clientX,y:e.clientY});const after=fingers();editGuide(before,after,after.d/before.d);
};
view.onpointerup=view.onpointercancel=view.onlostpointercapture=e=>touches.delete(e.pointerId);
for(const [id,factor] of [['smaller',1/1.12],['larger',1.12]]){
  event(id,()=>{const a=anchorOf(choice.pose,choice.g);editGuide(a,a,factor);});
}
event('fitFaces',()=>{
  sceneAdvisor.clearProposal();
  if(fitMode!=='manual'){fitMode='manual';fitLabel();follower.reset();motion=new Coach();timerEnd=0;return;}
  newFit();if(source)loadFitModel();guide();
});
function upload(id,fn){$(id).onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;try{await fn(f);}catch(e){error(e);}};}
async function fileImage(file){const u=URL.createObjectURL(file);try{return await image(u);}finally{URL.revokeObjectURL(u);}}
event('openCam',scanCamera);
$('sceneAlbum').onclick=()=>$('backgroundFile').click();
for(const id of ['editAlbum','editLocal'])$(id).onclick=()=>$('still').click();
for(const id of ['scan','posePicker'])event(id,()=>trayOpen?dismissTray():openTray());
event('closeTray',dismissTray);
event('nextBatch',()=>rank({more:true}));
event('rescan',()=>rank({input:captureRawBackground(),modeName:'相机背景'}));
upload('backgroundFile',async f=>{
  const selected=await fileImage(f);stopMedia();resumeCamera=false;clearRanks();bg=selected;refMode='所选背景';choice=null;
  panels('select');drawBackground();status('正在匹配所选背景…');if(await rank())status('已按所选背景推荐。');
});
event('browse',()=>catalog($('catalog').hidden));
function refreshPicks(){
  libraryPage=0;
  if(!$('catalog').hidden)listAll();
  rank({input:bg||captureRawBackground()}).catch(error);
}
$('templateType').onchange=refreshPicks;
$('intimateFirst').onchange=()=>{
  try{localStorage.setItem('intimate-first',$('intimateFirst').checked?'on':'off');}catch{}
  refreshPicks();
};
$('search').oninput=()=>{libraryPage=0;listAll();};event('start',()=>startLive('camera'));upload('movie',f=>startLive('movie',f));
upload('still',async f=>take(false,await fileImage(f)));event('sample',async()=>take(true,await image('assets/'+choice.pose.id+'.jpg')));
event('flip',()=>{sceneAdvisor.reset();const g=choice.g,a=anchorOf(choice.pose,g);resetFloating(place(choice.pose,aspect(),g.h,a.x,a.y,!g.flip));choice.g=baseGuide;follower.reset();motion=new Coach();timerEnd=0;guide();});
function settings(open){
  if(phase!=='live'||busy)return;
  if(open&&trayOpen)closeTray();
  show('poseOptions',open);$('settings').setAttribute('aria-expanded',String(open));timerEnd=0;motion=new Coach();readyPulse=false;
  ink.resetFocus();show('roles',false);if(open){silence();$('closeSettings').focus();}else $('settings').focus();
}
event('settings',()=>settings($('poseOptions').hidden));event('closeSettings',()=>phase==='live'?settings(false):resetToSelection());
for(const tab of $('settingTabs').querySelectorAll('button'))tab.onclick=()=>{
  for(const button of $('settingTabs').children)button.setAttribute('aria-pressed',String(button===tab));
  for(const page of document.querySelectorAll('.setting-page'))page.hidden=page.dataset.page!==tab.dataset.tab;
};
function dismissPanelForTimer(){
  if(beautyPanel.open)beautyPanel.close();
  else if($('soundPanel').open)$('soundPanel').close();
  else if(!$('catalog').hidden){catalog(false);$('browse').focus();}
  else if(trayOpen)dismissTray();
  else if(phase==='live'&&!$('poseOptions').hidden)settings(false);
}
for(const id of ['shutter','quickShutter'])event(id,()=>take(false));
event('timer',()=>{
  dismissPanelForTimer();timerEnd=performance.now()+3000;voice('三，二，一。','three',true);
});
$('auto').onchange=()=>{autoEnabled=$('auto').checked;motion=new Coach();};
event('reselect',()=>phase==='live'?openTray():resetToSelection());event('again',async()=>{const pick=!choice&&!importedPhoto;await resetToSelection();if(pick&&source==='camera')await openTray();});event('retry',async()=>{
  if(importedPhoto){$('still').click();return;}
  if(!choice){await resetToSelection();return;}
  const old=choice,manual=fitMode==='manual',oldAspect=latestPhoto.width/latestPhoto.height;
  const {roll,pitch,side}=floating;resizeCanvas();select(old);
  if(manual){Object.assign(floating,{roll,pitch,side});choice.g=old.g;fitMode='manual';fitLabel();guide();$('why').textContent='已保留上次调整的参考线。';}
  if(oldAspect!==aspect())rotateGuide(oldAspect);
  if(refMode!=='所选背景')await scanCamera();refreshReference();
});
event('save',()=>{
  if(busy||!latestPhoto||editor.pending()||$('save').disabled)return;
  const jpeg=editor.render(false).toDataURL('image/jpeg',.94);
  let ok=true;
  if(window.Phone)ok=Phone.saveJpeg(jpeg.split(',')[1]);
  else{const a=document.createElement('a');a.href=jpeg;a.download='CuddlePose.jpg';a.click();}
  if(ok){$('save').disabled=true;$('save').textContent='照片已保存';status(editor.changed()?'已保存调整后的照片。':'已保存原图。');}
  else status('保存失败，请检查设备剩余空间后重试。');
});
window.pauseCapture=()=>{
  if(busy||(!source&&!opening))return;
  if(beautyPanel.open){reopenDeck=false;beautyPanel.close();}
  resumeCamera=source==='camera'||opening;stopMedia();if(phase==='live')panels('chosen');else panels(phase);drawBackground();
  if(choice)guide();else if(resumeCamera)clearRanks();
};
window.resumeCapture=()=>{if(resumeCamera&&!document.hidden&&!busy){resumeCamera=false;scanCamera().catch(error);}};
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(source)window.pauseCapture();}else window.resumeCapture();});
function refreshReference(){
  if(!bg)return;const snap=canvas(photo.width,photo.height);fitted(snap,bg);refFeatures=features(sampleInput(snap));
}
function rotateGuide(oldAspect){
  const g=choice.g,a=anchorOf(choice.pose,g);
  const ratio=Math.min(1,aspect())/Math.min(1,oldAspect);
  choice.g=place(choice.pose,aspect(),g.h*ratio,a.x,a.y,g.flip);
  if(fitMode!=='manual')newFit();else resetFloating(choice.g);guide();
}
mode.addEventListener('change',async()=>{
  sceneAdvisor.reset();
  beauty.hide();
  if(phase==='result'){resultPreview();return;}if(busy)return;
  const old=aspect();resizeCanvas();motion=new Coach();timerEnd=0;touches.clear();
  if(!source)drawBackground();if(choice){rotateGuide(old);refreshReference();}
  if(trayOpen)await rank({input:bg||captureRawBackground()});
  else if(bg&&!source&&phase==='select')await rank();
});
const edges=['top','right','bottom','left'];
let naturalLens=0,displayTurn=0;
try{const saved=localStorage.getItem('natural-camera-edge');if(edges.includes(saved))naturalLens=edges.indexOf(saved);}catch{}
function refreshShutterEdge(){
  const native=window.Phone?.cameraEdge?.();
  const [turn,edge]=native?native.split(','):[Math.round((screen.orientation?.angle||0)/90)||Number(mode.matches),''];
  displayTurn=(Number(turn)+4)%4;
  const detected=edges.indexOf(edge);
  const camera=detected>=0?detected:(naturalLens-displayTurn+4)%4;
  const shutter=edges[(camera+2)%4];
  document.body.dataset.shutter=shutter;
  document.body.dataset.grip=shutter==='left'?'left':'right';
  document.body.toggleAttribute('data-known-lens',detected>=0);
  if(detected>=0&&$('lensPanel').open)$('lensPanel').close();
}
window.refreshShutterEdge=refreshShutterEdge;
screen.orientation?.addEventListener?.('change',refreshShutterEdge);
mode.addEventListener('change',refreshShutterEdge);
event('switchHand',()=>{timerEnd=0;motion=new Coach();silence();$('lensPanel').showModal();});
event('closeLens',()=>$('lensPanel').close());
for(const b of $('lensPanel').querySelectorAll('[data-lens]'))b.onclick=()=>{
  naturalLens=(Number(b.dataset.lens)+displayTurn)%4;
  try{localStorage.setItem('natural-camera-edge',edges[naturalLens]);}catch{}
  refreshShutterEdge();$('lensPanel').close();
};
async function init(){
  let floatPref=null;try{floatPref=localStorage.getItem('floating-guide');}catch{}
  floatSwitch.checked=floatPref?floatPref==='on':!matchMedia('(prefers-reduced-motion: reduce)').matches;
  floatSwitch.onchange=()=>{
    try{localStorage.setItem('floating-guide',floatSwitch.checked?'on':'off');}catch{}
    if(choice){
      if(fitMode==='manual')resetFloating(choice.g);else floating.reset();
      choice.g=baseGuide;guide();
    }
    syncTilt();
  };
  try{$('intimateFirst').checked=localStorage.getItem('intimate-first')==='on';}catch{}
  initSound(()=>{timerEnd=0;motion=new Coach();readyPulse=false;});
  refreshShutterEdge();
  for(const id of ['quickBeauty','guideBeauty'])event(id,()=>{
    if(busy||beautyPanel.open)return;
    reopenDeck=trayOpen;if(trayOpen)closeTray();
    silence();timerEnd=0;motion=new Coach();readyPulse=false;follower.reset();show('roles',false);
    beautyPanel.showModal();document.body.setAttribute('data-beauty-edit','');beautyNotice();loadBeautyModel();
  });
  $('closeBeauty').onclick=()=>beautyPanel.close();
  beautyPanel.onclick=e=>{
    if(e.target!==beautyPanel)return;const r=beautyPanel.getBoundingClientRect();
    if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)beautyPanel.close();
  };
  beautyPanel.addEventListener('close',()=>{
    document.body.removeAttribute('data-beauty-edit');
    if(reopenDeck&&source==='camera'&&phase==='select')Promise.resolve(openTray()).catch(error);
    reopenDeck=false;
  });
  const styles=[...document.querySelectorAll('input[name=guideStyle]')];
  try{guideStyle=styles.find(s=>s.value===localStorage.getItem('reference-style'))?.value||'study';}catch{}
  for(const radio of styles){
    radio.checked=radio.value===guideStyle;
    radio.onchange=()=>{if(!radio.checked)return;guideStyle=radio.value;try{localStorage.setItem('reference-style',guideStyle);}catch{}guide();};
  }
  try{$('haptic').checked=localStorage.getItem('aligned-haptic')!=='off';}catch{}
  $('haptic').onchange=()=>{try{localStorage.setItem('aligned-haptic',$('haptic').checked?'on':'off');}catch{}};
  const slider=$('inkOpacity');
  const setOpacity=()=>{document.documentElement.style.setProperty('--guide-opacity',Number(slider.value)/100);$('inkValue').textContent=slider.value+'%';};
  try{const saved=Number(localStorage.getItem('ink-strength'));if(saved>=40&&saved<=100)slider.value=saved;}catch{}
  setOpacity();slider.oninput=setOpacity;slider.onchange=()=>{setOpacity();try{localStorage.setItem('ink-strength',slider.value);}catch{}};
  resizeCanvas();panels('select');drawBackground();
  const camera=scanCamera().catch(error);
  const raw=await (await fetch('library.json')).json();
  library=raw.map(r=>{const base=poses.find(p=>p.id===r.id)||poses.find(p=>p.id===fallback[r.family])||poses[0];return {...base,...r,mask:atob(r.mask)};});
  $('browse').textContent='模板库 · '+library.length;await camera;
}
init().catch(error);
