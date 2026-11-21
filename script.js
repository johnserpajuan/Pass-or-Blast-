/* ==============================================================
   PASS OR BLAST - game logic (vanilla JavaScript)

   Sections:
   1. Settings and state      5. Honor roll (localStorage)
   2. Audio and voice cues    6. Update (game rules)
   3. Level setup             7. Drawing
   4. Movement helpers        8. Input, buttons and start-up
   ============================================================== */
(() => {
'use strict';

/* ---------- 1. Settings and state ---------- */
const SIZE = 11, T = 48, W = SIZE * T;           // 11x11 grid, 48px tiles
const EMPTY = 0, PILLAR = 1, DESK = 2;           // tile types stored in the grid matrix
const START_LIVES = 3, PROF_COUNT = 3, TIME_LIMIT = 150;   // seconds per run
const FUSE = 2.4, BLAST_TIME = 0.5, BLAST_RANGE = 2, MAX_NOTEBOOKS = 2;
const PTS_DESK = 50, PTS_PROF = 200, PTS_CLEAR = 1000;
const ROLL_KEY = 'passorblast_honor_roll', NAME_KEY = 'passorblast_last_name', ROLL_MAX = 10;
const PRAISE = ['Great Job!', 'Awesome!', 'Nice!'];
const INK = '#0b1630';
const DIRS = { up:{x:0,y:-1}, down:{x:0,y:1}, left:{x:-1,y:0}, right:{x:1,y:0} };
const DIR_LIST = Object.values(DIRS);
const KEYDIR = { ArrowUp:'up', KeyW:'up', ArrowDown:'down', KeyS:'down',
                 ArrowLeft:'left', KeyA:'left', ArrowRight:'right', KeyD:'right' };
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const E = { pillar:'\u{1F3DB}\uFE0F', desk:'\u{1FA91}', book:'\u{1F4D3}', boom:'\u{1F4A5}',
            student:'\u{1F9D1}\u200D\u{1F393}', prof:'\u{1F468}\u200D\u{1F3EB}' };

const $ = s => document.querySelector(s);
const canvas = $('#board'), ctx = canvas.getContext('2d');
const stageEl = $('#stage'), toastEl = $('#toast');
const loginModal = $('#loginModal'), resultModal = $('#resultModal'), resultCard = $('#resultCard');
const nameInput = $('#nameInput'), nameError = $('#nameError');
const hud = { name:$('#hudName'), score:$('#hudScore'), lives:$('#hudLives'), time:$('#hudTime'), profs:$('#hudProfs') };
const dpr = Math.min(window.devicePixelRatio || 1, 2);       // sharp canvas on phones
canvas.width = W * dpr; canvas.height = W * dpr;

let state = 'login';            // login | playing | cleared | over
let grid = [], notebooks = [], blasts = [], professors = [], floaters = [];
let student = null;
let studentName = 'Student';
let score = 0, lives = START_LIVES, timeLeft = TIME_LIMIT, profsGraded = 0;
let shake = 0, clearTimer = 0, overAt = 0, time = 0, tensionT = 0, toastTimer = 0, lastShown = -1;
const held = [];                // directions currently held, last pressed wins

const rand = n => Math.floor(Math.random() * n);
const fmtTime = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

/* ---------- Safe storage (falls back to memory if localStorage is blocked) ---------- */
const memory = {};
function storeSet(key, value) {
  memory[key] = value;
  try { localStorage.setItem(key, value); } catch (e) { /* keep the in-memory copy */ }
}
function storeGet(key) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? (memory[key] ?? null) : v;
  } catch (e) { return memory[key] ?? null; }
}

/* ---------- 2. Audio and voice cues ---------- */
let audio = null, soundOn = true, noiseBuf = null;

