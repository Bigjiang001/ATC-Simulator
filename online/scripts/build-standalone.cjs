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

const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_HTML_PATH = path.resolve(ROOT_DIR, 'index.html');
const DIST_HTML_PATH = path.resolve(ROOT_DIR, 'dist/index.html');

const MODULE_FILES = [
  { id: 'atc/voiceGuidance', file: 'src/atc/voiceGuidance.ts' },
  { id: 'components/VoiceAssistPanel', file: 'src/components/VoiceAssistPanel.tsx' },
  { id: 'components/MissionPanel', file: 'src/components/MissionPanel.tsx' },
  { id: 'game/missions', file: 'src/game/missions.ts' },
  { id: 'atc/radiotelephony', file: 'src/atc/radiotelephony.ts' },
  { id: 'i18n/en', file: 'src/i18n/en.ts' },
  { id: 'i18n/language', file: 'src/i18n/language.ts' },
  { id: 'i18n/react', file: 'src/i18n/react.ts' },
  { id: 'aircraft/types', file: 'src/aircraft/types.ts' },
  { id: 'airport/harborAirport', file: 'src/airport/harborAirport.ts' },
  { id: 'aircraft/physics', file: 'src/aircraft/physics.ts' },
  { id: 'atc/commands', file: 'src/atc/commands.ts' },
  { id: 'atc/voiceRecognizer', file: 'src/atc/voiceRecognizer.ts' },
  { id: 'safety/conflictDetector', file: 'src/safety/conflictDetector.ts' },
  { id: 'traffic/spawner', file: 'src/traffic/spawner.ts' },
  { id: 'simulation/engine', file: 'src/simulation/engine.ts' },
  { id: 'audio/voiceCatalog', file: 'src/audio/voiceCatalog.ts' },
  { id: 'audio/soundEngine', file: 'src/audio/soundEngine.ts' },
  { id: 'radar/renderer', file: 'src/radar/renderer.ts' },
  { id: 'game/store', file: 'src/game/store.ts' },
  { id: 'components/TopStatusBar', file: 'src/components/TopStatusBar.tsx' },
  { id: 'components/RadarScopeCanvas', file: 'src/components/RadarScopeCanvas.tsx' },
  { id: 'components/FlightStripBay', file: 'src/components/FlightStripBay.tsx' },
  { id: 'components/CommandPanel', file: 'src/components/CommandPanel.tsx' },
  { id: 'components/RadioCommLog', file: 'src/components/RadioCommLog.tsx' },
  { id: 'components/GameModals', file: 'src/components/GameModals.tsx' },
  { id: 'app/App', file: 'src/app/App.tsx' },
];

function normalizeImportPath(fromModuleId, importSpec) {
  if (importSpec === 'react') return 'react';
  if (importSpec === 'react-dom/client') return 'react-dom/client';
  const fromDir = path.posix.dirname(fromModuleId);
  const resolved = path.posix.normalize(path.posix.join(fromDir, importSpec));
  return resolved.replace(/\.(ts|tsx)$/, '');
}

const compiledModules = [];

for (const mod of MODULE_FILES) {
  const fullPath = path.join(ROOT_DIR, mod.file);
  const rawCode = fs.readFileSync(fullPath, 'utf8');

  const transformed = babel.transformSync(rawCode, {
    filename: mod.file,
    presets: [
      [resolveBabelModule('@babel/preset-env'), { modules: 'commonjs', targets: { chrome: '100' } }],
      [
        resolveBabelModule('@babel/preset-react'),
        { runtime: 'classic', pragma: 'React.createElement', pragmaFrag: 'React.Fragment' },
      ],
      [resolveBabelModule('@babel/preset-typescript'), { isTSX: mod.file.endsWith('.tsx'), allExtensions: true }],
    ],
  });

  const rewrittenCode = transformed.code.replace(
    /require\(["']([^"']+)["']\)/g,
    (match, spec) => {
      const norm = normalizeImportPath(mod.id, spec);
      return `require(${JSON.stringify(norm)})`;
    }
  );

  compiledModules.push({
    id: mod.id,
    code: rewrittenCode,
  });
}

const indexCssPath = path.join(ROOT_DIR, 'src/styles/index.css');
const atcCssPath = path.join(ROOT_DIR, 'src/styles/atc.css');
const cssContent = fs.readFileSync(indexCssPath, 'utf8');
fs.writeFileSync(atcCssPath, cssContent, 'utf8');

