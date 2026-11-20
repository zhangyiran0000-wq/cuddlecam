import {naturalPortrait} from './retouch.mjs';

export function beautyControls(onChange){
  const $=id=>document.getElementById(id);
  const toggle=$('liveBeauty'),presets={light:{smooth:15,slim:5,tone:15},natural:naturalPortrait,strong:{smooth:65,slim:35,tone:50}};
  const inputs={smooth:$('liveSmooth'),slim:$('liveSlim'),tone:$('liveTone')};
  let levels={...naturalPortrait};
  try{
    toggle.checked=localStorage.getItem('live-beauty')==='on';
    const saved=JSON.parse(localStorage.getItem('live-beauty-levels'));
    for(const k of Object.keys(inputs)){
      if(Number.isInteger(saved?.[k])&&saved[k]>=0&&saved[k]<=100)levels[k]=Math.round(saved[k]/5)*5;
    }
  }catch{}
  function render(){
    for(const [key,input] of Object.entries(inputs)){
      input.value=levels[key];input.nextElementSibling.value=levels[key]+'%';
    }
    for(const b of $('beautyPresets').children){
      const preset=presets[b.dataset.preset];
      b.setAttribute('aria-pressed',String(toggle.checked&&Object.keys(inputs).every(k=>levels[k]===preset[k])));
    }
    for(const id of ['quickBeauty','guideBeauty'])$(id).toggleAttribute('data-active',toggle.checked);
  }
  function changed(){
    render();try{
      localStorage.setItem('live-beauty-levels',JSON.stringify(levels));
      localStorage.setItem('live-beauty',toggle.checked?'on':'off');
    }catch{}
    onChange();
  }
  toggle.onchange=()=>{
    if(toggle.checked&&!Object.values(levels).some(Boolean))levels={...naturalPortrait};
    changed();
  };
  for(const [key,input] of Object.entries(inputs))input.oninput=()=>{
    levels={...levels,[key]:Number(input.value)};toggle.checked=Object.values(levels).some(Boolean);changed();
  };
  for(const b of $('beautyPresets').children)b.onclick=()=>{
    levels={...presets[b.dataset.preset]};toggle.checked=true;changed();
  };
  render();
  return {get values(){return toggle.checked?levels:null;}};
}
