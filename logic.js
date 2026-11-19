/* logic.js — 纯逻辑，不依赖 DOM，可在 Node 下自测 */
(function (root) {
  'use strict';

  function rectsIntersect(a, b) {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  function clamp(v, min, max) {
    if (v < min) return min;
    if (v > max) return max;
    return v;
  }

  function lerp(from, to, t) {
    return from + (to - from) * t;
  }

  function spawnInterval(elapsedMs) {
    return 700;
  }

  function applyDamage(lives) {
    return lives > 0 ? lives - 1 : 0;
  }

  function healLives(lives, maxLives) {
    var next = lives + 1;
    return next > maxLives ? maxLives : next;
  }

  function addShield(shield, maxShield) {
    var next = shield + 1;
    return next > maxShield ? maxShield : next;
  }

  function nextBest(score, best) {
    return score > best ? score : best;
  }

  /** 升到下一级所需经验：6 / 9 / 12 / 15 */
  function powerExpNeeded(power) {
    return 6 + (power - 1) * 3;
  }

  /** 单次击杀提供的经验 */
  function killExp(kind) {
    if (kind === 'boss') return 15;
    if (kind === 'elite') return 3;
    return 1;
  }

  var api = {
    rectsIntersect: rectsIntersect,
    clamp: clamp,
    lerp: lerp,
    spawnInterval: spawnInterval,
    applyDamage: applyDamage,
    healLives: healLives,
    addShield: addShield,
    nextBest: nextBest,
    powerExpNeeded: powerExpNeeded,
    killExp: killExp
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.GeoLogic = api;
  }
})(typeof window !== 'undefined' ? window : this);
