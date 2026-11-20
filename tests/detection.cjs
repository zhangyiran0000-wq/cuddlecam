const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium,launchOptions}=require('./browser.cjs');
const root=path.resolve('web'),label=process.argv[2]||'current';
const mime={html:'text/html',mjs:'text/javascript',js:'text/javascript',wasm:'application/wasm',json:'application/json',jpg:'image/jpeg'};
const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  if(name==='/probe.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body>Offline detector verification</body></html>');return;}
  const file=name==='/probe.mjs'?path.resolve(process.argv[3]||'tests/detector-probe.mjs'):path.resolve(root,'.'+name);
  if((name!=='/probe.mjs'&&!file.startsWith(root+path.sep))||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',mime[path.extname(file).slice(1)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
let browser;
async function run(){
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch(launchOptions);
  const page=await browser.newPage();page.on('pageerror',e=>console.error(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/probe.html');
  const start=Date.now();const result=await page.evaluate(async()=>{const {probe}=await import('/probe.mjs');return probe();});
  fs.mkdirSync('outputs/qa',{recursive:true});fs.writeFileSync('outputs/qa/detection-'+label+'.json',JSON.stringify(result,null,2));
  if(label.includes('inspect'))await page.screenshot({path:'outputs/qa/detection-'+label+'.png'});
  for(const lighting of result.results?['normal','dim','covered']:[]){
    const rows=result.results.filter(r=>r.lighting===lighting),counts=rows.flatMap(r=>r.counts);
    console.log(lighting,counts.filter(n=>n===2).length+'/'+counts.length,'returned two faces');
    console.log(rows.map(r=>r.id+':'+r.counts.join(',')).join(' '));
  }
  console.log(result.history?'Near/far '+JSON.stringify(result.history):JSON.stringify(result),'elapsed seconds',(Date.now()-start)/1000);
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
