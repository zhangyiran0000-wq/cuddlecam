const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
let playwright;
try{playwright=require('playwright');}
catch{playwright=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const executablePath=process.env.BROWSER_EXECUTABLE||(fs.existsSync(edge)?edge:undefined);
module.exports={chromium:playwright.chromium,launchOptions:{executablePath,args:['--mute-audio','--enable-unsafe-swiftshader']}};
