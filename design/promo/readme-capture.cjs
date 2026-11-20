// Record real app interactions against generated reference-photo camera input.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium,launchOptions}=require('../../tests/browser.cjs');
const root=path.resolve(__dirname,'../..'),web=path.join(root,'web'),out=path.join(root,'outputs/readme'),assets=path.join(root,'docs/images');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(assets,{recursive:true});
const mime={html:'text/html',mjs:'text/javascript',js:'text/javascript',wasm:'application/wasm',json:'application/json',jpg:'image/jpeg',png:'image/png',webp:'image/webp',css:'text/css',ttf:'font/ttf',wav:'audio/wav'};
const server=http.createServer((req,res)=>{
  const file=path.resolve(web,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(web+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',mime[path.extname(file).slice(1)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
let browser,page,index=0,story,clip=null;const stories=[];
async function hold(seconds,caption,pointer=null){
  const start=Date.now(),count=Math.ceil(seconds*6);
  for(let i=0;i<count;i++){
    const file=String(index++).padStart(4,'0')+'.png';
    await page.screenshot({path:path.join(out,file),...(clip?{clip}:{})});
    story.frames.push({file,caption,pointer:pointer?{x:pointer.x-(clip?.x||0),y:pointer.y-(clip?.y||0),radius:18+i*2}:null});
    const wait=start+(i+1)*1000/6-Date.now();if(wait>0)await page.waitForTimeout(wait);
  }
}
async function tap(selector,caption){
  const r=await page.locator(selector).boundingBox();if(!r)throw Error('Missing target '+selector);
  await hold(.5,caption,{x:r.x+r.width/2,y:r.y+r.height/2});await page.click(selector);
}
function begin(name,width=468){story={name,width,fps:6,clip,frames:[]};stories.push(story);}
async function ready(){await page.waitForFunction(()=>!document.querySelector('#nextBatch').disabled);}
async function main(){
  await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch(launchOptions);
  page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1.2,hasTouch:true});page.setDefaultTimeout(60000);
  page.on('pageerror',e=>console.error('App:',e.message));
  await page.addInitScript(()=>{
    for(const[k,v]of Object.entries({'pose-voice':'on','solo-voice':'off','floating-guide':'off','scene-vlm-auto':'off','scene-adapt':'off','ink-strength':'100','reference-style':'duet'}))localStorage.setItem(k,v);
    window.demoScene='alley';window.demoSaved=0;window.demoCues=[];
    window.Phone={speak(t){demoCues.push(t);return true;},quiet(){},alignedPulse(){},requiresShutterSound(){return false;},saveJpeg(){demoSaved++;return true;}};
    navigator.mediaDevices.getUserMedia=async()=>{
      const images={};for(const[k,url]of Object.entries({alley:'/assets/alley-wide.jpg',cheeks:'/assets/cheeks.jpg'})){const im=new Image();im.src=url;await im.decode();images[k]=im;}
      const c=document.createElement('canvas');c.width=960;c.height=1280;const g=c.getContext('2d');
      function draw(){const im=images[window.demoScene],s=Math.max(c.width/im.width,c.height/im.height);g.save();g.translate(c.width,0);g.scale(-1,1);g.drawImage(im,(c.width-im.width*s)/2,(c.height-im.height*s)/2,im.width*s,im.height*s);g.restore();}
      draw();const stream=c.captureStream(15),timer=setInterval(()=>stream.active?draw():clearInterval(timer),66);return stream;
    };
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.locator('#cards .card').first().waitFor();await ready();

  clip=await page.locator('#select').boundingBox();begin('intimate-first',780);
  await hold(1.1,'想亲密一点？打开「色色优先」');
  await tap('.intimate-pref','点一下开关，优先推荐亲密姿势');await ready();
  await hold(2.0,'开启后，推荐顺序会更新');
  await tap('.intimate-pref','再点一次，即可关闭');await ready();await hold(.8,'偏好保存在这台手机');clip=null;

  begin('choose-pose');await hold(.8,'① 打开情侣模板');
  await tap('#browse','进入模板库，挑一个动作');await hold(.7,'也可以按动作搜索');
  await page.fill('#search','贴脸看镜头');await hold(1.0,'搜索「贴脸看镜头」');
  await page.locator('#allCards [data-pose="cheeks"]').waitFor();
  await page.evaluate(()=>{window.demoScene='cheeks';const a=document.querySelector('#auto');a.checked=false;a.dispatchEvent(new Event('change'));});
  await tap('#allCards [data-pose="cheeks"]','点选「贴脸看镜头」');
  await page.waitForFunction(()=>document.body.dataset.phase==='live'&&!document.querySelector('#shutter').disabled);
  await hold(1.6,'选好姿势，跟着参考线入位');

  await page.click('#settings');await page.click('[data-tab="1"]');
  await page.locator('#poseOptions').screenshot({path:path.join(assets,'reference-panel.png')});await page.click('#closeSettings');
  await page.click('#finderSound');await page.locator('#soundPanel').screenshot({path:path.join(assets,'sound-panel.png')});await page.click('#closeSound');
  await page.click('#guideBeauty');await page.locator('#beautyPanel').screenshot({path:path.join(assets,'beauty-panel.png')});await page.click('#closeBeauty');

  begin('shoot-save');await hold(1.8,'② 沿着参考线靠近，听语音提示');
  await tap('#timer','留出摆姿势的时间：点「3 秒」');await hold(3.3,'倒计时后拍照，也可直接按快门');
  await page.waitForFunction(()=>document.body.dataset.phase==='result'&&!document.querySelector('#save').disabled);
  await hold(1.1,'③ 拍好后，选择「保存照片」');await tap('#save','保存照片到手机相册');
  await page.waitForFunction(()=>window.demoSaved===1);await hold(1.4,'完成！还可以继续拍、换姿势');
  fs.writeFileSync(path.join(out,'storyboards.json'),JSON.stringify({deviceScaleFactor:1.2,viewport:{width:390,height:844},stories,cues:await page.evaluate(()=>demoCues)},null,2));
  console.log(JSON.stringify(stories.map(s=>({name:s.name,frames:s.frames.length,width:s.width})),null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
