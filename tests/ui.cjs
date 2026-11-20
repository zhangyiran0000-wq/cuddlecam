const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,launchOptions}=require('./browser.cjs');
const base=path.resolve('web'),out=path.resolve('outputs'),files=path.join(__dirname,'templates20');
const mime={wav:'audio/wav',ogg:'audio/ogg',html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',wasm:'application/wasm',json:'application/json',jpg:'image/jpeg',png:'image/png',webp:'image/webp',woff2:'font/woff2',ttf:'font/ttf'};
const loads=[],offsite=[],errors=[];let block='',browser,site;
const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname.slice(1));
  loads.push(name);
  const file=path.join(base,name);
  if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||(block&&name.endsWith(block))){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',mime[path.extname(file).slice(1)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');
  fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
});
async function page(camera,landmarks=false){
  const p=await browser.newPage({viewport:{width:852,height:393},deviceScaleFactor:1.5,hasTouch:true});
  p.setDefaultTimeout(20000);p.on('pageerror',e=>errors.push(e.message));
  p.on('request',req=>{if(!req.url().startsWith(site)&&/^https?:/.test(req.url()))offsite.push(req.url());});
  await p.addInitScript(camera=>{
    localStorage.setItem('print-score','true');

    window.saved=[];window.cues=[];window.plays=[];window.pulses=0;window.clicks=0;window.enforced=false;window.volumeCapture=false;
    const OriginalAudio=window.Audio;
    window.Audio=class extends OriginalAudio{
      constructor(...args){super(...args);this.addEventListener('playing',()=>plays.push(new URL(this.currentSrc).pathname));}
    };
    window.Phone={quiet(){},alignedPulse(){pulses++;},setVolumeShutter(v){volumeCapture=v;},
      requiresShutterSound(){return enforced;},playRequiredShutter(){clicks++;},
      speak(text){window.cues.push(text);return true;},saveJpeg(data){saved.push(data);return true;}};

    navigator.mediaDevices.getUserMedia=async()=>{
      if(!camera)throw new DOMException('Denied','NotAllowedError');
      const bg=new Image(),pair=new Image();bg.src='/assets/alley-wide.jpg';pair.src='/assets/cheeks.jpg';await Promise.all([bg.decode(),pair.decode()]);
      const c=document.createElement('canvas');c.width=1280;c.height=720;const g=c.getContext('2d');
      g.translate(1280,0);g.scale(-1,1);
      const draw=()=>window.pair?g.drawImage(pair,0,.11*pair.height,pair.width,pair.width*9/16,0,0,1280,720):window.altScene?(g.fillStyle='#116f93',g.fillRect(0,0,1280,720)):g.drawImage(bg,0,0,1280,720);
      draw();const stream=c.captureStream(15),t=setInterval(()=>stream.active?draw():clearInterval(t),66);return stream;
    };
  },camera);
  if(landmarks){
    await p.route('**/models.mjs',r=>{
      let script=fs.readFileSync(path.join(base,'models.mjs'),'utf8');
      const start='export function faceObservations(model,input,read,centers=null){';
      assert.ok(script.includes(start));script=script.replace(start,start+'if(centers&&window.sampleFaces)return window.sampleFaces(centers);');
      return r.fulfill({body:script,contentType:'text/javascript'});
    });
  }
  await p.goto(site+'/index.html');return p;
}
async function openPhoto(p,id,file){
  await p.evaluate(()=>{window.freshResult=false;const m=new MutationObserver(()=>{m.disconnect();window.freshResult=true;});m.observe(document.querySelector('#resultType'),{childList:true});});
  const chooser=p.waitForEvent('filechooser');await p.click(id);await (await chooser).setFiles(path.join(base,'assets',file));
  await p.waitForFunction(()=>window.freshResult&&document.body.dataset.phase==='result'&&document.querySelector('#save').textContent==='保存照片',null,{timeout:45000});
}
async function setStrength(p,n){await p.locator('#strength').evaluate((e,n)=>{e.value=n;e.dispatchEvent(new Event('input'));},n);}
async function ready(p,id){
  await p.waitForFunction(()=>!document.querySelector('#styleNote').textContent.includes('正在'),null,{timeout:95000});
  assert.equal(await p.getAttribute('[data-look='+id+']','aria-pressed'),'true',await p.textContent('#styleNote'));
}
async function save(p,file){
  const before=await p.evaluate(()=>saved.length);await p.click('#save');
  await p.waitForFunction(n=>saved.length>n,before);const jpeg=await p.evaluate(()=>saved.at(-1));
  if(file)fs.writeFileSync(path.join(files,file+'.jpg'),Buffer.from(jpeg,'base64'));return jpeg;
}
async function preview(p){return p.locator('#photo').evaluate(c=>c.toDataURL('image/png'));}
async function nextDraw(p){await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function run(){
  fs.mkdirSync('outputs/qa',{recursive:true});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));site='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch(launchOptions);
  let p=await page(true);await p.locator('#cards .card').first().waitFor();
  let checks=0;
  async function fits(sel){
    await nextDraw(p);
    const issues=await p.locator(sel).evaluate(el=>{
      const problems=[],v={w:innerWidth,h:innerHeight};
      for(const e of [el,...el.querySelectorAll('*')]){
        const r=e.getBoundingClientRect(),style=getComputedStyle(e);
        if(!r.width||!r.height||style.visibility==='hidden'||style.display==='none'||e.closest('[hidden]')||style.opacity==='0'||e.matches('input[type=file]'))continue;
        if(r.left<-.75||r.top<-.75||r.right>v.w+.75||r.bottom>v.h+.75)problems.push(['outside',e.id||e.tagName,Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]);
        if(['auto','scroll'].includes(style.overflowY)&&e.scrollHeight>e.clientHeight+2)problems.push(['scrollY',e.id||e.tagName,e.scrollHeight,e.clientHeight]);
        if(['auto','scroll'].includes(style.overflowX)&&e.scrollWidth>e.clientWidth+2)problems.push(['scrollX',e.id||e.tagName]);
      }
      if(el.scrollHeight>el.clientHeight+2)problems.push(['panel overflow',el.id,el.scrollHeight,el.clientHeight]);
      return problems;
    });
    assert.deepEqual(issues,[],sel+' '+JSON.stringify(p.viewportSize())+' '+JSON.stringify(issues));checks++;
  }
  async function orient(w,h,edge,turn){
    await p.setViewportSize({width:w,height:h});
    await p.evaluate(([edge,turn])=>{Phone.cameraEdge=()=>turn+','+edge;refreshShutterEdge();},[edge,turn]);
    await nextDraw(p);
  }
  async function shutter(sel,edge){
    const r=await p.locator(sel).boundingBox(),v=p.viewportSize(),x=(r.x+r.width/2)/v.width,y=(r.y+r.height/2)/v.height;
    assert.ok(({left:x<.18,right:x>.82,top:y<.23,bottom:y>.77})[edge],JSON.stringify({sel,edge,x,y}));
  }
  const sizes=[[360,640,'top',0],[320,568,'top',0],[800,360,'left',1],[800,360,'right',3],[640,280,'left',1],[640,280,'right',3],[360,640,'bottom',2]];
  for(const [w,h,edge,turn] of sizes){
    console.log('Templates',w,h,edge);await orient(w,h,edge,turn);
    await fits('#select');await shutter('#quickShutter',({top:'bottom',bottom:'top',left:'right',right:'left'})[edge]);
    await p.click('#templateFilters');await fits('#typePanel');await p.click('[data-type="all"]');
    await p.click('#chooseSourceMini');await fits('#sourcePanel');await p.click('#closeSource');
    await p.click('#browse');await fits('#select');await p.click('#nextPage');await fits('#select');await p.click('#browse');
  }
  await p.locator('#cards .card').first().click();await p.locator('#shutter').waitFor();
  for(const [w,h,edge,turn] of sizes){
    console.log('Settings',w,h,edge);await orient(w,h,edge,turn);
    await fits('#finderTools');await shutter('#shutter',({top:'bottom',bottom:'top',left:'right',right:'left'})[edge]);
    await p.click('#settings');
    for(let i=0;i<6;i++){await p.click('[data-tab="'+i+'"]');await fits('#poseOptions');}
    await p.click('[data-tab="3"]');
    await p.evaluate(()=>{document.querySelector('#sceneNote').textContent='街景建筑 · 把街景留在肩旁，让建筑边缘避开头顶。（9.9 秒）';document.querySelector('#sceneApply').hidden=false;document.querySelector('#sceneApply').textContent='撤销 AI 调整';});
    await fits('#poseOptions');
    if(w===800&&edge==='right')await p.screenshot({path:'outputs/qa/settings-landscape.png'});
    await p.click('#closeSettings');await p.click('#guideBeauty');
    for(const key of ['liveSmooth','liveSlim','liveTone']){await p.click('[data-parameter="'+key+'"]');await fits('#beautyPanel');}
    if(w===360&&edge==='top')await p.screenshot({path:'outputs/qa/beauty-portrait.png'});
    await p.click('#closeBeauty');await p.click('#finderSound');await fits('#soundPanel');await p.click('#closeSound');
  }
  await p.click('#shutter');await p.locator('#result').waitFor();
  for(const [w,h,edge,turn] of sizes.slice(0,6)){
    console.log('Result',w,h);await orient(w,h,edge,turn);
    for(const tab of ['style','portrait','next']){
      await p.click('[data-result-tab="'+tab+'"]');
      if(tab==='portrait')await p.evaluate(()=>{document.querySelector('#faceTools').hidden=false;document.querySelector('#faceNote').textContent='已识别两张脸。';});
      await fits('#result');
    }
    await p.click('[data-result-tab="portrait"]');
    for(const key of ['smooth','slim','tone']){await p.click('[data-parameter="'+key+'"]');await fits('#result');}
    if(w===800)await p.screenshot({path:'outputs/qa/result-landscape.png'});
  }
  await p.close();p=await page(false);
  await p.locator('#chooseSource').waitFor();
  for(const [w,h] of [[320,568],[640,280]]){
    await p.setViewportSize({width:w,height:h});await fits('#select');
    await p.click('#chooseSource');await fits('#sourcePanel');await p.click('#closeSource');
  }
  await p.locator('#backgroundFile').setInputFiles(path.join(base,'assets/alley-wide.jpg'));
  await p.locator('#cards .card').first().waitFor();
  for(const [w,h] of [[320,568],[640,280]]){
    console.log('Album / permission denied',w,h);await p.setViewportSize({width:w,height:h});await fits('#select');
    await p.click('#browse');await fits('#select');await p.click('#browse');
  }
  await p.locator('#cards .card').first().click();await p.locator('#start').waitFor();
  for(const [w,h] of [[320,568],[640,280]]){
    await p.setViewportSize({width:w,height:h});
    for(let i=0;i<6;i++){await p.click('[data-tab="'+i+'"]');await fits('#poseOptions');}
  }
  assert.deepEqual(errors,[]);assert.deepEqual(offsite,[]);
  console.log('PASS',checks,'panel checks: all options accessible without scrolling, both shutter rails and four rotations.');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