function ensureAudio() {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch (e) { audio = null; }
}
function beep(freq, dur, type = 'square', vol = 0.05, slide = 0) {
  if (!soundOn || !audio) return;
  const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(audio.destination);
  o.start(t); o.stop(t + dur);
}
// Spoken voice cues ("Great Job!", "You lose") using the browser's built-in voices
function speak(text, pitch = 1, rate = 1) {
  if (!soundOn || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.pitch = pitch; u.rate = rate; u.lang = 'en-US';
    window.speechSynthesis.speak(u);
  } catch (e) { /* voice not available, the beeps still play */ }
}
// Ruler smacking a hand: a short burst of noise plus a low thump
function rulerSmack() {
  stageEl.classList.add('smack');
  setTimeout(() => stageEl.classList.remove('smack'), 130);
  if (!soundOn || !audio) return;
  if (!noiseBuf) {
    noiseBuf = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.12), audio.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  }
  const src = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
  src.buffer = noiseBuf;
  f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 0.8;
  g.gain.value = 0.55;
  src.connect(f); f.connect(g); g.connect(audio.destination);
  src.start();
  beep(180, 0.09, 'sine', 0.14, -100);
}
function sfx(name) {
  switch (name) {
    case 'tick':  beep(240, .07, 'square', .05); break;
    case 'boom':  beep(140, .35, 'sawtooth', .08, -100); break;
    case 'crack': beep(300, .06, 'square', .04, -120); break;
    case 'cheer': [660, 880, 1100].forEach((f, i) => setTimeout(() => beep(f, .1, 'square', .05), i * 80)); break;
    case 'hurt':  beep(220, .4, 'sawtooth', .07, -160); break;
    case 'win':   [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, .16, 'square', .05), i * 120)); break;
    case 'lose':  [392, 330, 262, 196].forEach((f, i) => setTimeout(() => beep(f, .2, 'square', .05), i * 170)); break;
  }
}

/* ---------- HUD and messages ---------- */
function updateHud() {
  hud.name.textContent = studentName;
  hud.score.textContent = score;
  hud.lives.textContent = lives > 0 ? '\u2665'.repeat(lives) : '0';
  hud.profs.textContent = professors.length;
}
function updateClock() {
  const shown = Math.ceil(Math.max(0, timeLeft));
  if (shown === lastShown) return;
  lastShown = shown;
  hud.time.textContent = fmtTime(shown);
  hud.time.parentElement.classList.toggle('low', shown <= 20 && state === 'playing');
}
function toast(msg, ms = 1500) {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;                      // restart the pop animation
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}
function addScore(n, x, y, text) {
  score += n;
  if (x !== undefined) floaters.push({ x, y, text: text || '+' + n, t: 1 });
  updateHud();
}

/* ---------- 3. Level setup ---------- */
function resetStudent() {
  student = { x:1, y:1, tx:1, ty:1, moving:false, dir:DIRS.down, invuln:0, speed:4.2 };
}

function buildLevel() {
  grid = [];
  for (let y = 0; y < SIZE; y++) {
    const row = [];
    for (let x = 0; x < SIZE; x++) {
      if (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1) row.push(PILLAR);   // outer walls
      else if (x % 2 === 0 && y % 2 === 0) row.push(PILLAR);                           // inner pillars
      else if (x + y <= 3) row.push(EMPTY);                                            // safe corner for the student
      else row.push(Math.random() < 0.55 ? DESK : EMPTY);                              // desks and chairs
    }
    grid.push(row);
  }
  notebooks = []; blasts = []; floaters = []; professors = [];
  resetStudent();

  // place professors far from the student and away from each other
  let tries = 0;
  while (professors.length < PROF_COUNT && tries++ < 2000) {
    const x = 1 + rand(SIZE - 2), y = 1 + rand(SIZE - 2);
    if (grid[y][x] === PILLAR || x + y < 10) continue;
    if (professors.some(p => Math.abs(p.x - x) + Math.abs(p.y - y) < 4)) continue;
    grid[y][x] = EMPTY;
    professors.push({ x, y, tx:x, ty:y, moving:false, dir:null, speed:1.6 });
  }
}

