(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const CELL = 16;
  const COLS = canvas.width / CELL;   // 24
  const HUD_ROWS = 1;
  const PLAY_ROWS = canvas.height / CELL - HUD_ROWS; // 13
  const PLAY_TOP = HUD_ROWS * CELL;

  const COLOR_BG = "#c7d6a0";
  const COLOR_INK = "#2e3a1f";
  const COLOR_INK_SOFT = "#4a5a34";

  const START_INTERVAL = 150;
  const MIN_INTERVAL = 65;
  const SPEEDUP_PER_FOOD = 3;

  const HS_KEY = "nokia-snake-highscore";
  const MUTE_KEY = "nokia-snake-muted";

  let state = "start"; // start | playing | paused | gameover
  let snake, dir, pendingDir, food, score, highScore, moveInterval, lastMoveAt;
  let muted = localStorage.getItem(MUTE_KEY) === "1";

  highScore = parseInt(localStorage.getItem(HS_KEY) || "0", 10) || 0;

  function resetGame() {
    const startX = Math.floor(COLS / 2) - 2;
    const startY = Math.floor(PLAY_ROWS / 2);
    snake = [
      { x: startX - 2, y: startY },
      { x: startX - 1, y: startY },
      { x: startX, y: startY },
    ];
    dir = { x: 1, y: 0 };
    pendingDir = null;
    score = 0;
    moveInterval = START_INTERVAL;
    lastMoveAt = 0;
    placeFood();
  }

  function placeFood() {
    const occupied = new Set(snake.map((s) => s.x + "," + s.y));
    let x, y;
    do {
      x = Math.floor(Math.random() * COLS);
      y = Math.floor(Math.random() * PLAY_ROWS);
    } while (occupied.has(x + "," + y));
    food = { x, y };
  }

  // ---------- audio ----------
  let audioCtx = null;
  function beep(freq, duration, type = "square") {
    if (muted) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.value = 0.06;
      osc.connect(gain).connect(audioCtx.destination);
      const now = audioCtx.currentTime;
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.start(now);
      osc.stop(now + duration);
    } catch (e) { /* audio unavailable, ignore */ }
  }
  const sfx = {
    eat: () => beep(880, 0.08),
    turn: () => beep(520, 0.03),
    over: () => { beep(220, 0.18); setTimeout(() => beep(140, 0.25), 140); },
    start: () => { beep(440, 0.06); setTimeout(() => beep(660, 0.08), 90); },
  };

  // ---------- input ----------
  const DIRS = {
    up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
    left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
  };

  function requestDir(name) {
    const d = DIRS[name];
    if (!d) return;
    if (state === "start") { startGame(); }
    if (state !== "playing") return;
    // ignore reversing into the snake's own body
    if (d.x === -dir.x && d.y === -dir.y && snake.length > 1) return;
    pendingDir = d;
  }

  const KEY_MAP = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    w: "up", s: "down", a: "left", d: "right",
    z: "up", q: "left", // AZERTY (ZQSD)
  };

  window.addEventListener("keydown", (e) => {
    const k = e.key;
    if (KEY_MAP[k]) { e.preventDefault(); requestDir(KEY_MAP[k]); return; }
    if (k === " ") { e.preventDefault(); togglePause(); return; }
    if (k === "Enter") { e.preventDefault(); onCenterAction(); return; }
  });

  document.querySelectorAll(".navkey[data-dir]").forEach((btn) => {
    btn.addEventListener("pointerdown", (e) => { e.preventDefault(); requestDir(btn.dataset.dir); });
  });

  document.getElementById("centerBtn").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    onCenterAction();
  });

  document.getElementById("softLeftBtn").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (state === "gameover" || state === "start") startGame();
    else togglePause();
  });

  const soundBtn = document.getElementById("soundBtn");
  function refreshSoundLabel() {
    soundBtn.title = muted ? "Activer le son" : "Couper le son";
    document.getElementById("softRightLabel").textContent = muted ? "Son: off" : "Son: on";
  }
  soundBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    muted = !muted;
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    refreshSoundLabel();
  });
  refreshSoundLabel();

  // swipe controls on screen
  let touchStart = null;
  canvas.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  canvas.addEventListener("touchend", (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) {
      if (state === "start" || state === "gameover") startGame();
      else togglePause();
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) requestDir(dx > 0 ? "right" : "left");
    else requestDir(dy > 0 ? "down" : "up");
  }, { passive: true });

  function onCenterAction() {
    if (state === "start" || state === "gameover") startGame();
    else togglePause();
  }

  function togglePause() {
    if (state === "playing") { state = "paused"; }
    else if (state === "paused") { state = "playing"; lastMoveAt = performance.now(); }
  }

  function startGame() {
    resetGame();
    state = "playing";
    sfx.start();
  }

  function gameOver() {
    state = "gameover";
    if (score > highScore) {
      highScore = score;
      localStorage.setItem(HS_KEY, String(highScore));
    }
    sfx.over();
  }

  // ---------- update ----------
  function step() {
    if (pendingDir) { dir = pendingDir; pendingDir = null; }
    const head = snake[snake.length - 1];
    const next = { x: head.x + dir.x, y: head.y + dir.y };

    if (next.x < 0 || next.x >= COLS || next.y < 0 || next.y >= PLAY_ROWS) {
      gameOver();
      return;
    }
    const hitsSelf = snake.some((s, i) => i !== 0 && s.x === next.x && s.y === next.y);
    if (hitsSelf) {
      gameOver();
      return;
    }

    snake.push(next);
    if (next.x === food.x && next.y === food.y) {
      score += 1;
      moveInterval = Math.max(MIN_INTERVAL, moveInterval - SPEEDUP_PER_FOOD);
      sfx.eat();
      placeFood();
    } else {
      snake.shift();
    }
  }

  // ---------- render ----------
  function drawText(text, cx, topY, size = 10, color = COLOR_INK) {
    ctx.font = `${size}px "Press Start 2P", monospace`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(text, cx, topY);
  }

  function render() {
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // HUD
    ctx.font = '9px "Press Start 2P", monospace';
    ctx.fillStyle = COLOR_INK;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText("SC " + String(score).padStart(3, "0"), 4, 2);
    ctx.textAlign = "right";
    ctx.fillText("HI " + String(highScore).padStart(3, "0"), canvas.width - 4, 2);

    ctx.strokeStyle = COLOR_INK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, PLAY_TOP - 0.5);
    ctx.lineTo(canvas.width, PLAY_TOP - 0.5);
    ctx.stroke();

    // playfield border
    ctx.strokeRect(1.5, PLAY_TOP + 1.5, canvas.width - 3, canvas.height - PLAY_TOP - 3);

    if (state === "start") {
      drawText("SNAKE", canvas.width / 2, PLAY_TOP + 38, 16);
      drawText("NOKIA EDITION", canvas.width / 2, PLAY_TOP + 64, 7, COLOR_INK_SOFT);
      if (Math.floor(performance.now() / 500) % 2 === 0) {
        drawText("APPUYEZ POUR JOUER", canvas.width / 2, PLAY_TOP + 110, 7);
      }
      return;
    }

    // snake
    snake.forEach((s, i) => {
      const px = s.x * CELL + 1;
      const py = PLAY_TOP + s.y * CELL + 1;
      ctx.fillStyle = COLOR_INK;
      ctx.fillRect(px, py, CELL - 2, CELL - 2);
      if (i === snake.length - 1) {
        // head: small eye dots for a more "alive" look
        ctx.fillStyle = COLOR_BG;
        const ex = dir.x !== 0 ? (dir.x > 0 ? CELL - 6 : 3) : 5;
        const ey = dir.y !== 0 ? (dir.y > 0 ? CELL - 6 : 3) : 5;
        ctx.fillRect(px + ex, py + ey, 2, 2);
      }
    });

    // food (blinking)
    if (Math.floor(performance.now() / 250) % 2 === 0) {
      const fx = food.x * CELL + 1;
      const fy = PLAY_TOP + food.y * CELL + 1;
      ctx.fillStyle = COLOR_INK;
      ctx.beginPath();
      ctx.arc(fx + CELL / 2 - 1, fy + CELL / 2 - 1, (CELL - 6) / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (state === "paused") {
      ctx.fillStyle = "rgba(199,214,160,0.85)";
      ctx.fillRect(0, PLAY_TOP, canvas.width, canvas.height - PLAY_TOP);
      drawText("PAUSE", canvas.width / 2, PLAY_TOP + 80, 14);
    }

    if (state === "gameover") {
      ctx.fillStyle = "rgba(199,214,160,0.92)";
      ctx.fillRect(0, PLAY_TOP, canvas.width, canvas.height - PLAY_TOP);
      drawText("GAME OVER", canvas.width / 2, PLAY_TOP + 30, 12);
      drawText("SCORE " + score, canvas.width / 2, PLAY_TOP + 58, 9);
      drawText("RECORD " + highScore, canvas.width / 2, PLAY_TOP + 76, 9, COLOR_INK_SOFT);
      if (Math.floor(performance.now() / 500) % 2 === 0) {
        drawText("REJOUER ?", canvas.width / 2, PLAY_TOP + 112, 8);
      }
    }
  }

  // ---------- main loop ----------
  function loop(now) {
    if (state === "playing") {
      if (!lastMoveAt) lastMoveAt = now;
      if (now - lastMoveAt >= moveInterval) {
        lastMoveAt = now;
        step();
      }
    }
    render();
    requestAnimationFrame(loop);
  }

  resetGame();
  requestAnimationFrame(loop);
})();
