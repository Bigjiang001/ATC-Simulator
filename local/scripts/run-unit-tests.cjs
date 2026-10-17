const fs = require('fs');
const path = require('path');

function resolveBabelModule(pkgName) {
  try {
    return require.resolve(pkgName);
  } catch (e) {
    return '/usr/share/nodejs/' + pkgName;
  }
}
const babel = require(resolveBabelModule('@babel/core'));

require.extensions['.ts'] = function (module, filename) {
  const content = fs.readFileSync(filename, 'utf8');
  const compiled = babel.transformSync(content, {
    filename,
    presets: [
      [resolveBabelModule('@babel/preset-env'), { targets: { node: 'current' } }],
      resolveBabelModule('@babel/preset-typescript'),
    ],
  });
  module._compile(compiled.code, filename);
};

const { runAllSimulationTests } = require('../src/tests/simulation.test.ts');

console.log('==============================================================');
console.log(' ATC2.0 - 航空物理引擎与空管核心逻辑回归测试');
console.log('==============================================================');

const results = runAllSimulationTests();
let failed = 0;

for (const r of results) {
  if (r.passed) {
    console.log(`✅ [PASS] ${r.name}`);
    console.log(`   └─ ${r.detail}`);
  } else {
    failed++;
    console.error(`❌ [FAIL] ${r.name}`);
    console.error(`   └─ ${r.detail}`);
  }
}

console.log('--------------------------------------------------------------');
console.log(`测试汇总: ${results.length - failed} / ${results.length} 通过`);
console.log('==============================================================');

if (failed > 0) {
  process.exit(1);
}
