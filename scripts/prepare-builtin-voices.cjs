// Reproduce the bundled English/Mandarin subset from the published upstream package.
// Download/extract @echogarden/espeak-ng-emscripten@0.3.5, then pass its directory.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const input = process.argv[2];
if (!input) throw Error('Pass the extracted @echogarden/espeak-ng-emscripten@0.3.5 package directory');
let js = fs.readFileSync(path.join(input, 'espeak-ng.js'), 'utf8');
const start = js.indexOf('loadPackage({') + 'loadPackage('.length;
const end = js.indexOf(')', js.indexOf('remote_package_size:', start));
const meta = vm.runInNewContext('(' + js.slice(start, end) + ')');
const data = fs.readFileSync(path.join(input, 'espeak-ng.data'));
const keep = meta.files.filter(f => /\/(cmn_dict|en_dict|intonations|phondata|phonindex|phontab)$/.test(f.filename)
  || /\/lang\/(sit\/cmn[^/]*|gmw\/en[^/]*)$/.test(f.filename) || /\/voices\/!v\/m[123]$/.test(f.filename));
let offset = 0;
const pieces = keep.map(f => { const bytes = data.subarray(f.start, f.end); f.start = offset; offset += bytes.length; f.end = offset; return bytes; });
js = js.slice(0, start) + JSON.stringify({ files: keep, remote_package_size: offset }) + js.slice(end);
const out = path.join(__dirname, '../online/voices/vendor'); fs.mkdirSync(out, {recursive:true});
fs.writeFileSync(path.join(out, 'espeak-ng.js'), js);
fs.writeFileSync(path.join(out, 'espeak-ng.data'), Buffer.concat(pieces));
fs.copyFileSync(path.join(input, 'COPYING'), path.join(out, 'COPYING'));
console.log(`${keep.length} files, ${offset} data bytes; JS engine plus English/Mandarin and male1/male2/male3`);