/* ---------- 4. Movement helpers ---------- */
function canWalk(x, y, isStudent) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return false;
  if (grid[y][x] !== EMPTY) return false;
  for (const n of notebooks) {
    if (n.x === x && n.y === y && (!isStudent || n.solid)) return false;
  }
  return true;
}

// Slides an entity from tile to tile (always locked to grid coordinates)
function stepMover(e, dt, chooseDir) {
  let remaining = e.speed * dt;
  while (remaining > 0) {
    if (!e.moving) {
      const d = chooseDir(e);
      if (!d) break;
      e.tx = e.x + d.x; e.ty = e.y + d.y; e.dir = d; e.moving = true;
    }
    const len = Math.abs(e.tx - e.x) + Math.abs(e.ty - e.y);
    if (remaining >= len) {
      remaining -= len; e.x = e.tx; e.y = e.ty; e.moving = false;
    } else {
      e.x += Math.sign(e.tx - e.x) * remaining;
      e.y += Math.sign(e.ty - e.y) * remaining;
      remaining = 0;
    }
  }
}

function studentDir(s) {
  for (let i = held.length - 1; i >= 0; i--) {
    const d = DIRS[held[i]];
    if (canWalk(s.x + d.x, s.y + d.y, true)) return d;
  }
  return null;
}

function profDir(p) {
  const opts = DIR_LIST.filter(d => canWalk(p.x + d.x, p.y + d.y, false));
  if (!opts.length) return null;
  if (Math.random() < 0.2) {                                   // sometimes walk toward the student
    const dist = d => Math.abs(p.x + d.x - student.x) + Math.abs(p.y + d.y - student.y);
    return opts.slice().sort((a, b) => dist(a) - dist(b))[0];
  }
  if (p.dir) {
    const straight = opts.find(d => d.x === p.dir.x && d.y === p.dir.y);
    if (straight && Math.random() < 0.75) return straight;
    const noBack = opts.filter(d => !(d.x === -p.dir.x && d.y === -p.dir.y));
    if (noBack.length) return noBack[rand(noBack.length)];
  }
  return opts[rand(opts.length)];
}

/* ---------- Notebooks and blasts ---------- */
function dropNotebook() {
  if (state !== 'playing') return;
  const cx = Math.round(student.x), cy = Math.round(student.y);
  if (notebooks.length >= MAX_NOTEBOOKS) return;
  if (notebooks.some(n => n.x === cx && n.y === cy)) return;
  notebooks.push({ x:cx, y:cy, timer:FUSE, solid:false, done:false });
  sfx('tick');
}

function addBlast(x, y, center) { blasts.push({ x, y, t:BLAST_TIME, center:!!center }); }

function detonate(n) {
  n.done = true;
  sfx('boom');
  shake = Math.max(shake, 0.12);
  addBlast(n.x, n.y, true);
  for (const d of DIR_LIST) {                                  // up, down, left, right
    for (let i = 1; i <= BLAST_RANGE; i++) {
      const x = n.x + d.x * i, y = n.y + d.y * i;
      const tile = grid[y][x];
      if (tile === PILLAR) break;                              // pillars stop the blast
      if (tile === DESK) {                                     // desks break (+50) and stop the blast
        grid[y][x] = EMPTY;
        addScore(PTS_DESK, x, y, '+' + PTS_DESK);
        sfx('crack');
        addBlast(x, y);
        break;
      }
      addBlast(x, y);
      for (const o of notebooks) if (!o.done && o.x === x && o.y === y) o.timer = 0;   // chain reaction
    }
  }
}

/* ---------- 6. Update (game rules) ---------- */
function hurtStudent(reason, force) {
  if (state !== 'playing' || (student.invuln > 0 && !force)) return;
  lives--;
  shake = 0.35;
  sfx('hurt');
  speak('You lose', 0.35, 0.75);                               // fighting-game style cue
  updateHud();
  if (lives <= 0) { endGame(false); return; }                  // LOSE: all lives gone
  toast(reason);
  student.x = student.tx = 1; student.y = student.ty = 1;
  student.moving = false; student.invuln = 2.2;
}

