const tips=[
  ['人像近景','两张脸先一起入镜，再按参考线靠近。'],
  ['林木','两个人站在同一片光里，把树影留在肩后。'],
  ['街景建筑','把街景留在肩旁，让建筑边缘避开头顶。'],
  ['水景','把水面留在肩旁，水岸线避开眼睛。'],
  ['山景','给远山留一点空间，让山脊避开两张脸。'],
  ['室内','两人一起面向较亮的一侧，让光落在脸上。']
];
export function sceneCoach({frame,signature,difference,pose,allowSpeech,speak,adjust,restore,canAdjust,clearAdjustment}){
  const el=id=>document.getElementById(id);
  const ask=el('sceneAsk'),pref=el('sceneAuto'),adapt=el('sceneAdapt'),note=el('sceneNote'),apply=el('sceneApply'),toast=el('sceneToast');
  let sequence=0,active=null,proposal=null,undo=null,timeout=0,hideToast=0;
  let lastScan=0,stableAt=0,lastStamp=null,tried=false,lastRequest=-Infinity,analyzedStamp=null;
  pref.checked=adapt.checked=true;
  try{pref.checked=localStorage.getItem('scene-vlm-auto')!=='off';adapt.checked=localStorage.getItem('scene-adapt')!=='off';}catch{}
  adapt.onchange=()=>{
    try{localStorage.setItem('scene-adapt',adapt.checked?'on':'off');}catch{}
    if(!adapt.checked){clearAdjustment?.();clearProposal();}
    else{tried=false;lastStamp=null;}
  };
  pref.onchange=()=>{
    try{localStorage.setItem('scene-vlm-auto',pref.checked?'on':'off');}catch{}
    if(!pref.checked&&active?.auto)reset();
  };
  function message(text){note.textContent=text;}
  function clearToast(){clearTimeout(hideToast);toast.hidden=true;}
  function flash(text){
    clearToast();toast.textContent=text;toast.hidden=false;
    hideToast=setTimeout(clearToast,4800);
  }
  function clearProposal(){undo=proposal=null;apply.hidden=true;}
  function reset(){
    if(active)window.Phone?.cancelScene?.();
    active=null;sequence++;clearTimeout(timeout);ask.disabled=false;
    lastStamp=null;stableAt=lastScan=0;tried=false;clearProposal();clearToast();message('');
    analyzedStamp=null;clearAdjustment?.();
  }
  function analyze(auto){
    const photo=frame(),chosen=pose();
    if(active)return;
    if(!photo||!chosen){message('打开相机或选一张背景图后可以分析。');return;}
    if(!window.Phone?.analyzeScene){message('本机视觉模型需要在安卓安装包中运行。');return;}
    clearProposal();clearToast();
    const key=++sequence,stamp=signature(photo);
    let low=255,high=0,total=0;
    for(let i=0;i<stamp.length;i+=4){
      const l=.2126*stamp[i]+.7152*stamp[i+1]+.0722*stamp[i+2];
      low=Math.min(low,l);high=Math.max(high,l);total+=l;
    }
    const mean=total/(stamp.length/4);
    if(mean<16||mean>248||high-low<16){
      message('取景细节不足。让镜头对准有光线和层次的背景，再试一次。');return;
    }
    const scale=Math.min(1,512/Math.max(photo.width,photo.height));
    const small=document.createElement('canvas');
    small.width=Math.max(1,Math.round(photo.width*scale));small.height=Math.max(1,Math.round(photo.height*scale));
    small.getContext('2d').drawImage(photo,0,0,small.width,small.height);
    active={key,auto,stamp,chosen,start:performance.now()};
    lastRequest=performance.now();analyzedStamp=stamp;
    ask.disabled=true;message('正在本机看取景…');
    try{
      if(!window.Phone.analyzeScene(key,small.toDataURL('image/jpeg',.88).split(',')[1])){
        active=null;ask.disabled=false;message('上一帧还在处理，稍后可重试。');return;
      }
      timeout=setTimeout(()=>{
        if(active?.key!==key)return;
        reset();tried=true;message('本次分析超时，可手动重试。');
      },45000);
    }catch{active=null;ask.disabled=false;message('本机分析未完成，可重试。');}
  }
  window.sceneCoachResult=(key,scene,confidence,ms)=>{
    const job=active;
    if(!job||job.key!==key)return;
    active=null;clearTimeout(timeout);ask.disabled=false;
    const photo=frame();
    if(!photo||pose()!==job.chosen||document.hidden||
       difference(job.stamp,signature(photo))>.09||(job.auto&&performance.now()-job.start>10000)){
      message('取景已变化或建议已过时，可再看一次。');return;
    }
    const elapsed=(ms/1000).toFixed(1)+' 秒';
    if(scene<0){message('本次未能运行视觉模型，仍可按参考线拍摄。');return;}
    if(!tips[scene]||!Number.isFinite(confidence)||confidence<.60){
      message('场景不够明确，沿用当前参考线。 · '+elapsed);return;
    }
    const [label,text]=tips[scene],line=label+' · '+text;
    message(line+'（'+elapsed+'）');
    const panelOpen=!el('poseOptions').hidden;
    if((!job.auto&&panelOpen)||allowSpeech()){
      if(!panelOpen)flash(line);
      speak(text,'scene-'+scene,true);
    }
    proposal={stamp:job.stamp,chosen:job.chosen,scene};apply.hidden=false;apply.textContent='调整参考线';
    if(adapt.checked&&confidence>=.70&&canAdjust?.())applyProposal(true);
  };
  function applyProposal(automatic=false){
    const photo=frame();
    if(!proposal||!photo||pose()!==proposal.chosen||difference(proposal.stamp,signature(photo))>.09){
      clearProposal();message('取景已变化，请重新分析。');return;
    }
    if(canAdjust&&!canAdjust()){message('请先结束手动调整或倒计时，再试。');return;}
    undo=adjust({scene:proposal.scene,auto:automatic});proposal=null;
    if(!undo){clearProposal();message('当前参考线保持不变。');return;}
    apply.hidden=false;apply.textContent='撤销 AI 调整';
    message(automatic?'已开启本次场景适配，参考线会缓慢微调。':'参考线将结合人脸位置，缓慢调整留白。');
    if(automatic)flash('AI 已适配参考线 · 可在设置中撤销');
  }
  apply.onclick=()=>{
    if(undo){
      restore(undo);clearProposal();message('已撤销，参考线会平滑恢复。');return;
    }
    applyProposal();
  };
  ask.onclick=()=>analyze(false);
  return {reset,clearProposal,clearToast,tick(now){
    if(!pref.checked||active||now-lastScan<450||!allowSpeech()||now-lastRequest<20000)return;
    const photo=frame();if(!photo)return;lastScan=now;
    const sig=signature(photo);
    if(!lastStamp||difference(lastStamp,sig)>.045){stableAt=now;lastStamp=sig;}
    if(now-stableAt>=1200&&(!tried||analyzedStamp&&difference(analyzedStamp,sig)>.09)){
      tried=true;analyze(true);
    }
  }};
}
