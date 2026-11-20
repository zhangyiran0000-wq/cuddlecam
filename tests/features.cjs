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
  await p.route('**/models.mjs',route=>{
    const source=fs.readFileSync(path.join(base,'models.mjs'),'utf8').replace('export function faceObservations(model,input,read,centers=null){','export function faceObservations(model,input,read,centers=null){if(window.testFaces)return window.testFaces;');
    return route.fulfill({body:source,contentType:'text/javascript'});
  });
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
  await new Promise(r=>server.listen(0,'127.0.0.1',r));site='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch(launchOptions);
  const p=await page(true);await p.locator('#cards .card').first().waitFor();
  await p.click('#closeTray');
  await p.evaluate(()=>{window.testFaces=[{eye:{x:.5,y:.4},height:.2,box:[.4,.3,.6,.5]}];});
  await p.waitForFunction(()=>cues.includes('你需要先找一个对象呢'),null,{timeout:15000});
  console.log('Solo voice reached native speech bridge.');
  await p.click('#finderSound');await p.uncheck('#soloVoice');await p.click('#closeSound');
  await p.evaluate(()=>{window.testFaces=[];});
  await p.click('#scan');await p.locator('#cards .card').first().click();await p.locator('#shutter').waitFor();
  await p.click('#settings');await p.click('[data-tab="3"]');
  await p.uncheck('#sceneAuto');await p.check('#sceneAdapt');
  await p.evaluate(()=>{Phone.analyzeScene=(ticket)=>{setTimeout(()=>sceneCoachResult(ticket,2,.95,150),150);return true;};});
  await p.click('#sceneAsk');await p.waitForFunction(()=>document.querySelector('#sceneApply').textContent==='撤销 AI 调整');
  const before=await p.locator('#outline').evaluate(e=>parseFloat(e.style.height));
  await p.click('#closeSettings');
  await p.waitForFunction(before=>parseFloat(document.querySelector('#outline').style.height)<before-.3,before,{timeout:10000});
  console.log('Accepted scene result smoothly changed the visible guide.');
  await p.click('#settings');await p.click('#sceneApply');
  await p.click('[data-tab="2"]');await p.click('#smaller');
  const manual=await p.locator('#outline').evaluate(e=>e.style.height);assert.equal(await p.textContent('#fitState'),'手动锁定');
  await p.click('[data-tab="3"]');await p.click('#sceneAsk');
  await p.waitForFunction(()=>!document.querySelector('#sceneAsk').disabled);
  await p.click('#closeSettings');await nextDraw(p);
  assert.equal(await p.locator('#outline').evaluate(e=>e.style.height),manual,'manual guide is preserved');
  assert.equal(await p.evaluate(()=>cues.filter(t=>t==='你需要先找一个对象呢').length),1);
  await p.waitForFunction(()=>document.querySelector('#hint').textContent.includes('可直接按快门'),null,{timeout:20000});
  assert.equal(await p.evaluate(()=>document.body.dataset.phase),'live','missed faces never auto fire');
  await p.screenshot({path:'outputs/qa/detection-fallback.png'});
  await p.click('#shutter');
  await p.waitForFunction(()=>document.body.dataset.phase==='result',null,{timeout:20000});
  console.log('Persistent detection failure gives a manual fallback; shutter still captures.');
  assert.deepEqual(errors,[]);assert.deepEqual(offsite,[]);
  console.log('PASS app integration: solo speech, mute preference, adaptive visible geometry, undo and manual lock. VLM response is mocked.');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
