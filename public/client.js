(() => {
  'use strict';
  const G = window.TankGame, W = G.W, H = G.H, clamp = G.clamp;
  const $ = (id) => document.getElementById(id);
  const canvas = $('c'), ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;

  const COLORS = [
    { body: '#3d7be0', dark: '#2352a3', light: '#8fb8ff' },
    { body: '#e0533d', dark: '#a3321f', light: '#ff9f8f' },
  ];
  const WEAPON_KEYS = ['shell', 'heavy', 'triple', 'nuke'];

  // ------------------------------------------------------------------ state
  let ws = null, me = -1, S = null, anim = null;
  let particles = [], popups = [], clouds = [];
  let shake = 0, flash = 0;
  const held = new Set();
  let shiftDown = false, aiming = false, aimDirty = false, lastAimSent = 0, moveTimer = 0;

  // ------------------------------------------------------------------ network
  function connect(then) {
    if (ws && ws.readyState === 1) { then && then(); return; }
    if (ws && ws.readyState === 0) { ws.addEventListener('open', () => then && then()); return; }
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = () => then && then();
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } handle(m); };
    ws.onclose = () => {
      ws = null;
      if (S) { S = null; anim = null; }
      $('hud').classList.add('hidden'); $('controls').classList.add('hidden');
      show('lobby');
      $('lobbyErr').textContent = 'Connection lost. Try again.';
    };
  }
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

  function show(name) {
    for (const id of ['lobby', 'waiting', 'end']) $(id).classList.toggle('hidden', id !== name);
  }

  function handle(m) {
    switch (m.t) {
      case 'wait':
        show('waiting');
        $('waitMsg').textContent = m.quick ? 'Searching for an opponent…' : 'Waiting for a friend…';
        $('codeBox').classList.toggle('hidden', !m.code);
        $('roomCode').textContent = m.code || '';
        break;
      case 'start': startMatch(m); break;
      case 'turn': {
        finishShot();
        S.turn = m.turn; S.wind = m.wind; S.phase = 'aim';
        S.deadline = performance.now() + m.ms;
        S.tanks[m.turn].fuel = m.fuel;
        updateHUD();
        if (m.turn === me) { toast('YOUR TURN'); sfxTone(520, 780, 0.18, 0.15, 'triangle'); }
        else toast(S.names[m.turn] + "'s turn");
        break;
      }
      case 'aim': if (S && m.i !== me) { S.tanks[m.i].angle = m.angle; S.tanks[m.i].power = m.power; } break;
      case 'move': if (S) { S.tanks[m.i].x = m.x; S.tanks[m.i].fuel = m.fuel; updateHUD(); } break;
      case 'weapon': if (S) { S.tanks[m.i].weapon = m.id; updateHUD(); } break;
      case 'shot': if (S) beginShot(m); break;
      case 'over': finishShot(); endScreen(m.winner); break;
      case 'rematch_req': $('endSub').textContent = 'Opponent wants a rematch!'; break;
      case 'opp_left':
        finishShot();
        if (S) S.phase = 'wait';
        $('endTitle').textContent = 'Opponent left';
        $('endSub').textContent = 'The match has ended.';
        $('rematchBtn').classList.add('hidden');
        show('end');
        break;
      case 'err': $('lobbyErr').textContent = m.msg; show('lobby'); break;
    }
  }

  function startMatch(m) {
    me = m.you;
    S = {
      heights: m.terrain.slice(),
      tanks: m.tanks.map((t, i) => ({ ...t, name: m.names[i], drawY: m.terrain[t.x] })),
      names: m.names, turn: -1, wind: 0, deadline: 0, phase: 'wait',
    };
    anim = null; particles = []; popups = [];
    $('hud').classList.remove('hidden'); $('controls').classList.remove('hidden');
    $('rematchBtn').classList.remove('hidden'); $('rematchBtn').disabled = false;
    buildWeapons(); updateHUD(); show(null);
    resizeNote();
  }
  function resizeNote() { window.dispatchEvent(new Event('resize')); }

  // ------------------------------------------------------------------ HUD
  function buildWeapons() {
    const box = $('weapons'); box.innerHTML = '';
    WEAPON_KEYS.forEach((k, idx) => {
      const b = document.createElement('button');
      b.className = 'wchip'; b.dataset.w = k;
      b.addEventListener('click', () => chooseWeapon(k));
      b.title = 'Key ' + (idx + 1);
      box.appendChild(b);
    });
  }
  function myAim() { return !!S && S.turn === me && S.phase === 'aim'; }
  function chooseWeapon(k) {
    if (!myAim()) return;
    const t = S.tanks[me];
    if (k !== 'shell' && !(t.ammo[k] > 0)) return;
    t.weapon = k; send({ t: 'weapon', id: k }); updateHUD();
  }
  function updateHUD() {
    if (!S) return;
    S.tanks.forEach((t, i) => {
      $('p' + i + 'name').textContent = S.names[i] + (i === me ? ' (you)' : '');
      const bar = $('p' + i + 'bar');
      bar.style.width = clamp(t.hp, 0, 100) + '%';
      bar.style.background = t.hp > 55 ? '#5ad07a' : t.hp > 25 ? '#ffb347' : '#e0533d';
      $('p' + i + 'hp').textContent = t.hp + ' HP';
      $('p' + i).classList.toggle('turn', S.turn === i);
    });
    const w = S.wind;
    $('wind').textContent = w === 0 ? 'Wind: calm' : 'Wind ' + (w < 0 ? '◀◀ ' : '▶▶ ') + Math.abs(w);
    const t = S.tanks[me];
    $('angTxt').textContent = Math.round(t.angle) + '°';
    $('powTxt').textContent = Math.round(t.power);
    $('powBar').style.width = t.power + '%';
    $('fuelBar').style.width = (S.turn === me ? (t.fuel / G.FUEL) * 100 : 0) + '%';
    $('fuelTxt').textContent = S.turn === me ? Math.round(t.fuel) : '';
    document.querySelectorAll('.wchip').forEach((b) => {
      const k = b.dataset.w, ammo = k === 'shell' ? '∞' : t.ammo[k];
      b.innerHTML = '<b>' + G.WEAPONS[k].name + '</b>' + ammo;
      b.classList.toggle('active', t.weapon === k);
      b.disabled = !myAim() || (k !== 'shell' && !(t.ammo[k] > 0));
    });
    $('controls').classList.toggle('locked', !myAim());
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = $('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
  }

  function endScreen(winner) {
    S.phase = 'wait';
    const title = winner === -1 ? 'DRAW' : winner === me ? 'VICTORY!' : 'DEFEAT';
    $('endTitle').textContent = title;
    $('endSub').textContent = winner === -1 ? 'Both tanks destroyed.' : S.names[winner] + ' wins the duel.';
    $('rematchBtn').classList.remove('hidden'); $('rematchBtn').disabled = false;
    setTimeout(() => { if (S && S.phase === 'wait') show('end'); }, 900);
    updateHUD();
  }

  // ------------------------------------------------------------------ shots
  function beginShot(m) {
    finishShot();
    S.phase = 'wait';
    anim = { t: 0, msg: m, projs: m.projectiles.map((p) => ({ path: p.path, impact: p.impact, done: false })), endAt: 0 };
    sfxShot();
    shake = 4;
    updateHUD();
  }

  function explode(x, y, r) {
    G.crater(S.heights, x, y, r);
    sfxBoom(r);
    shake = Math.max(shake, Math.min(22, r / 4.5));
    flash = Math.min(0.5, r / 220);
    const n = Math.round(r * 0.9);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (0.3 + Math.random()) * r * 3.2;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.5 + Math.random() * 0.7, max: 1.2,
        size: 2 + Math.random() * r / 12, color: Math.random() < 0.5 ? '#ffb347' : '#ff6a2a', grav: 200, type: 'fire' });
    }
    for (let i = 0; i < n * 0.7; i++) {
      const a = -Math.PI * (0.1 + Math.random() * 0.8), s = (0.4 + Math.random()) * r * 4;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1 + Math.random() * 0.8, max: 1.8,
        size: 2 + Math.random() * 4, color: Math.random() < 0.5 ? '#7a4f2b' : '#5b3a1f', grav: 700, type: 'dirt' });
    }
    particles.push({ x, y, vx: 0, vy: 0, life: 0.45, max: 0.45, size: r * 1.5, color: '#fff', grav: 0, type: 'ring' });
    for (let i = 0; i < 10; i++) {
      particles.push({ x: x + (Math.random() - 0.5) * r, y: y - Math.random() * r * 0.4, vx: (Math.random() - 0.5) * 30, vy: -30 - Math.random() * 50,
        life: 1.4 + Math.random(), max: 2.4, size: 8 + Math.random() * r / 4, color: '#555', grav: -20, type: 'smoke' });
    }
  }

  function finishShot() {
    if (!anim) return;
    const m = anim.msg;
    for (const p of anim.projs) if (!p.done && p.impact) { p.done = true; G.crater(S.heights, p.impact.x, p.impact.y, m.radius); }
    S.heights = m.terrain.slice();
    m.tanks.forEach((s, i) => Object.assign(S.tanks[i], s));
    let hit = false;
    S.tanks.forEach((t, i) => {
      const d = m.damage[i] + m.fall[i];
      if (d > 0) { hit = true; popups.push({ x: t.x, y: t.drawY - 60, text: '-' + d, t: 0 }); sfxTone(180, 60, 0.25, 0.25, 'square'); }
    });
    if (!hit && m.shooter === me) toast('Miss!');
    anim = null;
    updateHUD();
  }

  // ------------------------------------------------------------------ input
  const KEYMAP = { ArrowLeft: 'angup', ArrowRight: 'angdown', ArrowUp: 'powup', ArrowDown: 'powdown', a: 'left', d: 'right', A: 'left', D: 'right' };
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Shift') shiftDown = true;
    const hk = KEYMAP[e.key];
    if (hk) { held.add(hk); e.preventDefault(); }
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); fire(); }
    if (e.key >= '1' && e.key <= '4') chooseWeapon(WEAPON_KEYS[+e.key - 1]);
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') shiftDown = false;
    const hk = KEYMAP[e.key]; if (hk) held.delete(hk);
  });
  window.addEventListener('blur', () => held.clear());

  document.querySelectorAll('.hold').forEach((b) => {
    const k = b.dataset.hold;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); held.add(k); b.setPointerCapture(e.pointerId); });
    const up = () => held.delete(k);
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
  });
  $('fireBtn').addEventListener('click', fire);

  function toLogical(e) {
    const r = canvas.getBoundingClientRect();
    const s = Math.min(r.width / W, r.height / H);
    return { x: (e.clientX - r.left - (r.width - W * s) / 2) / s, y: (e.clientY - r.top - (r.height - H * s) / 2) / s };
  }
  function aimTo(e) {
    if (!myAim()) return;
    const p = toLogical(e), t = S.tanks[me];
    const dx = p.x - t.x, dy = p.y - (t.drawY - 18);
    let a = (Math.atan2(-dy, dx) * 180) / Math.PI;
    if (a < 0) a = dx >= 0 ? 0 : 180;
    t.angle = clamp(a, 0, 180);
    t.power = clamp(Math.hypot(dx, dy) / 4, 10, 100);
    aimDirty = true; updateHUD();
  }
  canvas.addEventListener('pointerdown', (e) => { aiming = true; canvas.setPointerCapture(e.pointerId); aimTo(e); });
  canvas.addEventListener('pointermove', (e) => { if (aiming) aimTo(e); });
  canvas.addEventListener('pointerup', () => { aiming = false; });
  canvas.addEventListener('pointercancel', () => { aiming = false; });

  function fire() {
    if (!myAim()) return;
    const t = S.tanks[me];
    send({ t: 'fire', angle: +t.angle.toFixed(1), power: +t.power.toFixed(1) });
    S.phase = 'wait';
    updateHUD();
  }

  function processInput(dt) {
    if (!myAim() || document.hidden) return;
    const t = S.tanks[me], rate = shiftDown ? 5 : 30;
    let changed = false;
    if (held.has('angup')) { t.angle = clamp(t.angle + rate * dt, 0, 180); changed = true; }
    if (held.has('angdown')) { t.angle = clamp(t.angle - rate * dt, 0, 180); changed = true; }
    if (held.has('powup')) { t.power = clamp(t.power + rate * dt, 10, 100); changed = true; }
    if (held.has('powdown')) { t.power = clamp(t.power - rate * dt, 10, 100); changed = true; }
    if (changed) { aimDirty = true; updateHUD(); }
    const dir = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
    moveTimer -= dt;
    if (dir && moveTimer <= 0 && t.fuel > 0) { send({ t: 'move', dir }); moveTimer = 0.05; }
    const now = performance.now();
    if (aimDirty && now - lastAimSent > 80) {
      send({ t: 'aim', angle: +t.angle.toFixed(1), power: +t.power.toFixed(1) });
      aimDirty = false; lastAimSent = now;
    }
  }

  // ------------------------------------------------------------------ lobby wiring
  const nameInput = $('nameInput'), codeInput = $('codeInput');
  nameInput.value = localStorage.getItem('td_name') || '';
  const params = new URLSearchParams(location.search);
  if (params.get('room')) codeInput.value = params.get('room').toUpperCase().slice(0, 4);
  const myName = () => { const n = nameInput.value.trim() || 'Player'; localStorage.setItem('td_name', n); return n; };
  $('quickBtn').onclick = () => { $('lobbyErr').textContent = ''; audio(); connect(() => send({ t: 'quick', name: myName() })); };
  $('createBtn').onclick = () => { $('lobbyErr').textContent = ''; audio(); connect(() => send({ t: 'create', name: myName() })); };
  const doJoin = () => {
    const c = codeInput.value.trim().toUpperCase();
    if (c.length !== 4) { $('lobbyErr').textContent = 'Enter the 4-letter room code.'; return; }
    $('lobbyErr').textContent = ''; audio();
    connect(() => send({ t: 'join', code: c, name: myName() }));
  };
  $('joinBtn').onclick = doJoin;
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
  $('cancelBtn').onclick = () => { send({ t: 'leave' }); show('lobby'); };
  $('copyBtn').onclick = async () => {
    const link = location.origin + '/?room=' + $('roomCode').textContent;
    try { await navigator.clipboard.writeText(link); $('copyBtn').textContent = 'Copied!'; }
    catch { $('copyBtn').textContent = link; }
    setTimeout(() => { $('copyBtn').textContent = 'Copy invite link'; }, 2000);
  };
  $('rematchBtn').onclick = () => { send({ t: 'rematch' }); $('rematchBtn').disabled = true; $('endSub').textContent = 'Waiting for opponent…'; };
  const toMenu = () => {
    send({ t: 'leave' }); S = null; anim = null;
    $('hud').classList.add('hidden'); $('controls').classList.add('hidden'); show('lobby');
  };
  $('menuBtn').onclick = toMenu;
  $('leaveBtn').onclick = () => { if (confirm('Leave this match?')) toMenu(); };
  let muted = false;
  $('muteBtn').onclick = () => { muted = !muted; $('muteBtn').textContent = muted ? '🔇' : '🔊'; };

  // ------------------------------------------------------------------ sound
  let actx = null;
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no audio */ } }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  function sfxNoise(dur, type, freq, gain) {
    const a = actx; if (!a || muted) return;
    const n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = a.createGain(); g.gain.setValueAtTime(gain, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    src.connect(f); f.connect(g); g.connect(a.destination); src.start();
  }
  function sfxTone(f0, f1, dur, gain, type) {
    const a = actx; if (!a || muted) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, a.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), a.currentTime + dur);
    g.gain.setValueAtTime(gain, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + dur);
  }
  function sfxShot() { sfxNoise(0.18, 'highpass', 900, 0.35); sfxTone(220, 80, 0.15, 0.3, 'sawtooth'); }
  function sfxBoom(r) {
    sfxNoise(0.5 + r / 120, 'lowpass', 260 + r * 2, 0.9);
    sfxTone(130, 35, 0.4 + r / 200, 0.7, 'sine');
  }

  // ------------------------------------------------------------------ rendering
  const sky = document.createElement('canvas'); sky.width = W; sky.height = H;
  (function buildSky() {
    const c = sky.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#16213f'); g.addColorStop(0.55, '#46599a'); g.addColorStop(1, '#f0a26a');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    c.fillStyle = 'rgba(255,255,255,.7)';
    for (let i = 0; i < 90; i++) { c.globalAlpha = 0.2 + rnd() * 0.6; c.fillRect(rnd() * W, rnd() * H * 0.45, 1.6, 1.6); }
    c.globalAlpha = 1;
    const sun = c.createRadialGradient(1180, 420, 10, 1180, 420, 150);
    sun.addColorStop(0, 'rgba(255,235,190,1)'); sun.addColorStop(0.3, 'rgba(255,200,130,.6)'); sun.addColorStop(1, 'rgba(255,170,100,0)');
    c.fillStyle = sun; c.beginPath(); c.arc(1180, 420, 150, 0, 7); c.fill();
    [['#2b3a6e', 0.55, 130, 0.004, 1.1], ['#233058', 0.62, 90, 0.007, 3.2]].forEach(([col, base, amp, f, ph]) => {
      c.fillStyle = col; c.globalAlpha = 0.9; c.beginPath(); c.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) c.lineTo(x, H * base + Math.sin(x * f + ph) * amp * 0.5 + Math.sin(x * f * 2.7 + ph) * amp * 0.25);
      c.lineTo(W, H); c.fill();
    });
    c.globalAlpha = 1;
  })();
  for (let i = 0; i < 7; i++) clouds.push({ x: Math.random() * W, y: 40 + Math.random() * 220, s: 0.6 + Math.random() * 1.1, v: 6 + Math.random() * 10 });

  let terrainGrad = null;
  function drawSky(dt) {
    ctx.drawImage(sky, 0, 0);
    const wind = S ? S.wind : 0;
    ctx.fillStyle = 'rgba(255,255,255,.1)';
    for (const c of clouds) {
      c.x += (c.v + wind * 3) * dt;
      if (c.x > W + 120) c.x = -120; if (c.x < -120) c.x = W + 120;
      for (const [dx, dy, r] of [[0, 0, 34], [32, -10, 28], [-30, -4, 24], [60, 4, 22]]) {
        ctx.beginPath(); ctx.ellipse(c.x + dx * c.s, c.y + dy * c.s, r * c.s * 1.5, r * c.s * 0.8, 0, 0, 7); ctx.fill();
      }
    }
  }

  function drawTerrain() {
    const h = S.heights;
    if (!terrainGrad) {
      terrainGrad = ctx.createLinearGradient(0, 250, 0, H);
      terrainGrad.addColorStop(0, '#8a5a31'); terrainGrad.addColorStop(0.5, '#5f3d20'); terrainGrad.addColorStop(1, '#2f1d10');
    }
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x < W; x++) ctx.lineTo(x, h[x]);
    ctx.lineTo(W - 1, H); ctx.closePath();
    ctx.fillStyle = terrainGrad; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, h[0]);
    for (let x = 1; x < W; x++) ctx.lineTo(x, h[x]);
    ctx.lineJoin = 'round'; ctx.lineWidth = 8; ctx.strokeStyle = '#3f8f35'; ctx.stroke();
    ctx.lineWidth = 4; ctx.strokeStyle = '#6bc24a'; ctx.translate(0, -1.5); ctx.stroke(); ctx.translate(0, 1.5);
  }

  function rr(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawTank(t, i, time) {
    const h = S.heights, x = t.x, y = t.drawY;
    const tilt = Math.atan2(h[Math.min(W - 1, x + 10)] - h[Math.max(0, x - 10)], 20);
    const col = COLORS[i], dead = t.hp <= 0;
    ctx.save(); ctx.translate(x, y); ctx.rotate(tilt);
    ctx.fillStyle = dead ? '#1d1d1d' : '#222'; rr(-21, -9, 42, 12, 6); ctx.fill();
    ctx.fillStyle = '#555';
    for (let k = -14; k <= 14; k += 9) { ctx.beginPath(); ctx.arc(k, -3, 3.4, 0, 7); ctx.fill(); }
    ctx.fillStyle = dead ? '#3a3a3a' : col.body; rr(-17, -18, 34, 11, 4); ctx.fill();
    ctx.fillStyle = dead ? '#2a2a2a' : col.dark; ctx.beginPath(); ctx.arc(0, -18, 10, Math.PI, 0); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(-14, -17, 28, 2);
    ctx.restore();
    const px = x + Math.sin(tilt) * 18, py = y - Math.cos(tilt) * 18;
    const ang = (t.angle * Math.PI) / 180;
    if (!dead) {
      ctx.save(); ctx.translate(px, py); ctx.rotate(-ang);
      ctx.fillStyle = '#2b2b2b'; rr(0, -3.2, 32, 6.4, 2); ctx.fill();
      ctx.fillStyle = '#444'; ctx.fillRect(28, -4.2, 6, 8.4);
      ctx.restore();
      if (i === me && myAim()) {
        const tipx = px + Math.cos(ang) * 36, tipy = py - Math.sin(ang) * 36, len = t.power * 2.4;
        ctx.save(); ctx.setLineDash([7, 7]); ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,230,160,.85)';
        ctx.beginPath(); ctx.moveTo(tipx, tipy); ctx.lineTo(tipx + Math.cos(ang) * len, tipy - Math.sin(ang) * len); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = '#ffe6a0';
        ctx.beginPath(); ctx.arc(tipx + Math.cos(ang) * len, tipy - Math.sin(ang) * len, 5, 0, 7); ctx.fill();
        ctx.restore();
      }
    } else if (Math.random() < 0.2) {
      particles.push({ x: x + (Math.random() - 0.5) * 16, y: y - 16, vx: (Math.random() - 0.5) * 10, vy: -40, life: 1.2, max: 1.2, size: 7, color: '#444', grav: -10, type: 'smoke' });
    }
    // label + health bar
    if (!dead) {
      ctx.font = '700 15px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillText(t.name, x + 1, y - 44);
      ctx.fillStyle = col.light; ctx.fillText(t.name, x, y - 45);
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x - 24, y - 40, 48, 7);
      ctx.fillStyle = t.hp > 55 ? '#5ad07a' : t.hp > 25 ? '#ffb347' : '#e0533d'; ctx.fillRect(x - 23, y - 39, 46 * (t.hp / 100), 5);
      if (S.turn === i && S.phase !== 'over') {
        const bob = Math.sin(time * 6) * 3;
        ctx.fillStyle = '#ffb347'; ctx.beginPath();
        ctx.moveTo(x, y - 62 + bob); ctx.lineTo(x - 8, y - 74 + bob); ctx.lineTo(x + 8, y - 74 + bob); ctx.closePath(); ctx.fill();
      }
    }
  }

  function drawProjectiles() {
    if (!anim) return;
    const big = anim.msg.radius;
    for (const p of anim.projs) {
      if (p.done) continue;
      const idx = Math.min(p.path.length - 1, Math.floor(anim.t * 60));
      const pt = p.path[idx];
      ctx.fillStyle = 'rgba(255,200,100,.35)'; ctx.beginPath(); ctx.arc(pt[0], pt[1], 4 + big / 12, 0, 7); ctx.fill();
      ctx.fillStyle = big > 100 ? '#ff4d4d' : '#ffe08a'; ctx.beginPath(); ctx.arc(pt[0], pt[1], 2.5 + big / 25, 0, 7); ctx.fill();
    }
  }

  function updateAnim(dt) {
    if (!anim) return;
    anim.t += dt;
    let all = true;
    for (const p of anim.projs) {
      const idx = Math.min(p.path.length - 1, Math.floor(anim.t * 60));
      const pt = p.path[idx];
      if (!p.done) {
        if (Math.random() < 0.7) particles.push({ x: pt[0], y: pt[1], vx: (Math.random() - 0.5) * 12, vy: (Math.random() - 0.5) * 12, life: 0.5, max: 0.5, size: 3, color: '#ddd', grav: 0, type: 'smoke' });
        if (idx >= p.path.length - 1) { p.done = true; if (p.impact) explode(p.impact.x, p.impact.y, anim.msg.radius); }
        else all = false;
      }
    }
    if (all) { if (!anim.endAt) anim.endAt = anim.t + 0.9; else if (anim.t >= anim.endAt) finishShot(); }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.grav * dt;
      if (p.type === 'dirt' && p.y > 0 && p.y >= S.heights[clamp(Math.round(p.x), 0, W - 1)]) p.life = 0;
    }
    particles = particles.filter((p) => p.life > 0);
    if (particles.length > 900) particles.splice(0, particles.length - 900);
    for (const q of popups) q.t += dt;
    popups = popups.filter((q) => q.t < 1.4);
  }

  function drawParticles() {
    for (const p of particles) {
      const k = p.life / p.max;
      if (p.type === 'ring') {
        ctx.globalAlpha = k; ctx.strokeStyle = '#fff'; ctx.lineWidth = 5 * k + 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - k) + 6, 0, 7); ctx.stroke();
      } else if (p.type === 'smoke') {
        ctx.globalAlpha = k * 0.45; ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.6 - k), 0, 7); ctx.fill();
      } else {
        ctx.globalAlpha = clamp(k * 1.5, 0, 1); ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.type === 'fire' ? k + 0.3 : 1), 0, 7); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.font = '800 26px system-ui, sans-serif'; ctx.textAlign = 'center';
    for (const q of popups) {
      ctx.globalAlpha = clamp(1.4 - q.t, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillText(q.text, q.x + 2, q.y - q.t * 40 + 2);
      ctx.fillStyle = '#ff6a5a'; ctx.fillText(q.text, q.x, q.y - q.t * 40);
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ main loop
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (S) {
      processInput(dt);
      updateAnim(dt);
      for (const t of S.tanks) {
        const target = S.heights[t.x];
        t.drawY += (target - t.drawY) * Math.min(1, dt * 10);
        if (Math.abs(target - t.drawY) < 0.2) t.drawY = target;
      }
      updateParticles(dt);
      shake *= Math.pow(0.02, dt); if (shake < 0.2) shake = 0;
      flash = Math.max(0, flash - dt);
      // timer
      const timer = $('timer');
      if (S.phase === 'aim') {
        const s = Math.max(0, Math.ceil((S.deadline - now) / 1000));
        timer.textContent = s; timer.classList.toggle('low', s <= 5);
      } else { timer.textContent = '--'; timer.classList.remove('low'); }

      ctx.save();
      if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      drawSky(dt); drawTerrain();
      S.tanks.forEach((t, i) => drawTank(t, i, now / 1000));
      drawProjectiles(); drawParticles();
      ctx.restore();
      if (flash > 0) { ctx.fillStyle = 'rgba(255,240,200,' + flash + ')'; ctx.fillRect(0, 0, W, H); }
    } else {
      drawSkyIdle(dt);
    }
    requestAnimationFrame(loop);
  }
  function drawSkyIdle(dt) { drawSky(dt); }
  requestAnimationFrame(loop);
})();