function update(dt) {
  time += dt;
  blasts.forEach(b => b.t -= dt);
  blasts = blasts.filter(b => b.t > 0);
  floaters.forEach(f => f.t -= dt * 1.1);
  floaters = floaters.filter(f => f.t > 0);
  shake = Math.max(0, shake - dt);
  if (state === 'login' || state === 'over') return;

  // notebooks tick down and explode (chain reactions repeat the loop)
  notebooks.forEach(n => n.timer -= dt);
  let again = true;
  while (again) {
    again = false;
    for (const n of notebooks) {
      if (!n.done && n.timer <= 0) { detonate(n); again = true; }
    }
  }
  notebooks = notebooks.filter(n => !n.done);

  if (state === 'cleared') {
    clearTimer -= dt;
    if (clearTimer <= 0) endGame(true);
    return;
  }

  // countdown clock: running out of time costs a life
  timeLeft -= dt;
  if (timeLeft <= 0) {
    timeLeft = TIME_LIMIT;
    hurtStudent("Time's up!", true);
    if (state !== 'playing') return;
  }
  updateClock();

  // student
  student.invuln = Math.max(0, student.invuln - dt);
  stepMover(student, dt, studentDir);
  for (const n of notebooks) {                                 // a notebook turns solid once you step off it
    if (!n.solid && (Math.abs(student.x - n.x) > 0.95 || Math.abs(student.y - n.y) > 0.95)) n.solid = true;
  }

  // professors get faster as fewer remain
  const speed = 1.6 + 0.3 * profsGraded;
  for (const p of professors) { p.speed = speed; stepMover(p, dt, profDir); }

  // blast damage: grade professors, hurt the student
  let praised = false;
  for (const b of blasts) {
    professors = professors.filter(p => {
      if (Math.round(p.x) === b.x && Math.round(p.y) === b.y) {
        const word = PRAISE[rand(PRAISE.length)];
        profsGraded++;
        addScore(PTS_PROF, p.x, p.y, word + '\n+' + PTS_PROF);
        if (!praised) { praised = true; sfx('cheer'); speak(word, 1.4, 1.05); }
        return false;
      }
      return true;
    });
    if (Math.round(student.x) === b.x && Math.round(student.y) === b.y) hurtStudent('Caught in your own blast!');
  }
  if (state !== 'playing') return;
  if (praised) updateHud();

  // a professor touching the student
  if (student.invuln <= 0) {
    for (const p of professors) {
      if (Math.hypot(p.x - student.x, p.y - student.y) < 0.6) { hurtStudent('Caught by faculty!'); break; }
    }
  }
  if (state !== 'playing') return;

  // WIN: every professor graded
  if (professors.length === 0) {
    state = 'cleared';
    clearTimer = 1.6;
    addScore(PTS_CLEAR, student.x, student.y, 'Semester cleared!\n+' + PTS_CLEAR);
    toast('Semester cleared!', 1700);
    sfx('win');
    speak('You pass!', 1.3, 1);
    return;
  }

  // ruler-smack tension cue: faster as fewer professors remain
  if (professors.length < PROF_COUNT) {
    tensionT -= dt;
    if (tensionT <= 0) {
      rulerSmack();
      tensionT = 0.5 + 1.5 * ((professors.length - 1) / Math.max(1, PROF_COUNT - 1));
    }
  }
}

/* ---------- 5. Honor roll (localStorage) ---------- */
const byScore = (a, b) => b.score - a.score || (a.date || 0) - (b.date || 0);

function loadRoll() {
  try {
    const data = JSON.parse(storeGet(ROLL_KEY) || '[]');
    if (!Array.isArray(data)) return [];
    return data.filter(e => e && typeof e.name === 'string' && typeof e.score === 'number').sort(byScore);
  } catch (e) { return []; }
}

