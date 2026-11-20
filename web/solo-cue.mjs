// A missing second face can be an occluded partner. Require a continuous,
// well-lit solo observation and stay quiet after seeing a pair.
export class SoloCue {
  constructor(){this.lastSpoken=-Infinity;this.lastPair=-Infinity;this.reset();}
  reset(){this.since=null;this.previous=-Infinity;this.samples=0;this.fired=false;}
  update(count,now,{enabled=true,blocked=false,canSpeak=true}={}){
    if(count>=2)this.lastPair=now;
    if(!enabled||blocked||count!==1){this.since=null;this.samples=0;this.previous=now;return false;}
    if(now-this.previous>1200){this.since=null;this.samples=0;}
    this.previous=now;this.since??=now;this.samples++;
    if(!canSpeak||this.fired||now-this.since<7000||this.samples<8||now-this.lastPair<30000||now-this.lastSpoken<120000)return false;
    this.fired=true;this.lastSpoken=now;return true;
  }
}
