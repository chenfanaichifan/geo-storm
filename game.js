/* game.js — 渲染与游戏循环
 * Phase 3.3 火力升级
 * Phase 3.4 敌机行为分化 + 分数补给 + 弹幕形态
 */
(function () {
  'use strict';

  var L = window.GeoLogic;

  var W = 360;
  var H = 640;

  var START_LIVES = 3;
  var MAX_LIVES = 5;
  var MAX_SHIELD = 3;
  var MAX_BOMBS = 4;
  var INVULN_TIME = 1.2;
  var RAPID_SECONDS = 4;
  var FIRE_GAP_NORMAL = 170;
  var FIRE_GAP_RAPID = 80;
  var START_BOMBS = 2;
  var BOMB_ELITE_DAMAGE = 6;
  var BOMB_BOSS_DAMAGE = 12;

  var SUPPLY_EVERY = 100;

  var SLOW_DURATION = 0.6;
  var SLOW_SCALE = 0.25;
  var FREEZE_RATIO = 0.15;
  var FREEZE_SCALE = 0.05;

  var FIRST_WAVE_DELAY = 0.9;
  var BETWEEN_WAVE_GAP = 0.9;
  var BANNER_TIME = 1.2;
  var BOSS_EVERY = 10;
  var BOSS_HP = 70;
  var BOSS_W = 132;
  var BOSS_H = 92;
  var BOSS_SWAY = 92;
  var BULLET_CAP = 280;

  var RUSHER_INIT_SPEED = 90;
  var RUSHER_ACCEL = 820;

  // 各类敌机的尺寸与血量
  var SIZE_OF = {
    small: 28,
    weaver: 28,
    shielded: 32,
    splitter: 30,
    mini: 16,
    elite: 44,
    rusher: 22
  };
  var HP_OF = {
    small: 1,
    weaver: 1,
    shielded: 2,
    splitter: 1,
    mini: 1,
    elite: 5,
    rusher: 1
  };

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best');
  var livesEl = document.getElementById('lives');
  var powEl = document.getElementById('pow');
  var overlay = document.getElementById('overlay');
  var finalScoreEl = document.getElementById('final-score');
  var finalBestEl = document.getElementById('final-best');
  var bombBtn = document.getElementById('bomb');
  var bombCountEl = document.getElementById('bomb-count');

  var BEST_KEY = 'geoStormBest';
  var best = 0;
  try {
    best = Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch (err) {
    best = 0;
  }

  var state = null;

  function fitCanvas() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function updateLives() {
    for (var i = 0; i < livesEl.children.length; i++) {
      livesEl.children[i].classList.toggle('off', i >= state.lives);
    }
  }

  function updateBombs() {
    bombCountEl.textContent = String(state.bombs);
    bombBtn.disabled = state.bombs <= 0;
  }

  function updatePow() {
    var wave = Math.max(1, state.waveIndex);
    powEl.textContent = 'W' + wave;
    powEl.classList.toggle('max', wave >= BOSS_EVERY);
  }

  function reset() {
    state = {
      mode: 'playing',
      score: 0,
      lives: START_LIVES,
      shield: 0,
      rapid: 0,
      bombs: START_BOMBS,
      nextSupply: SUPPLY_EVERY,
      invuln: 0,
      elapsed: 0,
      flash: 0,
      timeScale: 1,
      slowTimer: 0,
      banner: 0,
      bannerText: '',
      waveIndex: 0,
      waveActive: false,
      waveGap: FIRST_WAVE_DELAY,
      player: { x: W / 2, y: H - 90, w: 26, h: 26, tx: W / 2, ty: H - 90 },
      bullets: [],
      enemyBullets: [],
      enemies: [],
      pickups: [],
      particles: [],
      explosions: [],
      fireTimer: 0,
      shake: 0
    };
    scoreEl.textContent = '0';
    bestEl.textContent = String(best);
    updateLives();
    updateBombs();
    updatePow();
    overlay.hidden = true;
  }

  // 触屏上把目标点上移，避免飞机被手指遮住
  var TOUCH_LIFT = 46;
  var coarsePointer = !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  function pointerToGame(e) {
    var rect = canvas.getBoundingClientRect();
    var gy = ((e.clientY - rect.top) / rect.height) * H;
    if (coarsePointer) gy -= TOUCH_LIFT;
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: gy
    };
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (state.mode === 'over') reset();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* 某些环境不支持指针捕获 */
    }
    var p = pointerToGame(e);
    state.player.tx = p.x;
    state.player.ty = p.y;
  });

  canvas.addEventListener('pointermove', function (e) {
    if (state.mode !== 'playing') return;
    if (!e.buttons) return;
    var p = pointerToGame(e);
    state.player.tx = p.x;
    state.player.ty = p.y;
  });

  function pushEnemyBullet(b) {
    if (state.enemyBullets.length >= BULLET_CAP) return;
    state.enemyBullets.push(b);
  }

  function pushEnemy(spec) {
    var kind = spec.kind;
    var isBoss = kind === 'boss';
    var isRusher = kind === 'rusher';

    var w = isBoss ? BOSS_W : SIZE_OF[kind] || 28;
    var h = isBoss ? BOSS_H : SIZE_OF[kind] || 28;
    // 小兵血量随波次变厚，分裂残渣保持 1 血
    var waveExtra = Math.min(5, Math.floor(state.waveIndex / 4));
    var baseHp = HP_OF[kind] || 1;
    var hp = isBoss
      ? BOSS_HP
      : kind === 'mini'
        ? baseHp
        : baseHp + waveExtra;

    state.enemies.push({
      kind: kind,
      x: spec.tx - w / 2,
      y: spec.startY !== undefined ? spec.startY : -h,
      w: w,
      h: h,
      tx: spec.tx - w / 2,
      ty: spec.ty - h / 2,
      entering: true,
      hp: hp,
      maxHp: hp,
      canFire: isBoss || kind === 'elite' || Math.random() < 0.75,
      fireTimer: 900 + Math.random() * 1200,
      hitFlash: 0,
      bobPhase: Math.random() * Math.PI * 2,
      phase: isRusher ? 'wait' : 'idle',
      waitTimer: 0.7 + Math.random() * 0.5,
      vx: 0,
      vy: 0,
      ax: 0,
      ay: 0,
      bossPhase: 1,
      movePhase: 0,
      spiralAngle: 0,
      summonTimer: 9
    });
  }

  /** 按波数逐步引入新敌机类型 */
  function pickKind(index) {
    if (index < 3) return 'small';
    var r = Math.random();
    if (r < 0.28) return 'weaver';
    if (r < 0.46) return 'shielded';
    if (r < 0.62) return 'splitter';
    return 'small';
  }

  function buildWave(index) {
    if (index % BOSS_EVERY === 0) {
      pushEnemy({ kind: 'boss', tx: W / 2, ty: 132, startY: -140 });
      return;
    }

    var count = Math.min(9, 3 + Math.floor(index / 2));
    var cols = count <= 4 ? 2 : 3;
    var rows = Math.ceil(count / cols);
    var gapX = W / (cols + 1);
    var startY = 118;
    var gapY = Math.min(80, 190 / Math.max(1, rows));

    for (var i = 0; i < count; i++) {
      var r = Math.floor(i / cols);
      var c = i % cols;
      var kind = index % 3 === 0 && i === 0 ? 'elite' : pickKind(index);
      pushEnemy({
        kind: kind,
        tx: gapX * (c + 1),
        ty: startY + r * gapY,
        startY: -70 - i * 24
      });
    }

    var rushers = Math.min(5, 2 + Math.floor(index / 3));
    for (var r2 = 0; r2 < rushers; r2++) {
      var side = r2 % 2 === 0 ? 64 : W - 64;
      pushEnemy({
        kind: 'rusher',
        tx: side + (Math.random() - 0.5) * 36,
        ty: 140 + Math.random() * 50,
        startY: -60 - r2 * 30
      });
    }
  }

  function startWave() {
    state.waveIndex += 1;
    state.waveActive = true;
    buildWave(state.waveIndex);

    var isBoss = state.waveIndex % BOSS_EVERY === 0;
    var areaChanged = state.waveIndex > 1 && (state.waveIndex - 1) % BG_SWITCH_EVERY === 0;
    state.banner = BANNER_TIME;
    state.bannerText = areaChanged
      ? 'AREA ' + (Math.floor((state.waveIndex - 1) / BG_SWITCH_EVERY) + 1)
      : isBoss
        ? 'WARNING'
        : 'WAVE ' + state.waveIndex;
    updatePow();
  }

  function spawnParticles(cx, cy, color) {
    for (var i = 0; i < 6; i++) {
      var angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.6;
      var speed = 60 + Math.random() * 90;
      state.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.35,
        t: 0.35,
        color: color || '#ffd166'
      });
    }
  }

  function spawnMushroomParticles(cx, cy) {
    for (var i = 0; i < 34; i++) {
      var life = 0.9 + Math.random() * 0.9;
      var side = Math.random() < 0.5 ? -1 : 1;
      state.particles.push({
        x: cx + (Math.random() - 0.5) * 46,
        y: cy - Math.random() * 26,
        vx: side * (10 + Math.random() * 55) * (0.4 + Math.random()),
        vy: -90 - Math.random() * 220,
        life: life,
        t: life,
        color: Math.random() < 0.45 ? '#fff0d0' : Math.random() < 0.6 ? '#ffb35c' : '#8c7b70'
      });
    }
  }

  function createExplosion(cx, cy) {
    var puffs = [];
    var n = 11;
    for (var i = 0; i < n; i++) {
      puffs.push({
        ang: (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.36,
        dist: 0.52 + Math.random() * 0.46,
        r: 0.2 + Math.random() * 0.17,
        dy: (Math.random() - 0.5) * 0.34,
        a: 0.22 + Math.random() * 0.26,
        phase: Math.random() * Math.PI * 2
      });
    }
    state.explosions.push({
      x: cx,
      y: cy,
      t: 0,
      life: 1.3,
      puffs: puffs
    });
    spawnMushroomParticles(cx, cy);
  }

  var PICKUP_TYPES = ['heal', 'shield', 'rapid'];
  var PICKUP_COLORS = { heal: '#6ef08a', shield: '#6ec8ff', rapid: '#ffd166' };
  var PICKUP_LABELS = { heal: 'H', shield: 'S', rapid: 'R' };

  function dropPickup(cx, cy, force) {
    if (!force && Math.random() > 0.85) return;
    var type = PICKUP_TYPES[Math.floor(Math.random() * PICKUP_TYPES.length)];
    state.pickups.push({
      x: cx - 7 + (Math.random() - 0.5) * 24,
      y: cy - 7,
      w: 14,
      h: 14,
      vy: 90,
      type: type,
      ttl: 10
    });
  }

  /** 每 100 分补给一次：优先补炸弹，其次回血，都满则加分 */
  function checkSupply() {
    if (state.score < state.nextSupply) return;

    state.nextSupply += SUPPLY_EVERY;

    if (state.bombs < MAX_BOMBS) {
      state.bombs += 1;
      updateBombs();
      state.bannerText = 'SUPPLY +BOMB';
    } else if (state.lives < MAX_LIVES) {
      state.lives += 1;
      updateLives();
      state.bannerText = 'SUPPLY +LIFE';
    } else {
      state.score += 5;
      state.bannerText = 'SUPPLY +BONUS';
    }

    state.banner = 1.0;
    state.shake = Math.max(state.shake, 0.12);
    spawnParticles(state.player.x, state.player.y, '#ffd166');
  }

  function killEnemy(en) {
    var cx = en.x + en.w / 2;
    var cy = en.y + en.h / 2;

    if (en.kind === 'boss') {
      spawnParticles(cx, cy, '#ff9f43');
      for (var b = 0; b < 3; b++) dropPickup(cx, cy, true);
      state.score += 50;
      state.shake = Math.max(state.shake, 0.4);
    } else if (en.kind === 'elite') {
      spawnParticles(cx, cy, '#ff9f43');
      dropPickup(cx, cy);
      state.score += 5;
      state.shake = Math.max(state.shake, 0.2);
    } else {
      var color = en.kind === 'rusher' || en.kind === 'splitter' ? '#ff8a3d' : '#ffd166';
      spawnParticles(cx, cy, color);
      state.score += 1;
      state.shake = Math.max(state.shake, 0.1);
    }

    // 分裂机死亡后裂成两个小怪
    if (en.kind === 'splitter') {
      for (var s = 0; s < 2; s++) {
        pushEnemy({
          kind: 'mini',
          tx: cx + (s === 0 ? -17 : 17),
          ty: cy + 26,
          startY: cy
        });
      }
    }
  }

  function applyPickup(type) {
    if (type === 'heal') {
      if (state.lives >= MAX_LIVES) {
        state.score += 1;
      } else {
        state.lives = L.healLives(state.lives, MAX_LIVES);
        updateLives();
      }
    } else if (type === 'shield') {
      state.shield = L.addShield(state.shield, MAX_SHIELD);
    } else if (type === 'rapid') {
      state.rapid = RAPID_SECONDS;
    }
    state.shake = Math.max(state.shake, 0.08);
    scoreEl.textContent = String(state.score);
  }

  function hitPlayer() {
    if (state.invuln > 0 || state.mode !== 'playing') return;

    if (state.shield > 0) {
      state.shield -= 1;
      state.invuln = 0.4;
      state.shake = 0.16;
      return;
    }

    state.lives = L.applyDamage(state.lives);
    state.invuln = INVULN_TIME;
    state.shake = 0.24;
    updateLives();
    if (state.lives <= 0) gameOver();
  }

  function useBomb() {
    if (state.mode !== 'playing' || state.bombs <= 0) return;

    state.bombs -= 1;
    state.enemyBullets.length = 0;
    state.flash = 0.28;
    state.shake = 0.5;

    state.slowTimer = SLOW_DURATION;
    createExplosion(W / 2, H * 0.62);

    var survivors = [];
    for (var i = 0; i < state.enemies.length; i++) {
      var en = state.enemies[i];
      if (en.kind === 'boss') {
        en.hp -= BOMB_BOSS_DAMAGE;
        en.hitFlash = 0.15;
        if (en.hp > 0) survivors.push(en);
        else killEnemy(en);
      } else if (en.kind === 'elite') {
        en.hp -= BOMB_ELITE_DAMAGE;
        en.hitFlash = 0.12;
        if (en.hp > 0) survivors.push(en);
        else killEnemy(en);
      } else {
        killEnemy(en);
      }
    }
    state.enemies = survivors;

    updateBombs();
    scoreEl.textContent = String(state.score);
  }

  bombBtn.addEventListener('click', function () {
    useBomb();
    bombBtn.blur();
  });

  window.addEventListener('keydown', function (e) {
    if (e.code !== 'Space') return;
    if (document.activeElement === bombBtn) return;
    e.preventDefault();
    useBomb();
  });

  function gameOver() {
    state.mode = 'over';
    state.flash = 0;
    state.timeScale = 1;
    state.slowTimer = 0;
    state.explosions.length = 0;

    var newBest = L.nextBest(state.score, best);
    best = newBest;
    try {
      localStorage.setItem(BEST_KEY, String(best));
    } catch (err) {
      /* 存不进去也不影响本局 */
    }
    finalScoreEl.textContent = String(state.score);
    finalBestEl.textContent = String(best);
    bestEl.textContent = String(best);
    overlay.hidden = false;
  }

  /** 固定单发：火力不再随击杀增长，难度只靠敌人变厚 */
  function firePlayerBullets() {
    state.bullets.push({
      x: state.player.x - 2,
      y: state.player.y - 16,
      w: 4,
      h: 14,
      vx: 0,
      vy: -620
    });
  }

  /** 瞄准单发 */
  function fireAimed(en) {
    var sx = en.x + en.w / 2;
    var sy = en.y + en.h;
    var dx = state.player.x - sx;
    var dy = state.player.y - sy;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var spd = 195;

    pushEnemyBullet({
      x: sx - 2,
      y: sy,
      w: 4,
      h: 10,
      vx: (dx / len) * spd,
      vy: (dy / len) * spd
    });
  }

  /** 以玩家方位为中心的扇形散射 */
  function fireFan(en, count, spread, speed) {
    var cx = en.x + en.w / 2;
    var cy = en.y + en.h;
    var base = Math.atan2(state.player.y - cy, state.player.x - cx);

    for (var i = 0; i < count; i++) {
      var ang = base + (i - (count - 1) / 2) * spread;
      pushEnemyBullet({
        x: cx - 2,
        y: cy,
        w: 4,
        h: 10,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed
      });
    }
  }

  /** 按敌机类型选择弹幕形态 */
  function enemyFire(en) {
    if (en.kind === 'weaver') {
      fireFan(en, 3, 0.2, 190);
    } else if (en.kind === 'shielded') {
      fireFan(en, 5, 0.34, 185);
    } else if (en.kind === 'elite') {
      fireFan(en, 5, 0.3, 200);
    } else if (en.kind === 'mini') {
      if (Math.random() < 0.5) fireAimed(en);
    } else {
      fireAimed(en);
    }
  }

  function bossFan(en, count, spread, speed) {
    var cx = en.x + en.w / 2;
    var cy = en.y + en.h - 6;
    for (var i = 0; i < count; i++) {
      var t = count === 1 ? 0.5 : i / (count - 1);
      var ang = Math.PI / 2 + (t - 0.5) * spread;
      pushEnemyBullet({
        x: cx - 3,
        y: cy,
        w: 6,
        h: 12,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed
      });
    }
  }

  function bossAimed(en, count, speed) {
    var cx = en.x + en.w / 2;
    var cy = en.y + en.h - 6;
    var base = Math.atan2(state.player.y - cy, state.player.x - cx);
    for (var i = 0; i < count; i++) {
      var ang = base + (i - (count - 1) / 2) * 0.26;
      pushEnemyBullet({
        x: cx - 3,
        y: cy,
        w: 5,
        h: 11,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed
      });
    }
  }

  function bossSpiral(en) {
    en.spiralAngle += 0.44;
    var cx = en.x + en.w / 2;
    var cy = en.y + en.h - 8;
    for (var k = 0; k < 2; k++) {
      var ang = Math.PI / 2 + Math.sin(en.spiralAngle + k * Math.PI) * 1.15;
      pushEnemyBullet({
        x: cx - 3,
        y: cy,
        w: 5,
        h: 11,
        vx: Math.cos(ang) * 178,
        vy: Math.sin(ang) * 178
      });
    }
  }

  function summonRushers(en) {
    var leftX = Math.max(30, en.x - 16);
    var rightX = Math.min(W - 30, en.x + en.w + 16);
    pushEnemy({ kind: 'rusher', tx: leftX, ty: en.y + en.h + 30, startY: en.y + en.h });
    pushEnemy({ kind: 'rusher', tx: rightX, ty: en.y + en.h + 30, startY: en.y + en.h });
  }

  function chargeRusher(en) {
    var cx = en.x + en.w / 2;
    var cy = en.y + en.h / 2;
    var dx = state.player.x - cx;
    var dy = state.player.y - cy;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;

    en.phase = 'charge';
    en.vx = (dx / len) * RUSHER_INIT_SPEED;
    en.vy = (dy / len) * RUSHER_INIT_SPEED;
    en.ax = (dx / len) * RUSHER_ACCEL;
    en.ay = (dy / len) * RUSHER_ACCEL;
    en.waitTimer = 0;
    state.shake = Math.max(state.shake, 0.06);
  }

  function updateWaves(dt) {
    if (!state.waveActive) {
      state.waveGap -= dt;
      if (state.waveGap <= 0) startWave();
      return;
    }
    if (state.enemies.length === 0) {
      state.waveActive = false;
      state.waveGap = BETWEEN_WAVE_GAP;
    }
  }

  function updateBoss(en, dt) {
    var ratio = en.hp / en.maxHp;
    var nextPhase = ratio > 0.65 ? 1 : ratio > 0.3 ? 2 : 3;
    if (nextPhase !== en.bossPhase) {
      en.bossPhase = nextPhase;
      en.fireTimer = 0.25;
      state.shake = Math.max(state.shake, 0.25);
      spawnParticles(en.x + en.w / 2, en.y + en.h / 2, '#ffffff');
    }

    en.movePhase += dt;
    en.x = (W - en.w) / 2 + Math.sin(en.movePhase * 0.9) * BOSS_SWAY;
    en.y = en.ty + Math.sin(en.movePhase * 1.3) * 7;

    if (en.bossPhase >= 2) {
      en.summonTimer -= dt;
      if (en.summonTimer <= 0) {
        en.summonTimer = en.bossPhase === 3 ? 7 : 9.5;
        summonRushers(en);
      }
    }

    en.fireTimer -= dt * 1000;
    if (en.fireTimer > 0) return;

    if (en.bossPhase === 1) {
      bossFan(en, 5, 0.95, 195);
      en.fireTimer = 1150;
    } else if (en.bossPhase === 2) {
      bossFan(en, 7, 1.2, 205);
      if (Math.random() < 0.55) bossAimed(en, 3, 245);
      en.fireTimer = 900;
    } else {
      bossSpiral(en);
      if (Math.random() < 0.45) bossFan(en, 5, 1.35, 215);
      en.fireTimer = 430;
    }
  }

  function update(realDt) {
    if (state.mode !== 'playing') return;

    if (state.slowTimer > 0) {
      state.slowTimer = Math.max(0, state.slowTimer - realDt);
      var prog = 1 - state.slowTimer / SLOW_DURATION;
      if (prog < FREEZE_RATIO) {
        state.timeScale = FREEZE_SCALE;
      } else {
        var t = (prog - FREEZE_RATIO) / (1 - FREEZE_RATIO);
        state.timeScale = SLOW_SCALE + (1 - SLOW_SCALE) * t;
      }
    } else {
      state.timeScale = 1;
    }

    var dt = realDt * state.timeScale;

    state.elapsed += dt;
    if (state.invuln > 0) state.invuln = Math.max(0, state.invuln - dt);
    if (state.rapid > 0) state.rapid = Math.max(0, state.rapid - dt);

    if (state.flash > 0) state.flash = Math.max(0, state.flash - realDt);
    if (state.shake > 0) state.shake = Math.max(0, state.shake - realDt);
    if (state.banner > 0) state.banner = Math.max(0, state.banner - realDt);

    var x;
    for (x = state.explosions.length - 1; x >= 0; x--) {
      var ex = state.explosions[x];
      ex.t += realDt;
      if (ex.t >= ex.life) state.explosions.splice(x, 1);
    }

    var k = Math.min(1, dt * 18);
    state.player.x = L.lerp(state.player.x, state.player.tx, k);
    state.player.y = L.lerp(state.player.y, state.player.ty, k);
    state.player.x = L.clamp(state.player.x, state.player.w / 2, W - state.player.w / 2);
    state.player.y = L.clamp(state.player.y, 40, H - 20);

    var fireGap = state.rapid > 0 ? FIRE_GAP_RAPID : FIRE_GAP_NORMAL;
    state.fireTimer -= dt * 1000;
    if (state.fireTimer <= 0) {
      state.fireTimer = fireGap;
      firePlayerBullets();
    }

    updateWaves(dt);

    var i;
    for (i = state.bullets.length - 1; i >= 0; i--) {
      var b = state.bullets[i];
      b.x += (b.vx || 0) * dt;
      b.y += b.vy * dt;
      if (b.y + b.h < 0 || b.x < -20 || b.x > W + 20) state.bullets.splice(i, 1);
    }

    var playerBox = {
      x: state.player.x - state.player.w / 2,
      y: state.player.y - state.player.h / 2,
      w: state.player.w,
      h: state.player.h
    };

    for (var j = state.enemies.length - 1; j >= 0; j--) {
      var en = state.enemies[j];
      if (en.hitFlash > 0) en.hitFlash = Math.max(0, en.hitFlash - dt);

      if (en.kind === 'rusher') {
        if (en.entering) {
          var rk = Math.min(1, dt * 7);
          en.x = L.lerp(en.x, en.tx, rk);
          en.y = L.lerp(en.y, en.ty, rk);
          if (Math.abs(en.x - en.tx) < 1.2 && Math.abs(en.y - en.ty) < 1.2) {
            en.x = en.tx;
            en.y = en.ty;
            en.entering = false;
          }
        } else if (en.phase === 'wait') {
          en.waitTimer -= dt;
          if (en.waitTimer <= 0) chargeRusher(en);
        } else {
          en.vx += en.ax * dt;
          en.vy += en.ay * dt;
          en.x += en.vx * dt;
          en.y += en.vy * dt;

          if (en.y > H + 40 || en.x < -60 || en.x > W + 60) {
            state.enemies.splice(j, 1);
            continue;
          }
        }
      } else if (en.kind === 'boss') {
        if (en.entering) {
          var bk = Math.min(1, dt * 4);
          en.y = L.lerp(en.y, en.ty, bk);
          en.x = L.lerp(en.x, en.tx, bk);
          if (Math.abs(en.y - en.ty) < 1.5 && Math.abs(en.x - en.tx) < 1.5) {
            en.x = en.tx;
            en.y = en.ty;
            en.entering = false;
            en.fireTimer = 900;
          }
        } else {
          updateBoss(en, dt);
        }
      } else {
        if (en.entering) {
          var ek = Math.min(1, dt * 7);
          en.x = L.lerp(en.x, en.tx, ek);
          en.y = L.lerp(en.y, en.ty, ek);
          if (Math.abs(en.x - en.tx) < 1.2 && Math.abs(en.y - en.ty) < 1.2) {
            en.x = en.tx;
            en.y = en.ty;
            en.entering = false;
          }
        } else {
          // 摆动机在阵位附近左右横移
          if (en.kind === 'weaver') {
            en.x = en.tx + Math.sin(state.elapsed * 2.2 + en.bobPhase) * 24;
          }
          en.y = en.ty + Math.sin(state.elapsed * 1.7 + en.bobPhase) * 3;
        }

        if (!en.entering && en.canFire && en.y > 0) {
          en.fireTimer -= dt * 1000;
          if (en.fireTimer <= 0) {
            enemyFire(en);
            en.fireTimer = 2000 + Math.random() * 1600;
          }
        }
      }

      if (state.invuln <= 0 && L.rectsIntersect(playerBox, en)) {
        spawnParticles(en.x + en.w / 2, en.y + en.h / 2, '#ff5d73');
        var keep = en.kind === 'boss';
        if (!keep) state.enemies.splice(j, 1);
        hitPlayer();
        if (state.mode === 'over') return;
        if (!keep) continue;
      }

      for (var k2 = state.bullets.length - 1; k2 >= 0; k2--) {
        if (L.rectsIntersect(state.bullets[k2], en)) {
          state.bullets.splice(k2, 1);
          en.hp -= 1;
          en.hitFlash = 0.08;

          if (en.hp <= 0) {
            killEnemy(en);
            state.enemies.splice(j, 1);
          }
          break;
        }
      }
    }

    for (var e = state.enemyBullets.length - 1; e >= 0; e--) {
      var eb = state.enemyBullets[e];
      eb.x += (eb.vx || 0) * dt;
      eb.y += eb.vy * dt;

      if (eb.y > H + 30 || eb.x < -30 || eb.x > W + 30) {
        state.enemyBullets.splice(e, 1);
        continue;
      }

      if (state.invuln <= 0 && L.rectsIntersect(playerBox, eb)) {
        state.enemyBullets.splice(e, 1);
        hitPlayer();
        if (state.mode === 'over') return;
      }
    }

    for (var q = state.pickups.length - 1; q >= 0; q--) {
      var pk = state.pickups[q];
      pk.y += pk.vy * dt;
      pk.ttl -= dt;

      if (pk.ttl <= 0 || pk.y > H + 20) {
        state.pickups.splice(q, 1);
        continue;
      }

      if (L.rectsIntersect(playerBox, pk)) {
        applyPickup(pk.type);
        spawnParticles(pk.x + 7, pk.y + 7, PICKUP_COLORS[pk.type]);
        state.pickups.splice(q, 1);
      }
    }

    for (var p = state.particles.length - 1; p >= 0; p--) {
      var pt = state.particles[p];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.t -= dt;
      if (pt.t <= 0) state.particles.splice(p, 1);
    }

    checkSupply();

    scoreEl.textContent = String(state.score);
  }

  function easeOut(x) {
    var c = Math.min(1, Math.max(0, x));
    return 1 - Math.pow(1 - c, 3);
  }

  function drawExplosion(ex) {
    var p = ex.t / ex.life;
    if (p >= 1) return;

    var cx = ex.x;
    var cy = ex.y;
    var fade = 1 - p;

    var dustGrow = easeOut(p * 1.15);
    ctx.beginPath();
    ctx.ellipse(cx, cy + 5, 32 + 165 * dustGrow, 8 + 30 * dustGrow, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(122, 108, 98, ' + fade * 0.38 + ')';
    ctx.fill();

    var stemGrow = easeOut(p / 0.42);
    var stemH = 152 * stemGrow;
    var baseW = 34 * (1 - p * 0.22);
    var topW = 22 * (1 - p * 0.35);
    var topY = cy - stemH;

    if (stemH > 3 && baseW > 2) {
      ctx.beginPath();
      ctx.moveTo(cx - baseW / 2, cy);
      ctx.lineTo(cx - topW / 2, topY);
      ctx.lineTo(cx + topW / 2, topY);
      ctx.lineTo(cx + baseW / 2, cy);
      ctx.closePath();

      var stemGrad = ctx.createLinearGradient(cx - baseW / 2, 0, cx + baseW / 2, 0);
      stemGrad.addColorStop(0, 'rgba(108, 94, 86, 0)');
      stemGrad.addColorStop(0.26, 'rgba(186, 128, 92, ' + fade * 0.34 + ')');
      stemGrad.addColorStop(0.5, 'rgba(255, 206, 145, ' + fade * 0.6 + ')');
      stemGrad.addColorStop(0.74, 'rgba(186, 128, 92, ' + fade * 0.34 + ')');
      stemGrad.addColorStop(1, 'rgba(108, 94, 86, 0)');
      ctx.fillStyle = stemGrad;
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 234, 200, ' + fade * 0.16 + ')';
      ctx.lineWidth = 1;
      for (var s = 1; s <= 5; s++) {
        var ratio = s / 6.4;
        var sy = cy - stemH * ratio;
        var sw = topW + (baseW - topW) * (1 - ratio);
        ctx.beginPath();
        ctx.moveTo(cx - sw / 2, sy);
        ctx.lineTo(cx + sw / 2, sy);
        ctx.stroke();
      }
    }

    var capGrow = easeOut(Math.max(0, (p - 0.12) / 0.68));
    var capW = 50 + 122 * capGrow;
    var capH = capW * 0.5;
    var rise = 20 * capGrow;
    var capY = cy - stemH - capH * 0.62 - rise;

    if (capW > 8) {
      var capGrad = ctx.createRadialGradient(
        cx, capY - capH * 0.25, capW * 0.04,
        cx, capY, capW * 1.02
      );
      capGrad.addColorStop(0, 'rgba(255, 248, 226, ' + fade * 0.86 + ')');
      capGrad.addColorStop(0.32, 'rgba(255, 196, 112, ' + fade * 0.72 + ')');
      capGrad.addColorStop(0.66, 'rgba(212, 116, 60, ' + fade * 0.52 + ')');
      capGrad.addColorStop(1, 'rgba(92, 78, 72, 0)');
      ctx.beginPath();
      ctx.ellipse(cx, capY, capW, capH, 0, 0, Math.PI * 2);
      ctx.fillStyle = capGrad;
      ctx.fill();

      var puffs = ex.puffs || [];
      for (var i = 0; i < puffs.length; i++) {
        var pf = puffs[i];
        var wob = Math.sin(pf.phase + p * 7) * 0.05;
        var dist = (pf.dist + wob) * capW;
        var px = cx + Math.cos(pf.ang) * dist;
        var py = capY + Math.sin(pf.ang) * dist * 0.44 + pf.dy * capH;
        var pr = capW * pf.r * (0.45 + 0.55 * capGrow);

        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 176, 104, ' + fade * pf.a + ')';
        ctx.fill();
      }

      if (p < 0.34) {
        var coreA = 1 - p / 0.34;
        var coreR = capW * (0.3 + 0.42 * coreA);
        var coreGrad = ctx.createRadialGradient(cx, capY, 0, cx, capY, coreR);
        coreGrad.addColorStop(0, 'rgba(255, 255, 252, ' + coreA * 0.95 + ')');
        coreGrad.addColorStop(0.45, 'rgba(255, 238, 180, ' + coreA * 0.55 + ')');
        coreGrad.addColorStop(1, 'rgba(255, 196, 120, 0)');
        ctx.beginPath();
        ctx.arc(cx, capY, coreR, 0, Math.PI * 2);
        ctx.fillStyle = coreGrad;
        ctx.fill();
      }

      if (p < 0.6) {
        ctx.beginPath();
        ctx.ellipse(cx, capY - capH * 0.3, capW * 0.72, capH * 0.45, 0, Math.PI, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 244, 214, ' + (1 - p / 0.6) * 0.35 + ')';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  function drawBossBar(en) {
    var bw = W - 56;
    var bx = 28;
    var by = 48;
    var bh = 7;
    var ratio = Math.max(0, en.hp / en.maxHp);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = en.bossPhase === 3 ? '#ff3b5c' : '#ff5d73';
    ctx.fillRect(bx, by, bw * ratio, bh);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fillRect(bx + bw * 0.3, by, 1, bh);
    ctx.fillRect(bx + bw * 0.65, by, 1, bh);

    ctx.font = 'bold 9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#ff9fb0';
    ctx.fillText('BOSS  PHASE ' + (en.bossPhase || 1), bx, by - 4);
  }

  function drawEnemy(en) {
    if (en.kind === 'boss') {
      var pulse = en.bossPhase === 3 && Math.floor(state.elapsed * 9) % 2 === 0;
      var body = en.hitFlash > 0 || pulse
        ? '#ffffff'
        : en.bossPhase === 3 ? '#a01a2a' : en.bossPhase === 2 ? '#8e1f45' : '#7d1a2b';
      var core = en.hitFlash > 0 ? '#ffffff' : en.bossPhase === 3 ? '#ff3b5c' : '#ff5d73';

      ctx.fillStyle = body;
      ctx.fillRect(en.x, en.y, en.w, en.h);

      ctx.fillStyle = core;
      ctx.fillRect(en.x + en.w * 0.28, en.y + en.h * 0.22, en.w * 0.44, en.h * 0.34);

      ctx.fillStyle = en.hitFlash > 0 ? '#ffffff' : '#c9344a';
      ctx.fillRect(en.x + 12, en.y + en.h, 14, 16);
      ctx.fillRect(en.x + en.w - 26, en.y + en.h, 14, 16);
      return;
    }

    if (en.kind === 'rusher') {
      var warn = en.phase === 'wait' && en.waitTimer < 0.3 && Math.floor(en.waitTimer * 20) % 2 === 0;
      ctx.save();
      ctx.translate(en.x + en.w / 2, en.y + en.h / 2);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = en.hitFlash > 0 || warn ? '#ffffff' : en.phase === 'charge' ? '#ff6b2c' : '#ff8a3d';
      ctx.fillRect(-en.w / 2, -en.h / 2, en.w, en.h);
      ctx.restore();
      return;
    }

    if (en.kind === 'splitter') {
      // 橙色方框 + 内部十字，提示会分裂
      ctx.fillStyle = en.hitFlash > 0 ? '#ffffff' : '#ff8a3d';
      ctx.fillRect(en.x, en.y, en.w, en.h);
      ctx.strokeStyle = 'rgba(11, 15, 26, 0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(en.x + en.w / 2, en.y + 4);
      ctx.lineTo(en.x + en.w / 2, en.y + en.h - 4);
      ctx.moveTo(en.x + 4, en.y + en.h / 2);
      ctx.lineTo(en.x + en.w - 4, en.y + en.h / 2);
      ctx.stroke();
      return;
    }

    if (en.kind === 'weaver') {
      // 紫色菱形，提示会横移
      ctx.save();
      ctx.translate(en.x + en.w / 2, en.y + en.h / 2);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = en.hitFlash > 0 ? '#ffffff' : '#a06cff';
      ctx.fillRect(-en.w / 2 + 3, -en.h / 2 + 3, en.w - 6, en.h - 6);
      ctx.restore();
      return;
    }

    if (en.kind === 'shielded') {
      ctx.fillStyle = en.hitFlash > 0 ? '#ffffff' : '#c9344a';
      ctx.fillRect(en.x, en.y, en.w, en.h);
      if (en.hp >= 2) {
        ctx.strokeStyle = 'rgba(110, 200, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.strokeRect(en.x - 2, en.y - 2, en.w + 4, en.h + 4);
      }
      return;
    }

    if (en.kind === 'mini') {
      ctx.fillStyle = en.hitFlash > 0 ? '#ffffff' : '#ffb36b';
      ctx.fillRect(en.x, en.y, en.w, en.h);
      return;
    }

    if (en.kind === 'elite') {
      ctx.fillStyle = en.hitFlash > 0 ? '#ffffff' : '#c9344a';
      ctx.fillRect(en.x, en.y, en.w, en.h);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(en.x + 6, en.y + 6, en.w - 12, en.h - 12);
      return;
    }

    ctx.fillStyle = en.hitFlash > 0 ? '#ffffff' : '#ff5d73';
    ctx.fillRect(en.x, en.y, en.w, en.h);
  }

  // 三张背景按波次轮换：每 15 波换一张，循环
  var BG_IMAGES = ['bg1.jpg', 'bg2.jpg', 'bg3.jpg'];
  var BG_SWITCH_EVERY = 15;
  var bgImages = [];
  var bgReady = [];
  for (var bi = 0; bi < BG_IMAGES.length; bi++) {
    (function (idx) {
      bgReady[idx] = false;
      var img = new Image();
      img.onload = function () { bgReady[idx] = true; };
      img.onerror = function () { bgReady[idx] = false; };
      img.src = BG_IMAGES[idx];
      bgImages[idx] = img;
    })(bi);
  }

  function bgIndexForWave() {
    var area = Math.floor((Math.max(1, state.waveIndex) - 1) / BG_SWITCH_EVERY);
    return area % BG_IMAGES.length;
  }

  var stars = [];
  for (var si = 0; si < 80; si++) {
    stars.push({
      x: Math.random() * W,
      y0: Math.random() * H,
      z: 0.25 + Math.random() * 0.75,
      r: Math.random() < 0.78 ? 1 : 2
    });
  }

  function drawBackground() {
    var idx = bgIndexForWave();
    if (bgReady[idx] && bgImages[idx]) {
      var img = bgImages[idx];
      var scale = Math.max(W / img.width, H / img.height);
      var dw = img.width * scale;
      var dh = img.height * scale;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.fillStyle = 'rgba(5, 7, 13, 0.55)';
      ctx.fillRect(0, 0, W, H);
      return;
    }

    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#070b16');
    g.addColorStop(0.55, '#0b1220');
    g.addColorStop(1, '#05070d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    var boost = 1 + state.waveIndex * 0.03;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var y = (s.y0 + state.elapsed * (18 + s.z * 62) * boost) % H;
      ctx.globalAlpha = 0.22 + s.z * 0.5;
      ctx.fillStyle = '#9fd4ff';
      ctx.fillRect(s.x, y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    var v = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.2, W / 2, H * 0.45, H * 0.82);
    v.addColorStop(0, 'rgba(0, 0, 0, 0)');
    v.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  function drawPlayer() {
    var rapid = state.rapid > 0;

    ctx.save();
    ctx.translate(state.player.x, state.player.y);

    var flame = 7 + Math.sin(state.elapsed * 34) * 2 + (rapid ? 5 : 0);
    ctx.fillStyle = rapid ? 'rgba(255, 224, 102, 0.85)' : 'rgba(126, 232, 255, 0.85)';
    ctx.beginPath();
    ctx.moveTo(-3.5, 9);
    ctx.lineTo(0, 9 + flame);
    ctx.lineTo(3.5, 9);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, -17);
    ctx.lineTo(-14, 7);
    ctx.lineTo(-5, 3.5);
    ctx.lineTo(0, 9);
    ctx.lineTo(5, 3.5);
    ctx.lineTo(14, 7);
    ctx.closePath();
    ctx.fillStyle = rapid ? '#d6ff7a' : '#8ef0a8';
    ctx.fill();
    ctx.strokeStyle = 'rgba(5, 7, 13, 0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -17);
    ctx.lineTo(3.2, -2);
    ctx.lineTo(0, 9);
    ctx.lineTo(-3.2, -2);
    ctx.closePath();
    ctx.fillStyle = rapid ? '#f4ffc2' : '#d4ffe2';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, -4.5, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#0b0f1a';
    ctx.fill();

    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawBackground();

    ctx.save();
    if (state.shake > 0) {
      var s = state.shake * 10;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    ctx.fillStyle = state.rapid > 0 ? '#ffe066' : '#7ee8ff';
    var i;
    for (i = 0; i < state.bullets.length; i++) {
      var b = state.bullets[i];
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }

    for (i = 0; i < state.enemies.length; i++) {
      drawEnemy(state.enemies[i]);
    }

    ctx.fillStyle = '#ff9f43';
    for (i = 0; i < state.enemyBullets.length; i++) {
      var eb = state.enemyBullets[i];
      ctx.fillRect(eb.x, eb.y, eb.w, eb.h);
    }

    ctx.font = 'bold 9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (i = 0; i < state.pickups.length; i++) {
      var pk = state.pickups[i];
      ctx.fillStyle = PICKUP_COLORS[pk.type];
      ctx.fillRect(pk.x, pk.y, pk.w, pk.h);
      ctx.fillStyle = '#05070d';
      ctx.fillText(PICKUP_LABELS[pk.type], pk.x + 7, pk.y + 8);
    }

    if (state.mode !== 'over') {
      var blink = state.invuln > 0 && Math.floor(state.invuln * 12) % 2 === 0;
      ctx.globalAlpha = blink ? 0.3 : 1;

      drawPlayer();

      if (state.shield > 0) {
        ctx.beginPath();
        ctx.arc(state.player.x, state.player.y, 20, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(110, 200, 255, ' + (0.3 + state.shield * 0.22) + ')';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
    }

    for (i = 0; i < state.particles.length; i++) {
      var pt = state.particles[i];
      ctx.globalAlpha = Math.max(0, pt.t / pt.life);
      ctx.fillStyle = pt.color || '#ffd166';
      ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    for (i = 0; i < state.enemies.length; i++) {
      if (state.enemies[i].kind === 'boss') {
        drawBossBar(state.enemies[i]);
        break;
      }
    }

    if (state.banner > 0) {
      var ba = Math.min(1, state.banner / 0.45);
      ctx.globalAlpha = ba;
      ctx.font = 'bold 18px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = state.bannerText === 'WARNING' ? '#ff5d73' : '#8ba3c7';
      ctx.fillText(state.bannerText, W / 2, H * 0.68);
      ctx.globalAlpha = 1;
    }

    for (i = 0; i < state.explosions.length; i++) {
      drawExplosion(state.explosions[i]);
    }

    if (state.flash > 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, ' + ((state.flash / 0.28) * 0.4) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  var lastTs = 0;

  function frame(ts) {
    if (!lastTs) lastTs = ts;
    var realDt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;

    update(realDt);
    draw();
    requestAnimationFrame(frame);
  }

  fitCanvas();
  window.addEventListener('resize', fitCanvas);
  reset();
  requestAnimationFrame(frame);
})();
