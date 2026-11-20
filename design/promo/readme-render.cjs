const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawn,execFileSync}=require('node:child_process'),{once}=require('node:events');
const {chromium,launchOptions}=require('../../tests/browser.cjs');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'outputs/readme'),assets=path.join(root,'docs/images');
const data=JSON.parse(fs.readFileSync(path.join(out,'storyboards.json'),'utf8'));
const ffmpeg=execFileSync('python',['-c',"import sys;sys.path.insert(0,'.tools/video-lib');import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"],{cwd:root,encoding:'utf8'}).trim();
const server=http.createServer((req,res)=>{const file=path.join(out,path.basename(req.url));if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type','image/png');fs.createReadStream(file).pipe(res);});
let browser;
async function main(){
  await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch(launchOptions);const page=await browser.newPage();
  await page.setContent('<style>html,body{margin:0;background:#241e24}canvas{display:block}</style><canvas></canvas>');
  for(const story of data.stories){
    const images=await page.evaluate(async({story,base})=>{
      window.storyImages=[];for(const f of story.frames){const im=new Image();im.src=base+'/'+f.file;await im.decode();window.storyImages.push(im);}
      return {width:storyImages[0].width,height:storyImages[0].height};
    },{story,base:'http://127.0.0.1:'+server.address().port});
    const w=story.width,header=w>600?80:86,footer=w>600?38:30,h=Math.round(images.height/images.width*w)+header+footer;
    await page.setViewportSize({width:w,height:h});
    const target=path.join(assets,story.name+'.gif');
    const encoder=spawn(ffmpeg,['-y','-hide_banner','-loglevel','error','-f','image2pipe','-framerate',String(story.fps),'-vcodec','png','-i','pipe:0','-filter_complex','split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle','-loop','0',target],{windowsHide:true,stdio:['pipe','ignore','pipe']});
    const errors=[];encoder.stderr.on('data',d=>errors.push(d.toString()));encoder.stdin.on('error',()=>{});const done=once(encoder,'close');
    for(const[i,frame]of story.frames.entries()){
      await page.evaluate(({i,frame,w,h,header,footer,scale})=>{
        const c=document.querySelector('canvas');c.width=w;c.height=h;const g=c.getContext('2d'),im=storyImages[i];
        g.fillStyle='#241e24';g.fillRect(0,0,w,h);g.fillStyle='#ffafc4';g.font=`700 ${w>600?30:24}px "Microsoft YaHei"`;g.textBaseline='middle';g.fillText(frame.caption,22,header/2,w-44);
        g.drawImage(im,0,header,w,h-header-footer);
        if(frame.pointer){const ratio=w/im.width*scale;g.beginPath();g.arc(frame.pointer.x*ratio,header+frame.pointer.y*ratio,frame.pointer.radius*ratio,0,Math.PI*2);g.strokeStyle='#ff91b3';g.lineWidth=4;g.stroke();g.fillStyle='#ff91b333';g.fill();}
        g.fillStyle='#c1afb5';g.font=`${w>600?18:14}px "Microsoft YaHei"`;g.fillText('功能演示 · 生成式样片输入 · GIF 无声',16,h-footer/2,w-32);
      },{i,frame,w,h,header,footer,scale:data.deviceScaleFactor});
      const png=await page.screenshot();if(i===Math.floor(story.frames.length/2))fs.writeFileSync(path.join(out,story.name+'-review.png'),png);
      if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');
    }
    encoder.stdin.end();const[code]=await done;if(code)throw Error(errors.join(''));
    console.log(story.name,story.frames.length+' frames',w+'x'+h,fs.statSync(target).size+' bytes');
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
