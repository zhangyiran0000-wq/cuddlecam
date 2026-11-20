const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,launchOptions}=require('./browser.cjs');
const base=path.resolve('web'),errors=[];
const mime={html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',json:'application/json',wasm:'application/wasm'};
const server=http.createServer((req,res)=>{
  const file=path.resolve(base,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(base+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',mime[path.extname(file).slice(1)]||'application/octet-stream');
  fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
});
let browser;
const nextDraw=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function run(){
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch(launchOptions);
  const p=await browser.newPage({viewport:{width:852,height:393}});
  p.setDefaultTimeout(20000);p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(()=>{
    window.Phone={quiet(){},speak(){return true;},setGuideMotion(){},saveJpeg(){return true;}};
    localStorage.setItem('scene-vlm-auto','off');
    navigator.mediaDevices.getUserMedia=async()=>{
      const img=new Image();img.src='/assets/alley-wide.jpg';await img.decode();
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
      const draw=()=>canvas.getContext('2d').drawImage(img,0,0,640,360);
      draw();const stream=canvas.captureStream(15);
      const timer=setInterval(()=>stream.active?draw():clearInterval(timer),66);return stream;
    };
    // Hold only imported video startup, as with a slow codec or interrupted file picker.
    const play=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(){
      if(this.src.startsWith('blob:'))return new Promise((resolve,reject)=>{window.pendingMovie={resolve,reject};});
      return play.call(this);
    };
  });
  await p.goto('http://127.0.0.1:'+server.address().port+'/index.html');
  async function choose(){
    await p.locator('#cards .card').first().click();
    await p.waitForFunction(()=>document.body.dataset.phase==='live'&&!document.querySelector('#settings').disabled);
  }
  async function importMovie(){
    await p.click('#settings');await p.click('[data-tab="5"]');
    await p.locator('#movie').setInputFiles({name:'slow.mp4',mimeType:'video/mp4',buffer:Buffer.from('delayed by test')});
    await p.waitForFunction(()=>!!window.pendingMovie);
  }
  await choose();await importMovie();
  await p.evaluate(()=>pauseCapture());
  await p.click('#closeSettings');
  await p.waitForFunction(()=>document.body.dataset.phase==='select'&&document.querySelector('#video').srcObject?.active);
  await p.evaluate(()=>{pendingMovie.reject(new DOMException('Playback was interrupted','AbortError'));window.pendingMovie=null;});
  await nextDraw(p);
  assert.equal(await p.evaluate(()=>document.body.dataset.phase),'select','cancelled movie error must not replace the new camera screen');
  assert.equal(await p.evaluate(()=>document.querySelector('#video').srcObject?.active),true,'cancelled movie must not stop the new camera stream');
  console.log('PASS late video rejection leaves the new camera running.');
  await choose();await importMovie();
  await p.evaluate(()=>pauseCapture());
  await p.evaluate(()=>{pendingMovie.resolve();window.pendingMovie=null;});
  await nextDraw(p);
  assert.equal(await p.evaluate(()=>document.body.dataset.phase),'chosen','late video success must not revive playback after pause');
  assert.equal(await p.evaluate(()=>document.querySelector('#video').srcObject),null);
  console.log('PASS late video completion cannot restart a paused session.');
  await p.evaluate(()=>{
    window.acquireCamera=navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};
  });
  await p.click('#start');
  await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('相机权限未开启'));
  assert.equal(await p.evaluate(()=>document.body.dataset.phase),'chosen','current camera errors still leave a usable retry screen');
  assert.equal(await p.locator('#start').isEnabled(),true);
  await p.evaluate(()=>{navigator.mediaDevices.getUserMedia=window.acquireCamera;});
  await p.click('#start');
  await p.waitForFunction(()=>document.body.dataset.phase==='live'&&!document.querySelector('#timer').disabled);
  await p.click('#timer');
  await p.waitForFunction(()=>document.body.dataset.phase==='result',null,{timeout:15000});
  await p.click('#save');assert.equal(await p.textContent('#save'),'照片已保存');
  assert.deepEqual(errors,[]);
  console.log('PASS recovery: camera restart, three-second capture and save still work.');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
