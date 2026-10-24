# eSpeak NG bundled voice engine

This separate worker engine is GPL-3.0 software from @echogarden/espeak-ng-emscripten 0.3.5.

Upstream package: https://www.npmjs.com/package/@echogarden/espeak-ng-emscripten/v/0.3.5
Package integrity: sha512-Izbkm7NWccwb//RKgOp1/0k21StKN1DFIn+K7GU1XN7n6pmSi4bsk/0tYUsgQbysC4GVyrVompNmLInU/BFE+A==
Emscripten distribution source and build instructions (package gitHead ea36b43595facf07f1c5dc487b9f0de3340c1b5e):
https://github.com/echogarden-project/espeak-ng-emscripten/tree/ea36b43595facf07f1c5dc487b9f0de3340c1b5e
Underlying eSpeak NG source/build scripts: https://github.com/echogarden-project/espeak-ng/tree/fork
License: COPYING in this directory.

The JavaScript/asm.js engine runs in a separate Web Worker. We retained only Mandarin and English dictionaries, the shared phoneme data, and the three upstream male voice variants m1, m2 and m3. These are formant synthesis voices, with an electronic timbre, not recordings or neural voices. No female recording is pitch-shifted.

The only distribution modification is the data-file manifest and corresponding data subset. The complete reproducible transformation is scripts/prepare-builtin-voices.cjs in this repository. No C/C++ synthesis logic was changed. To reproduce, download and extract the exact npm tarball above, then run the script with the extracted package directory.
