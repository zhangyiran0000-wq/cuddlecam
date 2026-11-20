import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SoloCue} from '../web/solo-cue.mjs';
import {AdaptiveGuide} from '../web/adaptive-guide.mjs';
import {place,anchorOf,guidePoint} from '../web/framing.mjs';
import {poses} from '../web/engine.mjs';
import {sceneCoach} from '../web/scene-coach.mjs';

const cue=new SoloCue();let fired=0;
for(let t=0;t<=20000;t+=250)fired+=Number(cue.update(1,t));
assert.equal(fired,1,'one cue per continuous solo episode');
cue.reset();for(let t=21000;t<35000;t+=250)assert.equal(cue.update(1,t),false,'cooldown survives camera restart');
const occluded=new SoloCue();occluded.update(2,0);
for(let t=250;t<30000;t+=250)assert.equal(occluded.update(1,t),false,'occluded partner grace');
const broken=new SoloCue();
for(let t=0;t<20000;t+=250)assert.equal(broken.update(t%5000===0?0:1,t),false,'intermittent faces do not trigger');
for(const mode of [{enabled:false},{blocked:true},{canSpeak:false}]){
  const silent=new SoloCue();for(let t=0;t<20000;t+=250)assert.equal(silent.update(1,t,mode),false);
}
const gaps=new SoloCue();for(let t=0;t<30000;t+=1500)assert.equal(gaps.update(1,t),false,'suspended inference is not continuous');

const scene={w:20,h:16,sal:Float32Array.from({length:320},(_,i)=>i%20<10?.6:.1),light:.5,clipped:0};
const library=JSON.parse(fs.readFileSync(new URL('../web/library.json',import.meta.url)));
let geometry=0;
for(const raw of library){
  const pose={...poses.find(p=>p.id===raw.id),...raw};
  for(const aspect of [3/4,16/9,1])for(const flip of [false,true]){
    const base=place(pose,aspect,1.1,.5,.43,flip);
    const faces=pose.eyes.map(([x,y],i)=>{
      const eye=guidePoint(base,x,y),height=pose.heads[i][3]*1.72*base.h;
      return {eye,height,box:[eye.x-.07,eye.y-.07,eye.x+.07,eye.y+.08]};
    });
    for(const count of [0,2]){
      const adaptive=new AdaptiveGuide();assert.equal(adaptive.accept(2,1),true);
      let current=base;
      for(let t=1;t<=20000;t+=250){
        const next=adaptive.update(pose,base,aspect,faces.slice(0,count),t,()=>scene);
        assert.ok(Object.values(next).every(v=>typeof v==='boolean'||Number.isFinite(v)));
        assert.ok(next.h>=base.h*(count===2?.979:.939),'scale does not accumulate');
        assert.ok(Math.abs(next.h-current.h)<base.h*.012,'no scale jumps');
        for(const [x,y,rx,ry] of pose.heads){
          const p=guidePoint(next,x,y);assert.ok(p.x>.005&&p.x<.995&&p.y>.005&&p.y<.995,'heads remain in frame');
        }
        const crop=(1-next.y)/next.h,[,,lo,hi]=pose.torsoCrop||[.23,.77,.76,.90];
        assert.ok(crop>=lo-1e-6&&crop<=hi+1e-6,'torso reaches image bottom');
        current=next;
      }
      const before=adaptive.snapshot();adaptive.restore({scene:-1,until:0});
      for(let t=20251;t<40000;t+=250)current=adaptive.update(pose,base,aspect,faces.slice(0,count),t,()=>scene);
      assert.ok(Math.abs(current.h-base.h)<.001,'undo converges to base fit');
      assert.equal(before.scene,2);geometry++;
    }
  }
}

// Exercise the asynchronous VLM integration using controlled native results.
let now=50000,changed=false,adjustable=true,adjustments=0,restores=0,clears=0,ticket;
const elements=new Map(),storage=new Map();
const element=id=>{if(!elements.has(id))elements.set(id,{hidden:true,checked:false,textContent:'',disabled:false});return elements.get(id);};
globalThis.performance={now:()=>now};
globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
globalThis.document={hidden:false,getElementById:element,createElement:()=>({getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,AA=='})};
globalThis.window={Phone:{analyzeScene(k){ticket=k;return true;},cancelScene(){}}};
const stamp=Uint8Array.from([40,80,120,255,160,180,200,255]),pose={id:'test'},frame={width:100,height:100};
const advisor=sceneCoach({frame:()=>frame,signature:()=>stamp,difference:()=>changed?.2:0,pose:()=>pose,allowSpeech:()=>true,speak(){},canAdjust:()=>adjustable,
  adjust:()=>{adjustments++;return {scene:-1,until:0};},restore:()=>restores++,clearAdjustment:()=>clears++});
element('sceneAsk').onclick();window.sceneCoachResult(ticket+1,2,.9,800);assert.equal(adjustments,0);
window.sceneCoachResult(ticket,2,.9,800);assert.equal(adjustments,1);assert.equal(element('sceneApply').hidden,false);
element('sceneApply').onclick();assert.equal(restores,1);
element('sceneAsk').onclick();window.sceneCoachResult(ticket,2,.5,800);assert.equal(adjustments,1,'uncertain VLM result ignored');
element('sceneAsk').onclick();changed=true;window.sceneCoachResult(ticket,2,.9,800);changed=false;assert.equal(adjustments,1,'stale scene ignored');
element('sceneAsk').onclick();adjustable=false;window.sceneCoachResult(ticket,2,.9,800);assert.equal(adjustments,1,'manual drag and countdown protected');adjustable=true;
element('sceneAdapt').checked=false;element('sceneAdapt').onchange();assert.ok(clears>0);
element('sceneAsk').onclick();window.sceneCoachResult(ticket,2,.9,800);assert.equal(adjustments,1,'opt out respected');
advisor.reset();element('sceneAdapt').checked=true;element('sceneAuto').checked=true;
let count=0;window.Phone.analyzeScene=k=>{ticket=k;count++;return true;};
now=80000;advisor.tick(now);now+=1500;advisor.tick(now);assert.equal(count,1);
window.sceneCoachResult(ticket,2,.9,800);now+=30000;advisor.tick(now);assert.equal(count,1,'unchanged scene does not repeatedly run VLM');
advisor.reset();
console.log('PASS: solo debounce / occlusion / mute / cooldown; '+geometry+' geometry cases; VLM confidence / stale result / undo / manual protection / throttling.');
