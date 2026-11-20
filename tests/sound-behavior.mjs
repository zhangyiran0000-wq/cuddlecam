import assert from 'node:assert/strict';

const elements=new Map();
globalThis.document={getElementById(id){
  if(!elements.has(id))elements.set(id,{checked:true,open:false});
  return elements.get(id);
}};
let nativeReady=false,nativeSpeech=0,browserSpeech=0;
globalThis.window={Phone:{speak(){if(!nativeReady)return false;nativeSpeech++;return true;}},
  speechSynthesis:{cancel(){},getVoices:()=>[{lang:'zh-CN'}],speak(){browserSpeech++;}}};
globalThis.speechSynthesis=window.speechSynthesis;
globalThis.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
const clips=[];
globalThis.Audio=class {
  constructor(src){this.src=src;this.paused=true;this.ended=false;clips.push(this);}
  play(){this.paused=false;return Promise.resolve();}
  pause(){this.paused=true;}
};
const {voice,silence}=await import('../web/sound.mjs');
voice('两位保持一下。','hold-still');
assert.equal(clips[0].paused,false,'offline recording starts while native TTS initializes');
nativeReady=true;
voice('拍好了。','shot',true);
assert.equal(nativeSpeech,1);
assert.equal(clips[0].paused,true,'native TTS must stop the previous offline recording');
nativeReady=false;
voice('三，二，一。','three',true);
assert.equal(clips[1].paused,false);
delete window.Phone;
voice('拍好了。','shot',true);
assert.equal(browserSpeech,1);
assert.equal(clips[1].paused,true,'browser TTS must stop the previous offline recording');
silence();
console.log('PASS voice handoff: native and browser TTS never overlap the offline recording.');
