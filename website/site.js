'use strict';
(() => {
  document.documentElement.classList.add('js');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let motionPaused = reduceMotion.matches;
  const motionButton = document.querySelector('#motion-toggle');
  const legacyButton = document.querySelector('#legacy-toggle');
  let legacyPaused = reduceMotion.matches, legacyHover = false, legacyFocus = false;
  const syncMotion = () => {
    document.documentElement.classList.toggle('motion-paused', motionPaused);
    motionButton.setAttribute('aria-pressed', String(motionPaused));
    motionButton.setAttribute('aria-label', motionPaused ? '播放页面动效' : '暂停页面动效');
    motionButton.textContent = motionPaused ? '▶ 播放动效' : 'Ⅱ 暂停动效';
    legacyButton.setAttribute('aria-pressed', String(legacyPaused || motionPaused));
    legacyButton.textContent = legacyPaused || motionPaused ? '▶ 播放轮播' : 'Ⅱ 暂停轮播';
  };
  motionButton.addEventListener('click', () => { motionPaused = !motionPaused; syncMotion(); });
  legacyButton.addEventListener('click', () => {
    if (motionPaused) { motionPaused = false; legacyPaused = false; }
    else legacyPaused = !legacyPaused;
    syncMotion();
  });
  reduceMotion.addEventListener('change', event => { motionPaused = event.matches; legacyPaused = event.matches; syncMotion(); });
  syncMotion();

  const nav = document.querySelector('#site-nav');
  const navButton = document.querySelector('.nav-toggle');
  const setNav = open => { nav.classList.toggle('open', open); navButton.setAttribute('aria-expanded', String(open)); navButton.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单'); };
  navButton.addEventListener('click', () => setNav(!nav.classList.contains('open')));
  nav.addEventListener('click', e => { if (e.target.closest('a')) { setNav(false); } });
  document.addEventListener('click', e => { if (!document.querySelector('header').contains(e.target)) setNav(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (nav.classList.contains('open')) { setNav(false); navButton.focus(); } } });

  const revealObserver = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('visible'); revealObserver.unobserve(entry.target); }
  }), { threshold: .08 });
  document.querySelectorAll('.reveal').forEach(element => revealObserver.observe(element));

  const airports = [
    { id: 'ZSHB', title: '雷达与电子进程单，一眼掌握态势。', description: '在海湾机场熟悉雷达标牌、航向、高度与速度，从新手教学开始你的第一班执勤。', caption: '海湾机场 · 雷达与电子进程单' },
    { id: 'ZSPD', title: '从标准进场，到有序进近。', description: '在浦东机场使用 STAR、SID 和航路点导航，为进离港飞机安排航路、高度与速度。', caption: '上海浦东 · 标准进离场程序' },
    { id: 'RJTT', title: '跑道交叉，指挥更有章法。', description: '在羽田机场的交叉跑道布局中管理起降顺序，关注跑道占用与冲突保护。', caption: '东京羽田 · 交叉跑道布局' },
    { id: 'EGLL', title: '等待、排序，然后安全落地。', description: '在希思罗机场安排空中等待与进近顺序，兼顾尾流间隔、着陆和离场移交。', caption: '伦敦希思罗 · 等待与进近排序' },
  ];
  const tabs = [...document.querySelectorAll('.airport-tab')];
  const screen = document.querySelector('#main-screenshot');
  const screenButton = document.querySelector('#main-screenshot-button');
  let imageRevision = 0;
  const selectAirport = index => {
    const info = airports[index], revision = ++imageRevision;
    tabs.forEach((tab, i) => { tab.classList.toggle('active', i === index); tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1; });
    document.querySelector('#screen-panel').setAttribute('aria-labelledby', `tab-${info.id}`);
    document.querySelector('#screen-counter').textContent = `${String(index + 1).padStart(2, '0')} / 04`;
    document.querySelector('#screen-number').textContent = `${String(index + 1).padStart(2, '0')} — ${info.id}`;
    document.querySelector('#screen-title').textContent = info.title;
    document.querySelector('#screen-description').textContent = info.description;
    const source = `assets/v2/${info.id}.jpg`;
    screenButton.dataset.zoom = source; screenButton.dataset.caption = info.caption;
    const next = new Image();
    next.onload = () => { if (revision !== imageRevision) return; screen.src = source; screen.alt = `ATC2.0 ${info.caption}实际游戏截图`; };
    next.src = source;
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectAirport(index));
    tab.addEventListener('keydown', event => {
      let next = index;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault(); selectAirport(next); tabs[next].focus();
    });
  });

  const viewer = document.querySelector('#image-viewer');
  const closeViewer = () => viewer.close();
  let returnFocus = null;
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-zoom]');
    if (!trigger) return;
    returnFocus = trigger;
    const image = document.querySelector('#viewer-image'); image.src = trigger.dataset.zoom; image.alt = trigger.dataset.caption;
    document.querySelector('#viewer-caption').textContent = trigger.dataset.caption;
    viewer.showModal();
  });
  document.querySelector('#viewer-close').addEventListener('click', closeViewer);
  viewer.addEventListener('click', event => { if (event.target === viewer) { const rect = viewer.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeViewer(); } });
  viewer.addEventListener('close', () => returnFocus?.focus({ preventScroll: true }));

  const viewport = document.querySelector('#legacy-viewport');
  const track = document.querySelector('#legacy-track');
  const originalFrames = [...track.children];
  // Extra copies provide a continuous row on wide displays; keyboard users visit the original four only.
  for (let group = 0; group < 2; group++) originalFrames.forEach(frame => {
    const copy = frame.cloneNode(true); copy.setAttribute('aria-hidden', 'true'); copy.tabIndex = -1; track.append(copy);
  });
  viewport.addEventListener('mouseenter', () => { legacyHover = true; });
  viewport.addEventListener('mouseleave', () => { legacyHover = false; });
  viewport.addEventListener('focusin', () => { legacyFocus = true; });
  viewport.addEventListener('focusout', event => { legacyFocus = viewport.contains(event.relatedTarget); });
  ['pointerdown', 'wheel', 'keydown'].forEach(event => viewport.addEventListener(event, () => { legacyPaused = true; syncMotion(); }, { passive: true }));

  const canvas = document.querySelector('#radar');
  const ctx = canvas.getContext('2d', { alpha: false });
  let width = 0, height = 0, scale = 1, heroVisible = true, legacyVisible = false;
  let time = 0, lastDraw = 0, lastTime = 0, frameId = null;
  const resize = () => {
    const rect = canvas.getBoundingClientRect(); width = rect.width; height = rect.height;
    scale = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    ctx?.setTransform(scale, 0, 0, scale, 0, 0);
    lastDraw = 0;
    drawRadar(time);
  };
  new ResizeObserver(resize).observe(canvas);
  const visibilityObserver = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.target === canvas) heroVisible = entry.isIntersecting;
    if (entry.target === viewport) legacyVisible = entry.isIntersecting;
  }));
  visibilityObserver.observe(canvas); visibilityObserver.observe(viewport);

  const drawRadar = clock => {
    if (!ctx || !width || !height) return;
    ctx.fillStyle = '#020a0e'; ctx.fillRect(0, 0, width, height);
    const cx = width * .5, cy = height * .53, radius = Math.max(height * .61, width * .37);
    const spacing = radius / 7;
    ctx.lineWidth = .5; ctx.strokeStyle = '#17353650';
    for (let x = cx % spacing; x < width; x += spacing) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = cy % spacing; y < height; y += spacing) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    const glow = ctx.createRadialGradient(cx, cy, 30, cx, cy, radius * 1.2); glow.addColorStop(0, '#0b30272e'); glow.addColorStop(1, '#020a0e00'); ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
    for (let n = 1; n <= 6; n++) { const r = radius * n / 6; ctx.strokeStyle = n === 6 ? '#367b6c80' : '#26574e70'; ctx.lineWidth = n === 6 ? 1 : .7; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); ctx.font = '9px monospace'; ctx.fillStyle = '#4e8c786a'; ctx.fillText(`${n * 5} NM`, cx + 7, cy - r + 12); }
    for (let degree = 0; degree < 360; degree += 5) {
      const a = (degree - 90) * Math.PI / 180, major = degree % 30 === 0, length = major ? 13 : degree % 10 === 0 ? 8 : 4;
      const x = Math.cos(a), y = Math.sin(a); ctx.strokeStyle = major ? '#5aab8da0' : '#3c826d80'; ctx.lineWidth = .8;
      ctx.beginPath(); ctx.moveTo(cx + x * (radius - length), cy + y * (radius - length)); ctx.lineTo(cx + x * radius, cy + y * radius); ctx.stroke();
      if (major) { ctx.font = '10px monospace'; ctx.fillStyle = '#6ab39a'; ctx.textAlign = 'center'; ctx.fillText(String(degree || 360).padStart(3, '0') + '°', cx + x * (radius + 24), cy + y * (radius + 24) + 3); }
    }
    ctx.textAlign = 'left';
    ctx.setLineDash([3, 8]); ctx.strokeStyle = '#34725f80'; ctx.beginPath(); ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy); ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius); ctx.stroke(); ctx.setLineDash([]);
    const project = (x, y) => [cx + x * radius, cy + y * radius];
    const path = (points, color, dashed = false) => { ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash(dashed ? [5, 5] : []); ctx.beginPath(); points.forEach(([x, y], i) => { const p = project(x, y); i ? ctx.lineTo(...p) : ctx.moveTo(...p); }); ctx.stroke(); ctx.setLineDash([]); };
    path([[-1.05, -.5], [-.68, -.55], [-.38, -.2], [-.26, .23], [.04, .23]], '#356b684f');
    path([[.98, -.38], [.62, -.48], [.35, -.25], [.2, .19], [-.04, .19]], '#356b684f');
    path([[-1.12, .52], [-.75, .54], [-.4, .25], [.03, .23]], '#5d968c70', true);
    path([[.07, .2], [.46, .2], [.72, .49], [1.05, .58]], '#497b8275', true);
    const wp = (x, y, name) => { const [px, py] = project(x, y); ctx.strokeStyle = '#3b9b8290'; ctx.fillStyle = '#59a99190'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, py - 4); ctx.lineTo(px + 4, py + 3); ctx.lineTo(px - 4, py + 3); ctx.closePath(); ctx.stroke(); ctx.font = '8px monospace'; ctx.fillText(name, px + 8, py + 3); };
    wp(-.68, -.55, 'NORTH'); wp(.62, -.48, 'OCEAN'); wp(-.75, .54, 'BAYVW'); wp(.72, .49, 'COAST'); wp(-.95, -.12, 'GATE-2W'); wp(.93, .05, 'EASTF');
    ctx.fillStyle = '#0a211f'; ctx.strokeStyle = '#3c71644a'; ctx.beginPath(); [[-.18,.1],[-.1,.06],[.16,.09],[.24,.27],[.08,.34],[-.2,.29]].forEach(([x,y],i)=>{const p=project(x,y);i?ctx.lineTo(...p):ctx.moveTo(...p);});ctx.closePath();ctx.fill();ctx.stroke();
    [-.018,.018].forEach((offset,index)=>{ const [rx,ry]=project(0,.21+offset);ctx.strokeStyle='#9dc6b5a0';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(rx-25,ry);ctx.lineTo(rx+25,ry);ctx.stroke();ctx.font='8px monospace';ctx.fillStyle='#668f83';ctx.fillText(index?'09R':'09L',rx-48,ry+3); });
    const sweep = clock * .13 - Math.PI / 2;
    const cone = ctx.createConicGradient(sweep - .45, cx, cy); cone.addColorStop(0, 'rgba(43,177,126,0)'); cone.addColorStop(.06, 'rgba(57,210,153,.08)'); cone.addColorStop(.072, 'rgba(85,233,173,.16)'); cone.addColorStop(.073, 'rgba(0,0,0,0)'); cone.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cone; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = '#75e8b772'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sweep) * radius, cy + Math.sin(sweep) * radius); ctx.stroke();
    const traffic = [
      {x:-.72,y:-.34,h:128,name:'CES5213',alt:'090',speed:'210',color:'#70d0ac'},
      {x:.66,y:-.3,h:225,name:'CCA1802',alt:'120',speed:'230',color:'#79c3b1'},
      {x:-.64,y:.37,h:91,name:'CSN306',alt:'060',speed:'190',color:'#94e8c8'},
      {x:.65,y:.39,h:58,name:'CHH7601',alt:'150',speed:'240',color:'#70b9bc'},
      {x:.18,y:-.8,h:184,name:'CES8812',alt:'180',speed:'250',color:'#5f9f8d'},
    ];
    traffic.forEach((ac,index)=>{
      const radians=(ac.h-90)*Math.PI/180,progress=Math.sin(clock*.018+index)*.045;
      const [px,py]=project(ac.x+Math.cos(radians)*progress,ac.y+Math.sin(radians)*progress);
      const dx=Math.cos(radians),dy=Math.sin(radians);
      for(let n=1;n<=5;n++){ctx.fillStyle=`rgba(87,175,143,${.35-n*.05})`;ctx.fillRect(px-dx*n*7-1,py-dy*n*7-1,2,2);}
      ctx.strokeStyle=ac.color;ctx.lineWidth=1;ctx.strokeRect(px-3,py-3,6,6);ctx.beginPath();ctx.moveTo(px+dx*4,py+dy*4);ctx.lineTo(px+dx*22,py+dy*22);ctx.stroke();
      ctx.strokeStyle=ac.color+'80';ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(px+5,py-5);ctx.lineTo(px+16,py-19);ctx.lineTo(px+101,py-19);ctx.stroke();
      ctx.font='10px monospace';ctx.fillStyle=ac.color;ctx.fillText(ac.name,px+19,py-24);ctx.font='8px monospace';ctx.fillStyle='#86b4a5a0';ctx.fillText(`${ac.alt}  ${ac.speed}  A320`,px+19,py-9);
    });
  };

  let legacyPosition = 0;
  viewport.addEventListener('scroll', () => { legacyPosition = viewport.scrollLeft; }, { passive: true });
  const frame = now => {
    const dt = Math.min(.06, (now - (lastTime || now)) / 1000); lastTime = now;
    if (!motionPaused && heroVisible) time += dt;
    if (!motionPaused && heroVisible && now - lastDraw > 34) { drawRadar(time); lastDraw = now; }
    if (!motionPaused && !legacyPaused && !legacyHover && !legacyFocus && legacyVisible && !viewer.open) {
      const period = track.children[4].offsetLeft - track.children[0].offsetLeft;
      legacyPosition += dt * 24;
      if (period > 0 && legacyPosition >= period) legacyPosition -= period;
      viewport.scrollLeft = legacyPosition;
    }
    frameId = requestAnimationFrame(frame);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(frameId); frameId = null; }
    else if (frameId === null) { lastTime = 0; lastDraw = performance.now(); frameId = requestAnimationFrame(frame); }
  });
  frameId = requestAnimationFrame(frame);
})();
