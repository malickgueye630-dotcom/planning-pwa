(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  // DOM
  const hudScore = document.getElementById("scoreValue");
  const overlay = document.getElementById("overlay");
  const panelTitle = document.getElementById("panelTitle");
  const panelSub = document.getElementById("panelSub");
  const panelStats = document.getElementById("panelStats");
  const finalScoreEl = document.getElementById("finalScore");
  const bestScoreEl = document.getElementById("bestScore");
  const playBtn = document.getElementById("playBtn");
  const playBtnLabel = document.getElementById("playBtnLabel");
  const pauseBtn = document.getElementById("pauseBtn");

  // ---- config ----
  const TARGET_CELL = 26;          // approx px per cell on screen
  const MIN_COLS = 11, MAX_COLS = 26;
  const START_INTERVAL = 170;      // ms per step
  const MIN_INTERVAL = 80;
  const SPEEDUP_PER_FOOD = 4;
  const HS_KEY = "neon-snake-best";

  // ---- responsive grid ----
  let W = 0, H = 0, dpr = 1;
  let cols = 0, rows = 0, cell = 0, offX = 0, offY = 0, topPad = 0;

  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // reserve space under the HUD (score) so the snake never hides behind it
    const safeTop = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue("--safe-top")) || 0;
    topPad = safeTop + 76;

    cols = Math.max(MIN_COLS, Math.min(MAX_COLS, Math.round(W / TARGET_CELL)));
    cell = W / cols;
    const playH = H - topPad - cell * 0.5;
    rows = Math.max(8, Math.floor(playH / cell));
    offX = (W - cols * cell) / 2;
    offY = topPad + (playH - rows * cell) / 2;
  }

  // ---- game state ----
  let state = "start"; // start | playing | paused | gameover
  let snake;           // array of {x,y}, head first
  let prevSnake;       // positions before last step (for interpolation)
  let dir, pendingDir;
  let food;
  let score, best, interval, lastStep;
  let particles = [];
  let shake = 0;
  let muted = false;

  best = parseInt(localStorage.getItem(HS_KEY) || "0", 10) || 0;

  function resetGame() {
    const cx = Math.floor(cols / 2);
    const cy = Math.floor(rows / 2);
    snake = [
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
    ];
    prevSnake = snake.map((s) => ({ ...s }));
    dir = { x: 1, y: 0 };
    pendingDir = null;
    score = 0;
    interval = START_INTERVAL;
    lastStep = 0;
    particles = [];
    shake = 0;
    placeFood();
    hudScore.textContent = "0";
  }

  function placeFood() {
    const occ = new Set(snake.map((s) => s.x + "," + s.y));
    let x, y, guard = 0;
    do {
      x = Math.floor(Math.random() * cols);
      y = Math.floor(Math.random() * rows);
    } while (occ.has(x + "," + y) && guard++ < 500);
    food = { x, y, born: performance.now() };
  }

  // ---- audio ----
  let audioCtx = null;
  function beep(freq, dur, type = "sine", vol = 0.05) {
    if (muted) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type; osc.frequency.value = freq;
      osc.connect(g).connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.start(t); osc.stop(t + dur);
    } catch (e) { /* ignore */ }
  }
  function vibrate(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }
  const sfx = {
    eat: () => { beep(660, 0.07, "triangle", 0.06); beep(990, 0.09, "sine", 0.04); vibrate(12); },
    over: () => { beep(200, 0.3, "sawtooth", 0.05); vibrate([30, 40, 60]); },
    start: () => { beep(523, 0.08, "sine", 0.05); beep(784, 0.1, "sine", 0.04); },
  };

  // ---- input ----
  const DIRS = {
    up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
    left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
  };
  function requestDir(name) {
    const d = DIRS[name];
    if (!d || state !== "playing") return;
    const ref = pendingDir || dir;
    if (d.x === -ref.x && d.y === -ref.y) return; // no instant reverse
    pendingDir = d;
  }

  const KEYMAP = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    w: "up", s: "down", a: "left", d: "right", z: "up", q: "left",
  };
  window.addEventListener("keydown", (e) => {
    if (KEYMAP[e.key]) { e.preventDefault(); requestDir(KEYMAP[e.key]); }
    else if (e.key === " ") { e.preventDefault(); togglePause(); }
    else if (e.key === "Enter") { e.preventDefault(); primaryAction(); }
  });

  // swipe — works mid-drag, allows several turns per gesture
  let tStart = null;
  const SWIPE_MIN = 22;
  canvas.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    tStart = { x: t.clientX, y: t.clientY };
  }, { passive: false });
  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (!tStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - tStart.x;
    const dy = t.clientY - tStart.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
    if (Math.abs(dx) > Math.abs(dy)) requestDir(dx > 0 ? "right" : "left");
    else requestDir(dy > 0 ? "down" : "up");
    tStart = { x: t.clientX, y: t.clientY };
  }, { passive: false });
  canvas.addEventListener("touchend", () => { tStart = null; }, { passive: true });

  pauseBtn.addEventListener("click", togglePause);
  playBtn.addEventListener("click", primaryAction);

  function primaryAction() {
    if (state === "playing") return;
    startGame();
  }

  function togglePause() {
    if (state === "playing") {
      state = "paused";
      showOverlay("PAUSE", "Reprenez quand vous voulez.", "REPRENDRE", false);
    } else if (state === "paused") {
      hideOverlay();
      state = "playing";
      lastStep = performance.now();
    }
  }

  function startGame() {
    layout();
    resetGame();
    hideOverlay();
    state = "playing";
    lastStep = performance.now();
    sfx.start();
  }

  function gameOver() {
    state = "gameover";
    shake = 16;
    if (score > best) { best = score; localStorage.setItem(HS_KEY, String(best)); }
    sfx.over();
    setTimeout(() => {
      showOverlay("GAME<span>OVER</span>", "", "REJOUER", true);
    }, 420);
  }

  // ---- overlay helpers ----
  function showOverlay(titleHTML, sub, btnLabel, withStats) {
    panelTitle.innerHTML = titleHTML;
    panelSub.textContent = sub || "";
    panelSub.hidden = !sub;
    playBtnLabel.textContent = btnLabel;
    panelStats.hidden = !withStats;
    if (withStats) {
      finalScoreEl.textContent = score;
      bestScoreEl.textContent = best;
    }
    overlay.classList.remove("hidden");
  }
  function hideOverlay() { overlay.classList.add("hidden"); }

  // ---- update ----
  function step() {
    if (pendingDir) { dir = pendingDir; pendingDir = null; }
    prevSnake = snake.map((s) => ({ ...s }));
    const head = snake[0];
    const nx = head.x + dir.x;
    const ny = head.y + dir.y;

    if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) return gameOver();
    // ignore the current tail cell (it will move away) unless we're growing
    const willGrow = (nx === food.x && ny === food.y);
    const body = willGrow ? snake : snake.slice(0, -1);
    if (body.some((s) => s.x === nx && s.y === ny)) return gameOver();

    snake.unshift({ x: nx, y: ny });
    if (willGrow) {
      score += 1;
      interval = Math.max(MIN_INTERVAL, interval - SPEEDUP_PER_FOOD);
      hudScore.textContent = score;
      hudScore.classList.remove("pop");
      void hudScore.offsetWidth;
      hudScore.classList.add("pop");
      spawnParticles(food.x, food.y);
      sfx.eat();
      placeFood();
    } else {
      snake.pop();
    }
  }

  function spawnParticles(gx, gy) {
    const cx = offX + (gx + 0.5) * cell;
    const cy = offY + (gy + 0.5) * cell;
    for (let i = 0; i < 14; i++) {
      const a = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
      const sp = 1.5 + Math.random() * 2.5;
      particles.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1 });
    }
  }

  // ---- render ----
  const lerp = (a, b, t) => a + (b - a) * t;

  function drawRoundCellCenter(gx, gy) {
    return { x: offX + (gx + 0.5) * cell, y: offY + (gy + 0.5) * cell };
  }

  function render(now) {
    ctx.clearRect(0, 0, W, H);

    // background
    const g = ctx.createRadialGradient(W / 2, H * 0.38, 0, W / 2, H * 0.38, Math.max(W, H) * 0.8);
    g.addColorStop(0, "#0b1020");
    g.addColorStop(1, "#05060a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // playfield subtle frame + grid dots
    ctx.save();
    let sx = 0, sy = 0;
    if (shake > 0) { sx = (Math.random() - 0.5) * shake; sy = (Math.random() - 0.5) * shake; shake *= 0.85; if (shake < 0.5) shake = 0; }
    ctx.translate(sx, sy);

    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    ctx.strokeRect(offX, offY, cols * cell, rows * cell);
    ctx.fillStyle = "rgba(255,255,255,0.035)";
    for (let i = 1; i < cols; i++) {
      for (let j = 1; j < rows; j++) {
        ctx.fillRect(offX + i * cell - 0.5, offY + j * cell - 0.5, 1, 1);
      }
    }

    if (state !== "start") {
      // food
      const pulse = 1 + 0.12 * Math.sin((now - (food.born || 0)) / 180);
      const fc = drawRoundCellCenter(food.x, food.y);
      const r = cell * 0.32 * pulse;
      ctx.save();
      ctx.shadowColor = "#fb7185";
      ctx.shadowBlur = 22;
      const fg = ctx.createRadialGradient(fc.x, fc.y, 0, fc.x, fc.y, r);
      fg.addColorStop(0, "#ffd6e0");
      fg.addColorStop(0.5, "#fb7185");
      fg.addColorStop(1, "#e11d48");
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(fc.x, fc.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // snake — interpolated smooth glide
      let t = 1;
      if (state === "playing") t = Math.min(1, (now - lastStep) / interval);
      const pts = snake.map((s, i) => {
        const p = prevSnake[i] || prevSnake[prevSnake.length - 1] || s;
        return {
          x: offX + (lerp(p.x, s.x, t) + 0.5) * cell,
          y: offY + (lerp(p.y, s.y, t) + 0.5) * cell,
        };
      });

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowColor = "#34f5c5";
      ctx.shadowBlur = 18;
      const grad = ctx.createLinearGradient(pts[pts.length - 1].x, pts[pts.length - 1].y, pts[0].x, pts[0].y);
      grad.addColorStop(0, "#22d3ee");
      grad.addColorStop(1, "#34f5c5");
      ctx.strokeStyle = grad;
      ctx.lineWidth = cell * 0.74;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y);
      ctx.stroke();
      ctx.restore();

      // head + eyes
      const head = pts[0];
      ctx.save();
      ctx.shadowColor = "#34f5c5";
      ctx.shadowBlur = 22;
      ctx.fillStyle = "#5ffbd6";
      ctx.beginPath();
      ctx.arc(head.x, head.y, cell * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // eyes look toward direction
      const ex = dir.x, ey = dir.y;
      const eo = cell * 0.16, es = cell * 0.085;
      ctx.fillStyle = "#04221b";
      [[-ey, ex], [ey, -ex]].forEach(([px, py]) => {
        ctx.beginPath();
        ctx.arc(head.x + ex * eo + px * eo, head.y + ey * eo + py * eo, es, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // particles
    if (particles.length) {
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy; p.vx *= 0.92; p.vy *= 0.92; p.life -= 0.04;
      }
      particles = particles.filter((p) => p.life > 0);
      ctx.save();
      ctx.shadowColor = "#fb7185";
      ctx.shadowBlur = 12;
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = "#fda4af";
        ctx.beginPath();
        ctx.arc(p.x, p.y, cell * 0.1 * p.life + 1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.restore();
  }

  // ---- main loop ----
  function loop(now) {
    if (state === "playing") {
      if (!lastStep) lastStep = now;
      while (now - lastStep >= interval && state === "playing") {
        lastStep += interval;
        step();
      }
    }
    render(now);
    requestAnimationFrame(loop);
  }

  // ---- boot ----
  function onResize() {
    const wasStart = state === "start";
    layout();
    if (wasStart) resetGame();
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", () => setTimeout(onResize, 250));
  if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize);

  layout();
  resetGame();
  state = "start";
  showOverlay('NEON<span>SNAKE</span>', "Glissez le doigt pour diriger le serpent.", "JOUER", false);
  requestAnimationFrame(loop);

  // optional test hook (?test=1)
  if (new URLSearchParams(location.search).get("test") === "1") {
    window.__snake = {
      getState: () => state,
      getScore: () => score,
      getBest: () => best,
      getInterval: () => interval,
      getLength: () => snake.length,
      getSnake: () => snake.map((s) => ({ x: s.x, y: s.y })),
      getFood: () => ({ x: food.x, y: food.y }),
      getDir: () => ({ x: dir.x, y: dir.y }),
      getGrid: () => ({ cols, rows }),
      setFood: (x, y) => { food = { x, y, born: performance.now() }; },
      input: requestDir,
      start: startGame,
      pause: togglePause,
    };
  }
})();
