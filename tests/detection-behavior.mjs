import assert from 'node:assert/strict';
import {sameFace,FaceStream} from '../web/face-detection.mjs';
import {Coach} from '../web/engine.mjs';
const face=(x,y,w=.3,h=.4)=>({eye:{x,y},width:w,height:h,box:[x-w/2,y-h*.4,x+w/2,y+h*.6]});
assert.ok(sameFace(face(.4,.4),face(.41,.41)),'same face across crop/roll retries');
assert.ok(!sameFace(face(.4,.4),face(.62,.44)),'overlapping adjacent heads remain separate');
assert.ok(!sameFace(face(.4,.4),face(.4,.8)),'vertically separated faces remain separate');
const pose={id:'front-4',family:'front',setup:'两人一起看镜头。'};
const coach=new Coach(),spoken=[];
for(let now=0;now<60000;now+=250){
  const state=coach.update(now,{cue:'missing',count:1,visible:{x:.4,y:.4}},pose);
  if(state.speak)spoken.push(state.key);
  assert.equal(state.ready,false,'one face never triggers auto shutter');
}
assert.deepEqual(spoken,['one-face','manual-shot'],'persistent miss is not a repeating nag');
const flicker=new Coach(),speech=[];
for(let now=0;now<30000;now+=250){
  const count=now%6000<3000?0:1;
  const state=flicker.update(now,{cue:'missing',count},pose);
  if(state.speak)speech.push(state.key);
}
assert.equal(new Set(speech).size,speech.length,'0/1 flicker cannot repeat spoken warnings');
assert.ok(speech.includes('manual-shot'),'fallback still appears with intermittent detection');
const pair={cue:'turn',count:2,ordered:[face(.3,.4),face(.7,.4)],aspect:16/9,actor:0,turnAction:'front'};
for(let now=60000;now<61000;now+=250)coach.update(now,pair,pose);
let resaid=false;
for(let now=61000;now<68000;now+=250)resaid||=coach.update(now,{cue:'missing',count:1},pose).speak;
assert.ok(resaid,'a newly lost pair may get a fresh, single warning');

globalThis.document={createElement:()=>({getContext:()=>({fillRect(){},drawImage(){},translate(){},rotate(){},scale(){}})})};
const meshes=[[[.3,.4]],[[.7,.4]]].map(m=>m.map(([x,y])=>({x,y})));
let visible=true;const stamps=[];
const video={detectForVideo(input,stamp){stamps.push(stamp);return {faceLandmarks:visible?meshes:[]};}};
const still={detect(){return {faceLandmarks:visible?meshes:[]};}};
const stream=new FaceStream(video,still),frame={width:640,height:360};
const read=m=>face(m[0].x,m[0].y);
assert.equal(stream.observe(frame,read,null,1000).length,2);
visible=false;
assert.equal(stream.observe(frame,read,null,1250).length,0,'no stale face in a current-frame result');
stream.reset();stream.observe(frame,read,null,0);
assert.ok(stamps[2]>stamps[1],'timestamps remain monotonic after a reset');
console.log('PASS detection guards: adjacent heads, duplicate crops, no stale faces, monotonic timestamps, bounded prompts, no single-face auto shutter.');
