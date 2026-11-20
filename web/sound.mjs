const $=id=>document.getElementById(id);
const panel=$('soundPanel'),guide=$('guideAudio'),shutter=$('shutterAudio');
let speechClip=null,clickClip=null,shutterEnabled=false;

function stored(key,fallback){
  try{return localStorage.getItem(key)??fallback;}catch{return fallback;}
}
function remember(key,enabled){try{localStorage.setItem(key,enabled?'on':'off');}catch{}}
function required(){return window.Phone?.requiresShutterSound?.()===true;}
function render(){
  const enforced=required(),audible=guide.checked||shutterEnabled||enforced;
  shutter.checked=shutterEnabled||enforced;shutter.disabled=enforced;
  for(const id of ['voice','finderSound'])$(id).querySelector('use').setAttribute('href',audible?'#i-sound':'#i-muted');
  $('finderSound').setAttribute('aria-label',audible?'声音设置':'声音设置，已静音');
  $('voice').querySelector('span').textContent=audible?'声音':'已静音';
  $('muteAll').textContent=enforced?'关闭姿势语音':audible?'全部静音':'已全部静音';
  $('muteAll').disabled=!guide.checked&&(enforced||!shutterEnabled);
  $('soundRoute').textContent=enforced?'设备要求播放系统快门声。姿势语音跟随媒体输出。':'声音跟随媒体输出。音量键由系统控制。';
}
function stopSpeech(){
  window.Phone?.quiet?.();window.speechSynthesis?.cancel();
  stopRecording();
}
function stopRecording(){
  const clip=speechClip;speechClip=null;clip?.pause();
}
export function silence(){stopSpeech();clickClip?.pause();}
export function voice(text,key,force=false){
  if(!guide.checked||panel.open)return;
  if(window.Phone?.speak?.(text)){stopRecording();window.speechSynthesis?.cancel();return;}
  if(!window.Phone&&window.speechSynthesis){
    const v=speechSynthesis.getVoices().find(v=>v.lang.toLowerCase().startsWith('zh'));
    if(v){stopRecording();speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.voice=v;speechSynthesis.speak(u);return;}
  }
  if(speechClip&&!force&&!speechClip.paused&&!speechClip.ended)return;
  speechClip?.pause();
  const name=key==='hand'?'hands':key||'ready';
  const clip=new Audio('audio/'+name+(name.startsWith('pose-')?'.ogg':'.wav'));speechClip=clip;
  clip.play().catch(()=>{if(speechClip===clip)$('status').textContent='当前无法播放语音，可按画面文字调整。';});
}
export function shotFeedback(isCamera,guided){
  if(isCamera&&required())window.Phone.playRequiredShutter();
  else if(shutterEnabled){
    clickClip??=new Audio('audio/shutter.wav');clickClip.currentTime=0;
    clickClip.play().catch(()=>{});
  }
  if($('haptic').checked)window.Phone?.alignedPulse?.();
  if(guided)voice('拍好了。','shot',true);
}
export function initSound(onOpen){
  $('soloVoice').checked=stored('solo-voice','on')!=='off';
  $('soloVoice').onchange=()=>remember('solo-voice',$('soloVoice').checked);
  guide.checked=stored('pose-voice','on')!=='off';
  shutterEnabled=stored('shutter-audio','off')==='on';render();
  for(const id of ['voice','finderSound','sheetVoice'])$(id).onclick=()=>{
    if(panel.open)return;
    render();silence();panel.showModal();onOpen();
  };
  const close=()=>panel.close();
  $('closeSound').onclick=close;
  panel.addEventListener('click',e=>{if(e.target!==panel)return;
    const b=panel.getBoundingClientRect();
    if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)close();
  });
  guide.onchange=()=>{remember('pose-voice',guide.checked);if(!guide.checked)stopSpeech();render();};
  shutter.onchange=()=>{shutterEnabled=shutter.checked;remember('shutter-audio',shutterEnabled);if(!shutterEnabled)clickClip?.pause();render();};
  $('muteAll').onclick=()=>{
    guide.checked=false;shutterEnabled=false;remember('pose-voice',false);remember('shutter-audio',false);silence();render();
  };
}