const REACT_RUNTIME_JS = `
(function() {
  const Fragment = Symbol.for('react.fragment');

  function flattenChildren(children, out) {
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (Array.isArray(c)) {
        flattenChildren(c, out);
      } else if (c === null || c === undefined || c === false || c === true) {
        out.push({ type: '#empty', props: {}, children: [] });
      } else if (typeof c === 'string' || typeof c === 'number') {
        out.push({ type: '#text', props: { nodeValue: String(c) }, children: [] });
      } else {
        out.push(c);
      }
    }
    return out;
  }

  function createElement(type, props, ...rawChildren) {
    const cleanProps = Object.assign({}, props || {});
    const key = cleanProps.key != null ? String(cleanProps.key) : null;
    delete cleanProps.key;
    const children = flattenChildren(rawChildren, []);
    cleanProps.children = children;
    return { type, props: cleanProps, children, key };
  }

  let currentInstance = null;
  let currentHookIndex = 0;
  let pendingEffects = [];
  let renderScheduled = false;
  let rootReconcileFn = null;

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    Promise.resolve().then(() => {
      renderScheduled = false;
      if (rootReconcileFn) rootReconcileFn();
    });
  }

  function useState(initialVal) {
    const inst = currentInstance;
    const idx = currentHookIndex++;
    if (inst.hooks.length <= idx) {
      const init = typeof initialVal === 'function' ? initialVal() : initialVal;
      inst.hooks.push({ type: 'state', value: init });
    }
    const hook = inst.hooks[idx];
    const setState = (updater) => {
      const nextVal = typeof updater === 'function' ? updater(hook.value) : updater;
      if (!Object.is(nextVal, hook.value)) {
        hook.value = nextVal;
        scheduleRender();
      }
    };
    return [hook.value, setState];
  }

  function useRef(initialVal) {
    const inst = currentInstance;
    const idx = currentHookIndex++;
    if (inst.hooks.length <= idx) {
      inst.hooks.push({ type: 'ref', current: initialVal });
    }
    return inst.hooks[idx];
  }

  function useEffect(effectFn, deps) {
    const inst = currentInstance;
    const idx = currentHookIndex++;
    const prevHook = inst.hooks[idx];
    let hasChanged = true;
    if (prevHook && deps && prevHook.deps) {
      hasChanged =
        deps.length !== prevHook.deps.length ||
        deps.some((d, i) => !Object.is(d, prevHook.deps[i]));
    }
    if (!prevHook) {
      const hook = { type: 'effect', deps, cleanup: null, effectFn };
      inst.hooks.push(hook);
      pendingEffects.push(hook);
    } else if (hasChanged) {
      prevHook.deps = deps;
      prevHook.effectFn = effectFn;
      pendingEffects.push(prevHook);
    }
  }

  function useMemo(factory, deps) {
    const inst = currentInstance;
    const idx = currentHookIndex++;
    const prevHook = inst.hooks[idx];
    if (prevHook && deps && prevHook.deps) {
      const same =
        deps.length === prevHook.deps.length &&
        deps.every((d, i) => Object.is(d, prevHook.deps[i]));
      if (same) return prevHook.value;
    }
    const val = factory();
    inst.hooks[idx] = { type: 'memo', value: val, deps };
    return val;
  }

  function useCallback(cb, deps) {
    return useMemo(() => cb, deps);
  }

  function flushEffects() {
    const list = pendingEffects.slice();
    pendingEffects = [];
    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      if (typeof h.cleanup === 'function') {
        try { h.cleanup(); } catch (e) {}
      }
      const res = h.effectFn();
      h.cleanup = typeof res === 'function' ? res : null;
    }
  }

  function unmountTree(vnode) {
    if (!vnode) return;
    if (vnode._instance) {
      for (const h of vnode._instance.hooks) {
        if (h && h.type === 'effect' && typeof h.cleanup === 'function') {
          try { h.cleanup(); } catch (e) {}
        }
      }
      if (vnode._rendered) unmountTree(vnode._rendered);
      return;
    }
    if (vnode.children) {
      for (const c of vnode.children) unmountTree(c);
    }
  }

  function updateDomProps(dom, oldProps, newProps) {
    if (!dom._handlers) dom._handlers = {};
    if (!dom._handlersBound) dom._handlersBound = {};

    for (const k of Object.keys(oldProps)) {
      if (k === 'children' || k === 'ref') continue;
      if (!(k in newProps)) {
        if (k.startsWith('on')) {
          const ev = k.slice(2).toLowerCase();
          const mappedEv = (dom.tagName === 'INPUT' && ev === 'change') ? 'input' : ev;
          dom._handlers[mappedEv] = null;
        } else if (k === 'className') {
          dom.className = '';
        } else if (k === 'style') {
          dom.removeAttribute('style');
        } else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'role' || k === 'title' || k === 'placeholder' || k === 'type') {
          dom.removeAttribute(k);
        } else {
          try { dom[k] = ''; } catch (e) {}
        }
      }
    }

    for (const k of Object.keys(newProps)) {
      if (k === 'children') continue;
      const val = newProps[k];
      if (k === 'ref') {
        if (val && typeof val === 'object') val.current = dom;
        else if (typeof val === 'function') val(dom);
        continue;
      }
      if (oldProps[k] === val && k !== 'value' && k !== 'checked') continue;

      if (k.startsWith('on') && typeof val === 'function') {
        const ev = k === 'onDoubleClick' ? 'dblclick' : k.slice(2).toLowerCase();
        const mappedEv = (dom.tagName === 'INPUT' && ev === 'change') ? 'input' : ev;
        dom._handlers[mappedEv] = val;
        if (!dom._handlersBound[mappedEv]) {
          dom._handlersBound[mappedEv] = true;
          dom.addEventListener(mappedEv, function(e) {
            const fn = dom._handlers[mappedEv];
            if (typeof fn === 'function') fn(e);
          });
        }
      } else if (k === 'className') {
        dom.className = val || '';
      } else if (k === 'style' && val && typeof val === 'object') {
        Object.assign(dom.style, val);
      } else if (k === 'disabled') {
        dom.disabled = Boolean(val);
      } else if (k === 'value') {
        if (dom.value !== String(val ?? '')) {
          dom.value = String(val ?? '');
        }
      } else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'role' || k === 'title' || k === 'placeholder' || k === 'type' || k === 'min' || k === 'max' || k === 'step') {
        dom.setAttribute(k, String(val));
      } else {
        try { dom[k] = val; } catch (e) { dom.setAttribute(k, String(val)); }
      }
    }
  }

  function getFirstDom(vnode) {
    if (!vnode) return null;
    if (vnode._dom) return vnode._dom;
    if (vnode._rendered) return getFirstDom(vnode._rendered);
    if (vnode.children && vnode.children.length > 0) return getFirstDom(vnode.children[0]);
    return null;
  }

  function removeVNodeDom(parentDom, vnode) {
    if (!vnode) return;
    unmountTree(vnode);
    removeDomOnly(parentDom, vnode);
  }

  function removeDomOnly(parentDom, vnode) {
    if (!vnode) return;
    if (vnode._dom) {
      if (vnode._dom.parentNode === parentDom) {
        parentDom.removeChild(vnode._dom);
      }
      return;
    }
    if (vnode._rendered) {
      removeDomOnly(parentDom, vnode._rendered);
      return;
    }
    if (vnode.children) {
      for (const c of vnode.children) removeDomOnly(parentDom, c);
    }
  }

  function patch(parentDom, oldVNode, newVNode, anchorDom = null) {
    if (!newVNode) {
      if (oldVNode) removeVNodeDom(parentDom, oldVNode);
      return null;
    }

    if (oldVNode && (oldVNode.type !== newVNode.type || oldVNode.key !== newVNode.key)) {
      const refAnchor = getFirstDom(oldVNode);
      patch(parentDom, null, newVNode, refAnchor);
      removeVNodeDom(parentDom, oldVNode);
      return newVNode;
    }

    if (newVNode.type === Fragment) {
      const container = (oldVNode && oldVNode._dom) || document.createElement('div');
      container.style.display = 'contents';
      newVNode._dom = container;
      if (!oldVNode) {
        parentDom.insertBefore(container, anchorDom);
      }
      reconcileChildren(container, oldVNode ? oldVNode.children : [], newVNode.children);
      return newVNode;
    }

    if (typeof newVNode.type === 'function') {
      const inst = (oldVNode && oldVNode._instance) || { hooks: [] };
      newVNode._instance = inst;
      const prevInst = currentInstance;
      const prevIdx = currentHookIndex;
      currentInstance = inst;
      currentHookIndex = 0;

      const rendered = newVNode.type(newVNode.props);

      currentInstance = prevInst;
      currentHookIndex = prevIdx;

      const normalizedRendered =
        rendered === null || rendered === undefined || rendered === false
          ? { type: '#empty', props: {}, children: [] }
          : rendered;

      newVNode._rendered = patch(
        parentDom,
        oldVNode ? oldVNode._rendered : null,
        normalizedRendered,
        anchorDom
      );
      return newVNode;
    }

    if (newVNode.type === '#empty') {
      const dom = (oldVNode && oldVNode._dom) || document.createComment('empty');
      newVNode._dom = dom;
      if (!oldVNode) {
        parentDom.insertBefore(dom, anchorDom);
      }
      return newVNode;
    }

    if (newVNode.type === '#text') {
      if (oldVNode && oldVNode._dom) {
        const dom = oldVNode._dom;
        if (dom.nodeValue !== newVNode.props.nodeValue) {
          dom.nodeValue = newVNode.props.nodeValue;
        }
        newVNode._dom = dom;
      } else {
        const dom = document.createTextNode(newVNode.props.nodeValue);
        newVNode._dom = dom;
        parentDom.insertBefore(dom, anchorDom);
      }
      return newVNode;
    }

    let dom = oldVNode ? oldVNode._dom : null;
    if (!dom) {
      dom = document.createElement(newVNode.type);
      updateDomProps(dom, {}, newVNode.props);
      reconcileChildren(dom, [], newVNode.children);
      parentDom.insertBefore(dom, anchorDom);
    } else {
      updateDomProps(dom, oldVNode.props, newVNode.props);
      reconcileChildren(dom, oldVNode.children, newVNode.children);
    }
    // Voice options change with language and asynchronous browser voice loading.
    // Reapply controlled selection after the option children have been reconciled.
    if (dom.tagName === 'SELECT' && 'value' in newVNode.props) {
      dom.value = String(newVNode.props.value ?? '');
    }
    newVNode._dom = dom;
    return newVNode;
  }

  function reconcileChildren(parentDom, oldChildren, newChildren) {
    const maxLen = Math.max(oldChildren.length, newChildren.length);
    for (let i = 0; i < maxLen; i++) {
      const oldChild = oldChildren[i] || null;
      const newChild = newChildren[i] || null;
      if (newChild) {
        newChildren[i] = patch(parentDom, oldChild, newChild, null);
      } else if (oldChild) {
        removeVNodeDom(parentDom, oldChild);
      }
    }
  }

  const React = {
    Fragment,
    StrictMode: Fragment,
    createElement,
    isValidElement: (node) => Boolean(node && typeof node === 'object' && node.type && node.props),
    cloneElement: (element, props, ...children) => createElement(
      element.type,
      Object.assign({}, element.props, props, { key: element.key }),
      ...(children.length ? children : element.children || [])
    ),
    useState,
    useEffect,
    useRef,
    useMemo,
    useCallback,
  };

  const ReactDOMClient = {
    createRoot(container) {
      let currentTree = null;
      return {
        render(vnode) {
          rootReconcileFn = () => {
            currentTree = patch(container, currentTree, vnode, null);
            flushEffects();
          };
          rootReconcileFn();
        },
      };
    },
  };

  window.__MINI_REACT__ = React;
  window.__MINI_REACT_DOM__ = ReactDOMClient;
})();
`;

