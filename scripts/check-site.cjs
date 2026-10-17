const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'website/index.html'),'utf8');
for(const text of ['由 BIG JIANG STUDIO 设计开发','1.0 历史截图','电子检查单软件介绍','三个模型','GitHub'])assert(html.includes(text),text);
assert(!/pan\.baidu|assets\/ATC2\.0_.*\.zip/.test(html));
for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){
 const relative=match[1];if(/^(?:https?:|mailto:|#)/.test(relative))continue;
 assert(fs.existsSync(path.join(root,'website',relative)),relative);
}
assert.equal(fs.readFileSync(path.join(root,'website/game/index.html'),'utf8'),fs.readFileSync(path.join(root,'online/index.html'),'utf8'));
const audio=fs.readFileSync(path.join(root,'online/src/audio/soundEngine.ts'),'utf8');assert(!/fetch\s*\(|127\.0\.0\.1/.test(audio));
console.log('PASS: website links, approved browser game, no checklist/platform download links or model fetches');