// Saves the run, keeps the list sorted, and returns the player's rank (0 = not in the top list)
function recordScore(name, finalScore, passed) {
  const roll = loadRoll();
  const entry = { name, score:finalScore, passed, date:Date.now() };
  roll.push(entry);
  roll.sort(byScore);
  const top = roll.slice(0, ROLL_MAX);
  storeSet(ROLL_KEY, JSON.stringify(top));
  renderRoll();
  return top.indexOf(entry) + 1;
}

function renderRoll() {
  const list = $('#honorList'), roll = loadRoll();
  list.textContent = '';
  $('#honorEmpty').hidden = roll.length > 0;
  $('#clearRollBtn').hidden = roll.length === 0;
  roll.forEach((e, i) => {
    const li = document.createElement('li');
    if (i === 0) li.className = 'first';                       // gold styling for 1st place
    const rank = document.createElement('span');
    rank.className = 'rank'; rank.textContent = i + 1;
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = (i === 0 ? '\u{1F451} ' : '') + e.name;  // textContent keeps names safe
    const meta = document.createElement('small');
    meta.textContent = (i === 0 ? 'Top scholar \u00B7 ' : '') + (e.passed ? 'Passed' : 'Retaking');
    who.appendChild(meta);
    const pts = document.createElement('span');
    pts.className = 'pts'; pts.textContent = e.score;
    li.append(rank, who, pts);
    list.appendChild(li);
  });
}

/* ---------- Game flow ---------- */
function endGame(win) {
  state = 'over';
  overAt = performance.now();
  held.length = 0;
  const rank = recordScore(studentName, score, win);
  hud.time.parentElement.classList.remove('low');
  clearTimeout(toastTimer);
  toastEl.classList.remove('show');

  resultCard.className = 'card result ' + (win ? 'win' : 'lose');
  $('#grade').textContent = win ? 'A+' : 'F';
  $('#resultTitle').textContent = win ? 'Semester passed!' : 'Game over';
  $('#resultMsg').textContent = win
    ? 'Well done, ' + studentName + '! Every professor has been graded.'
    : 'You ran out of lives, ' + studentName + '. Time to retake the semester.';
  $('#resultScore').textContent = score;
  $('#resultProfs').textContent = profsGraded + '/' + PROF_COUNT;
  $('#rankLine').textContent = rank === 1 ? 'New #1 on the Dean\u2019s Lister Honor Roll!'
    : rank > 0 ? 'You are #' + rank + ' on the Dean\u2019s Lister Honor Roll.'
    : 'Not on the honor roll this time. Try again!';
  resultModal.hidden = false;
  sfx(win ? 'win' : 'lose');
  setTimeout(() => $('#againBtn').focus(), 800);
}

function beginRun() {                                          // used by Start game AND Play again
  ensureAudio();
  score = 0; lives = START_LIVES; timeLeft = TIME_LIMIT; profsGraded = 0;
  tensionT = 0; lastShown = -1; held.length = 0;
  buildLevel();
  student.invuln = 1.5;
  loginModal.hidden = true;
  resultModal.hidden = true;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  state = 'playing';
  updateHud(); updateClock();
  toast('Go, ' + studentName + '!');
}

function showLogin() {
  state = 'login';
  held.length = 0;
  resultModal.hidden = true;
  loginModal.hidden = false;
  buildLevel(); updateHud();
  if (window.matchMedia && window.matchMedia('(pointer:fine)').matches) nameInput.focus();
}

function submitLogin(e) {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) {
    nameError.textContent = 'Please type your name to log in.';
    nameInput.classList.remove('bad'); void nameInput.offsetWidth; nameInput.classList.add('bad');
    nameInput.focus();
    return;
  }
  nameError.textContent = '';
  studentName = name;
  storeSet(NAME_KEY, name);
  beginRun();
}

