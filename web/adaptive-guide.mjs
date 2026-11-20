import {anchorOf,place} from './framing.mjs';
import {sceneBalance} from './floating.mjs';

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
// VLM supplies scene semantics. Landmarks and template crop constraints remain
// authoritative for geometry; offsets are relative to the current face fit.
export class AdaptiveGuide {
  constructor(){this.clear();}
  clear(){this.scene=-1;this.until=0;this.scale=1;this.shift=0;this.last=0;this.balance=0;this.votes=[];this.scanned=-Infinity;}
  snapshot(){return {scene:this.scene,until:this.until};}
  restore(state){this.scene=state?.scene??-1;this.until=state?.until??0;this.votes=[];}
  accept(scene,now){
    if(!Number.isInteger(scene)||scene<0||scene>5)return false;
    this.scene=scene;this.until=now+60000;return true;
  }
  update(pose,base,aspect,faces,now,readScene){
    const dt=this.last?clamp(now-this.last,0,400):0;this.last=now;
    const active=this.scene>=0&&now<this.until,scenic=active&&this.scene>=1&&this.scene<=4;
    if(scenic&&now-this.scanned>700){
      if(now-this.scanned>1800)this.votes=[];
      this.scanned=now;
      const balance=sceneBalance(readScene(),faces);
      if(balance===null)this.votes=[];
      else{this.votes.push(balance);if(this.votes.length>3)this.votes.shift();
        if(this.votes.length===3&&this.votes.every(x=>Math.sign(x)===Math.sign(balance)))this.balance=[...this.votes].sort((a,b)=>a-b)[1];}
    }
    // With two people visible, protect alignment. Before they arrive there is
    // more freedom to reserve background. Never accumulate shrinkage.
    const paired=faces.length===2;
    const targetScale=scenic?(paired?.98:.94):1;
    const targetShift=scenic?this.balance*(paired?.012:.055):0;
    const gain=1-Math.exp(-dt/1800);
    this.scale+=(targetScale-this.scale)*gain;this.shift+=(targetShift-this.shift)*gain;
    const a=anchorOf(pose,base);
    const result=place(pose,aspect,base.h*this.scale,a.x+this.shift,a.y,base.flip);
    // The caller recomputes sensor perspective with the final crop constraints.
    return result;
  }
}