const moduleRegistrations = compiledModules
  .map(
    (m) => `
  modules[${JSON.stringify(m.id)}] = function(module, exports, require) {
    const React = window.__MINI_REACT__;
    ${m.code}
  };`
  )
  .join('\n');

const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ATC2.0 在线版｜空中交通管制模拟游戏 (Harbor / Haneda / Pudong / Heathrow)</title>
  <style>
${cssContent}
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
${REACT_RUNTIME_JS}

(function() {
  const modules = {};
  const cache = {};

  modules["react"] = function(module) {
    module.exports = window.__MINI_REACT__;
    module.exports.default = window.__MINI_REACT__;
  };
  modules["react-dom/client"] = function(module) {
    module.exports = window.__MINI_REACT_DOM__;
    module.exports.default = window.__MINI_REACT_DOM__;
  };

${moduleRegistrations}

  function require(id) {
    if (cache[id]) return cache[id].exports;
    const factory = modules[id];
    if (!factory) {
      throw new Error("Module not found: " + id);
    }
    const module = { exports: {} };
    cache[id] = module;
    factory(module, module.exports, require);
    return module.exports;
  }

  function bootAtcApp() {
    const rootEl = document.getElementById("root");
    if (!rootEl || rootEl.getAttribute("data-mounted") === "true") return;
    rootEl.setAttribute("data-mounted", "true");
    try {
      const React = require("react");
      const ReactDOM = require("react-dom/client");
      const { App } = require("app/App");
      ReactDOM.createRoot(rootEl).render(React.createElement(App, null));
    } catch (err) {
      console.error("ATC Boot Error:", err);
      rootEl.innerHTML = '<div style="padding:24px;color:#fca5a5;font-family:monospace;">启动异常: ' + String(err && err.message || err) + '</div>';
    }
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", bootAtcApp);
  } else {
    bootAtcApp();
  }
})();
  </script>
</body>
</html>`;

const ROOT_SIM_HTML_PATH = path.resolve(ROOT_DIR, 'index.html');
fs.mkdirSync(path.dirname(DIST_HTML_PATH), { recursive: true });
fs.writeFileSync(ROOT_SIM_HTML_PATH, fullHtml, 'utf8');
fs.writeFileSync(DIST_HTML_PATH, fullHtml, 'utf8');
fs.writeFileSync(path.resolve(ROOT_DIR, 'dist/.nojekyll'), '', 'utf8');


console.log(`✅ Standalone playable game built successfully:`);
console.log(`   - Deliverable: ${OUTPUT_HTML_PATH} (${(fullHtml.length / 1024).toFixed(1)} KB)`);
console.log(`   - Dist copy:   ${DIST_HTML_PATH}`);