/* ---------- 7. Drawing ---------- */
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function box(x, y, w, h, r, fill, stroke) {
  rr(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke(); }
}
function emoji(ch, cx, cy, size) {
  ctx.font = size + 'px ' + EMOJI_FONT;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText(ch, cx, cy);
}
function shadowAt(cx, cy, rx, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, rx * 0.4, 0, 0, Math.PI * 2); ctx.fill();
}

function drawPillar(px, py) {
  ctx.fillStyle = '#586179'; ctx.fillRect(px, py, T, T);
  ctx.fillStyle = '#a3adc2'; ctx.fillRect(px, py, T, 4); ctx.fillRect(px, py, 4, T);
  ctx.fillStyle = '#3a4258'; ctx.fillRect(px, py + T - 5, T, 5); ctx.fillRect(px + T - 5, py, 5, T);
  ctx.fillStyle = '#7a859d'; ctx.fillRect(px + 7, py + 7, T - 14, T - 14);
  emoji(E.pillar, px + T / 2, py + T / 2 + 2, 28);
}
function drawDesk(px, py) {
  box(px + 2, py + 2, T - 4, T - 4, 6, '#8a5a2b', true);
  box(px + 5, py + 5, T - 10, T - 16, 4, '#c98f52');
  ctx.strokeStyle = 'rgba(122,78,38,.55)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px + 9, py + 12); ctx.lineTo(px + T - 9, py + 12);
  ctx.moveTo(px + 9, py + 19); ctx.lineTo(px + T - 9, py + 19);
  ctx.stroke();
  emoji(E.desk, px + T / 2, py + T / 2 + 5, 26);
}

function drawNotebook(n) {
  const cx = n.x * T + T / 2, cy = n.y * T + T / 2 + 2;
  const pulse = 1 + 0.1 * Math.sin(time * (n.timer < 1 ? 24 : 10));
  shadowAt(cx, cy + 16, 15, 'rgba(11,22,48,.3)');
  emoji(E.book, cx, cy, 32 * pulse);
  // ticking countdown badge
  ctx.beginPath(); ctx.arc(cx + 14, cy - 14, 9, 0, Math.PI * 2);
  ctx.fillStyle = '#c62f2f'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = '700 12px "Courier New",monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(Math.max(1, Math.ceil(n.timer))), cx + 14, cy - 13);
}

function drawBlast(b) {
  const px = b.x * T, py = b.y * T;
  ctx.globalAlpha = Math.min(1, b.t / 0.25);
  box(px + 3, py + 3, T - 6, T - 6, 10, '#ff5a2c');
  box(px + 9, py + 9, T - 18, T - 18, 8, '#ffa21f');
  box(px + 16, py + 16, T - 32, T - 32, 5, '#fff3a8');
  if (b.center) emoji(E.boom, px + T / 2, py + T / 2 + 2, 30);
  ctx.globalAlpha = 1;
}

function drawProfessor(p) {
  const cx = p.x * T + T / 2, cy = p.y * T + T / 2 + Math.sin(time * 8 + p.tx * 3) * 1.5;
  shadowAt(cx, cy + 17, 16, 'rgba(198,47,47,.55)');
  emoji(E.prof, cx, cy, 36);
}

function drawStudent() {
  if (student.invuln > 0 && Math.floor(time * 12) % 2 === 0) return;     // blink while protected
  const cx = student.x * T + T / 2, cy = student.y * T + T / 2;
  shadowAt(cx, cy + 17, 15, 'rgba(30,90,255,.5)');
  emoji(E.student, cx, cy, 36);
}

