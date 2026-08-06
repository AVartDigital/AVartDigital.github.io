const { chromium } = require('playwright-core');
const URL = 'http://localhost:8899/index.html';
const results = [];
function ok(name, pass, note){ results.push({name, pass, note: note||''}); }

const PEER = () => {
  window.Peer = class {
    constructor(id){ this.id = id || '482100'; this.destroyed=false; this.disconnected=false; this._h={}; }
    on(ev,cb){ this._h[ev]=cb; if(ev==='open') setTimeout(()=>cb(this.id),20); return this; }
    connect(){ return { on(){}, send(){}, open:true, close(){} }; }
    reconnect(){} destroy(){ this.destroyed=true; }
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox','--autoplay-policy=no-user-gesture-required'] });

  // ───────── Layout: no-scroll across the device matrix ─────────
  const viewports = [
    { name:'TV 1080p', width:1920, height:1080 },
    { name:'TV 720p',  width:1280, height:720  },
    { name:'Tablet',   width:820,  height:1180 },
    { name:'Phone',    width:390,  height:844  },
    { name:'Small phone', width:320, height:568 },
  ];
  for (const vp of viewports) {
    const ctx = await browser.newContext({ viewport:{width:vp.width,height:vp.height} });
    const page = await ctx.newPage(); await page.addInitScript(PEER);
    const errs=[]; page.on('pageerror',e=>errs.push(e.message));
    await page.goto(URL, { waitUntil:'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.evaluate(()=>{ const s=document.getElementById('cp-splash'); if(s) s.style.display='none'; });

    const home = await page.evaluate(()=>({
      x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }));
    ok(`${vp.name}: home no horizontal overflow`, home.x <= 1, `x=${home.x}`);
    ok(`${vp.name}: home no vertical page scroll`, home.y <= 1, `y=${home.y}`);

    // TV pairing screen must fully fit — no remote scrolling, card fully on screen
    await page.evaluate(()=>{ goTV(); });
    await page.waitForTimeout(900);
    const wait = await page.evaluate(()=>{
      const s=document.getElementById('screen-tv-wait'), card=s.querySelector('.card');
      const r=card?card.getBoundingClientRect():null;
      return { active:s.classList.contains('active'), internal:s.scrollHeight-s.clientHeight,
               fits: r ? (r.top>=-1 && r.bottom<=window.innerHeight+1) : false };
    });
    ok(`${vp.name}: pairing screen active`, wait.active);
    ok(`${vp.name}: pairing screen NOT scrollable`, wait.internal <= 1, `overflow=${wait.internal}px`);
    ok(`${vp.name}: pairing card fully visible`, wait.fits);

    // Idle TV: clean canvas, no auto UI, no filenames
    await page.evaluate(()=>{ tvAccept(); });
    await page.waitForTimeout(700);
    const idle = await page.evaluate(()=>({
      idle: document.getElementById('tv-stage').classList.contains('idle'),
      awaitingText: !!document.querySelector('.idle-text'),
      waves: document.querySelectorAll('.idle-wave').length,
      pageScroll: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }));
    ok(`${vp.name}: TV idle loop active`, idle.idle);
    ok(`${vp.name}: no AWAITING text / waves`, !idle.awaitingText && idle.waves===0);
    ok(`${vp.name}: TV player page not scrollable`, idle.pageScroll <= 1, `y=${idle.pageScroll}`);
    ok(`${vp.name}: no JS errors`, errs.length===0, errs.slice(0,2).join(' | '));
    await ctx.close();
  }

  // ───────── Phone: the two bugs fixed in the design pass ─────────
  const pctx = await browser.newContext({ viewport:{width:390,height:844} });
  const p = await pctx.newPage(); await p.addInitScript(PEER);
  const perr=[]; p.on('pageerror',e=>perr.push(e.message));
  await p.goto(URL,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(500);
  await p.evaluate(()=>{ const s=document.getElementById('cp-splash'); if(s) s.style.display='none'; });

  const overlap = await p.evaluate(async ()=>{
    goPhone(); showScreen('screen-phone-source'); pickSource('file'); confirmed=true;
    addToPlaylist(new File([new Uint8Array(200)],'a.mp4',{type:'video/mp4'}));
    renderPlaylist();
    const fab = document.getElementById('remote-fab');
    fab.classList.add('show'); fab.style.display='flex';
    await new Promise(r=>setTimeout(r,300));
    const cta = document.getElementById('btn-cast-file').getBoundingClientRect();
    const f = fab.getBoundingClientRect();
    const hit = !(f.right < cta.left || f.left > cta.right || f.bottom < cta.top || f.top > cta.bottom);
    return { hit, ctaBottom: Math.round(cta.bottom), fabTop: Math.round(f.top) };
  });
  ok('BUGFIX: remote FAB no longer overlaps "Cast Now"', overlap.hit === false, JSON.stringify(overlap));

  const dup = await p.evaluate(async ()=>{
    tvBusy=true; enterController(false); openRemote();
    await new Promise(r=>setTimeout(r,250));
    const pagePill = document.getElementById('phone-cast-status');
    const vis = getComputedStyle(pagePill).display !== 'none';
    const remotePill = !!document.getElementById('rmt-status-text');
    closeRemote(); await new Promise(r=>setTimeout(r,150));
    const visAfter = getComputedStyle(pagePill).display !== 'none';
    return { dupWhileOpen: vis && remotePill, restored: visAfter };
  });
  ok('BUGFIX: status pill not duplicated while remote open', dup.dupWhileOpen === false);
  ok('Page status pill returns when remote closes', dup.restored === true);

  // Media flow: dropzone precedes the style chips (media before abstract choice)
  const order = await p.evaluate(()=>{
    const dz = document.getElementById('file-drop-zone');
    const intent = document.querySelector('.intent-row');
    if(!dz || !intent) return { ok:false, why:'missing' };
    const pos = dz.compareDocumentPosition(intent);
    return { ok: !!(pos & Node.DOCUMENT_POSITION_FOLLOWING) };
  });
  ok('IA: "Add media" comes before the experience chips', order.ok === true, JSON.stringify(order));

  // No emoji left in primary UI chips/buttons
  const emoji = await p.evaluate(()=>{
    const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const bad = [];
    document.querySelectorAll('.intent-chip, #screen-tv-wait button').forEach(b=>{ if(re.test(b.textContent)) bad.push(b.textContent.trim().slice(0,24)); });
    return bad;
  });
  ok('Brand: no emoji in intent chips / TV buttons', emoji.length === 0, emoji.join(','));

  // Capability probe still classifies correctly
  const probe = await p.evaluate(async ()=>{
    function mk(fourcc,name,type){ const b=new Uint8Array(200); b.set(new TextEncoder().encode(fourcc),40); return new File([b],name,{type:type||'video/mp4'}); }
    playlist.length=0;
    addToPlaylist(mk('avc1','h264.mp4'));
    addToPlaylist(mk('hvc1','hevc.mov','video/quicktime'));
    addToPlaylist(new File([new Uint8Array(50)],'m.mkv',{type:'video/x-matroska'}));
    addToPlaylist(new File([new Uint8Array(50)],'p.heic',{type:'image/heic'}));
    await new Promise(r=>setTimeout(r,700));
    return playlist.map(i=>({n:i.name, r:i.ready}));
  });
  ok('Pipeline: H.264 ready', probe[0] && probe[0].r === 'ready', JSON.stringify(probe));
  ok('Pipeline: HEVC blocked', probe[1] && probe[1].r === 'block');
  ok('Pipeline: MKV blocked', probe[2] && probe[2].r === 'block');
  ok('Pipeline: HEIC blocked', probe[3] && probe[3].r === 'block');

  // 2GB gate
  const lim = await p.evaluate(()=>{
    const before = playlist.length;
    const rej = addToPlaylist({ size: 2.5*1024*1024*1024, name:'big.mp4', type:'video/mp4' });
    return { rej, added: playlist.length-before, toast: document.getElementById('toast').textContent };
  });
  ok('2GB limit blocks oversized before upload', lim.rej === false && lim.added === 0);
  ok('2GB message is the exact spec copy', /This file is too large\. Please choose a file under 2 GB\./.test(lim.toast), lim.toast.slice(0,60));

  // Playback styles
  const styles = await p.evaluate(async ()=>{
    const sent=[]; window.primaryConn = { open:true, send(m){ sent.push(m); } };
    setPbStyle('manual'); setPbStyle('loop'); setPbStyle('once');
    const msgs = sent.filter(m=>m.t==='pbstyle').map(m=>m.style);
    role='tv'; document.getElementById('tv-stage').classList.remove('idle');
    tvStyle='once'; tvQueue=[]; tvPlayed=[]; tvPlaying={id:1,name:'x',kind:'video',url:'u'};
    onMediaEnded();
    const onceHolds = tvPlaying !== null && !document.getElementById('tv-stage').classList.contains('idle');
    tvStyle='manual'; tvQueue=[{id:2,name:'y',kind:'video',url:'u2'}]; onMediaEnded();
    const manualHolds = tvQueue.length === 1;
    tvStyle='loop'; tvQueue=[]; tvPlayed=[{id:1,kind:'image',url:'a'},{id:2,kind:'image',url:'b'}]; onMediaEnded();
    const loopRefuels = tvQueue.length >= 1;
    role='phone';
    return { msgs, onceHolds, manualHolds, loopRefuels };
  });
  ok('Style: selector sends pbstyle', JSON.stringify(styles.msgs)===JSON.stringify(['manual','loop','once']), JSON.stringify(styles.msgs));
  ok('Style: ONCE holds on final item', styles.onceHolds);
  ok('Style: MANUAL never auto-advances', styles.manualHolds);
  ok('Style: LOOP refuels from history', styles.loopRefuels);
  ok('Phone: no JS errors', perr.length === 0, perr.slice(0,2).join(' | '));
  await pctx.close();

  // ───────── TV: clean playback surface + custom text still works ─────────
  const tctx = await browser.newContext({ viewport:{width:1280,height:720} });
  const t = await tctx.newPage(); await t.addInitScript(PEER);
  await t.goto(URL,{waitUntil:'domcontentloaded'}); await t.waitForTimeout(400);
  await t.evaluate(async ()=>{ const s=document.getElementById('cp-splash'); if(s) s.style.display='none';
    goTV(); await new Promise(r=>setTimeout(r,300)); tvAccept(); await new Promise(r=>setTimeout(r,200));
    playItem({id:1,name:'SECRET-FILENAME.mp4',kind:'video',url:'./castparty-splash.mp4',sender:'Alex'}); });
  await t.waitForTimeout(2200);
  const clean = await t.evaluate(()=>({
    overlay: document.getElementById('tv-overlay').classList.contains('visible'),
    caster: document.getElementById('tv-caster').classList.contains('show'),
    title: document.getElementById('tv-ov-title').textContent,
    controls: document.getElementById('tv-video').hasAttribute('controls'),
    fit: getComputedStyle(document.getElementById('tv-video')).objectFit,
  }));
  ok('TV: no auto overlay on playback', clean.overlay === false);
  ok('TV: no "casting from" banner', clean.caster === false);
  ok('TV: filename never rendered', clean.title === '', clean.title);
  ok('TV: no native video controls', clean.controls === false);
  ok('TV: media scaled to fit (contain)', clean.fit === 'contain');
  const msg = await t.evaluate(()=>{
    flashMessageOnTV('HAPPY BIRTHDAY', true, {font:"'Great Vibes',cursive", color:'#ffd24a', shadow:true});
    const el = document.getElementById('tv-flash-text');
    return { shown: document.getElementById('tv-flash').classList.contains('show'), text: el.textContent, color: el.style.color };
  });
  ok('TV: user text overlay still appears exactly as sent', msg.shown && msg.text==='HAPPY BIRTHDAY' && /255, 210, 74/.test(msg.color), JSON.stringify(msg));
  await tctx.close();

  await browser.close();
  let pass=0, fail=0;
  for(const r of results){ r.pass?pass++:fail++; console.log(`${r.pass?'PASS':'FAIL'}  ${r.name}${r.note?'  ['+r.note+']':''}`); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
