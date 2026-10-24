const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {inject}=require('./analytics-build.cjs');
const root=path.resolve(__dirname,'..');
execFileSync(process.execPath,[path.join(root,'online/scripts/build-standalone.cjs')],{stdio:'inherit'});
const output=path.join(root,'dist');fs.rmSync(output,{recursive:true,force:true});fs.cpSync(path.join(root,'website'),output,{recursive:true});
for(const [file,kind] of [['index.html','home'],['admin/index.html','admin']]){
 const target=path.join(output,file);fs.writeFileSync(target,inject(fs.readFileSync(target,'utf8'),kind));
}
fs.mkdirSync(path.join(output,'game'),{recursive:true});
fs.cpSync(path.join(root,'online/voices'),path.join(output,'game/voices'),{recursive:true});
fs.copyFileSync(path.join(root,'online/index.html'),path.join(output,'game/index.html'));
const redirect='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=./game/"><title>ATC2.0</title><a href="./game/">进入 ATC2.0 游戏</a></html>';
for(const name of ['game.html','game-page.html'])fs.writeFileSync(path.join(output,name),redirect);
fs.writeFileSync(path.join(output,'.nojekyll'),'');
console.log('ATC2.0 website and browser game ready in dist/');