function drawFloaters() {
  ctx.font = '700 15px "Courier New",monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeStyle = INK; ctx.fillStyle = '#fff';
  for (const f of floaters) {
    const lines = f.text.split('\n');
    const x = Math.min(W - 52, Math.max(52, f.x * T + T / 2));
    const y0 = f.y * T + T / 2 - (1 - f.t) * 34;
    ctx.globalAlpha = Math.min(1, f.t * 2.5);
    lines.forEach((line, i) => {
      ctx.strokeText(line, x, y0 + i * 17); ctx.fillText(line, x, y0 + i * 17);
    });
  }
  ctx.globalAlpha = 1;
}

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, W);
  if (!grid.length) return;
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - .5) * 14 * shake, (Math.random() - .5) * 14 * shake);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const px = x * T, py = y * T, tile = grid[y][x];
      ctx.fillStyle = (x + y) % 2 ? '#efe3c2' : '#e6d8b3';     // classroom floor tiles
      ctx.fillRect(px, py, T, T);
      if (tile === PILLAR) drawPillar(px, py);
      else if (tile === DESK) drawDesk(px, py);
      else if (y > 0 && grid[y - 1][x] !== EMPTY) {              // soft shadow under walls and desks
        ctx.fillStyle = 'rgba(11,22,48,.13)'; ctx.fillRect(px, py, T, 8);
      }
    }
  }
  notebooks.forEach(drawNotebook);
  blasts.forEach(drawBlast);
  professors.forEach(drawProfessor);
  drawStudent();
  drawFloaters();
  ctx.restore();
}

/* ---------- Main loop ---------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

/* ---------- 8. Input, buttons and start-up ---------- */
function pressDir(d) { if (!held.includes(d)) held.push(d); }
function releaseDir(d) { const i = held.indexOf(d); if (i > -1) held.splice(i, 1); }

// Keyboard: arrows / WASD to move, Space to drop a notebook
window.addEventListener('keydown', e => {
  const live = state === 'playing' || state === 'cleared';
  const d = KEYDIR[e.code];
  if (d && live) { e.preventDefault(); pressDir(d); return; }
  if (e.code === 'Space' && live) {
    e.preventDefault();
    if (!e.repeat) dropNotebook();
    return;
  }
  if (e.code === 'Enter' && state === 'over' && e.target.tagName !== 'BUTTON'
      && performance.now() - overAt > 700) beginRun();
});
window.addEventListener('keyup', e => { const d = KEYDIR[e.code]; if (d) releaseDir(d); });
window.addEventListener('blur', () => { held.length = 0; });

// Virtual D-pad (touch + mouse)
document.querySelectorAll('[data-dir]').forEach(btn => {
  const d = btn.dataset.dir;
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    pressDir(d); btn.classList.add('active');
  });
  const release = () => { releaseDir(d); btn.classList.remove('active'); };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => btn.addEventListener(ev, release));
  btn.addEventListener('contextmenu', e => e.preventDefault());
});

// Drop Assignment button (touch + mouse)
const dropBtn = $('#dropBtn');
dropBtn.addEventListener('pointerdown', e => { e.preventDefault(); dropBtn.classList.add('active'); dropNotebook(); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => dropBtn.addEventListener(ev, () => dropBtn.classList.remove('active')));
dropBtn.addEventListener('contextmenu', e => e.preventDefault());

// Buttons
$('#loginForm').addEventListener('submit', submitLogin);
nameInput.addEventListener('input', () => { nameError.textContent = ''; nameInput.classList.remove('bad'); });
$('#againBtn').addEventListener('click', beginRun);
$('#changeBtn').addEventListener('click', showLogin);
$('#muteBtn').addEventListener('click', e => {
  soundOn = !soundOn;
  if (!soundOn && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  e.currentTarget.textContent = soundOn ? '\u{1F50A}' : '\u{1F507}';
  e.currentTarget.setAttribute('aria-label', soundOn ? 'Turn sound off' : 'Turn sound on');
});
$('#clearRollBtn').addEventListener('click', () => {
  if (window.confirm('Clear the whole honor roll?')) { storeSet(ROLL_KEY, '[]'); renderRoll(); }
});

// Start-up: show the login modal over an idle classroom, with the honor roll already loaded
nameInput.value = storeGet(NAME_KEY) || '';
renderRoll();
showLogin();
requestAnimationFrame(frame);
})();

