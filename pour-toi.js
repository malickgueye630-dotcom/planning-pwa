(() => {
  "use strict";

  /* ===========================================================
     ❤️  À PERSONNALISER — change juste les textes ci-dessous
     =========================================================== */
  const CONFIG = {
    // Son prénom (laisse "" pour afficher juste "Pour toi")
    herName: "",
    // Ton prénom, pour la signature à la fin (laisse "" pour rien)
    myName: "",

    // Le voyage — chaque étape : emoji, lieu, petit mot
    slides: [
      { emoji: "🗼", place: "Paris", text: "On dit que Paris est la ville de l'amour… mais c'est toi qui rends magique chaque endroit." },
      { emoji: "🚣", place: "Venise", text: "J'aimerais me perdre avec toi dans mille ruelles, sans jamais vouloir retrouver le chemin." },
      { emoji: "🌅", place: "Santorin", text: "Un coucher de soleil sur la mer, ta main dans la mienne. Je n'ai besoin de rien d'autre." },
      { emoji: "🏮", place: "Tokyo", text: "Au bout du monde ou au coin de la rue — tant que c'est avec toi, je suis là." },
      { emoji: "🎶", place: "Notre chanson", text: "Et il y aurait une mélodie. La nôtre. Celle qu'on écouterait en boucle sur la route." },
    ],

    // La question finale
    question: "Alors… est-ce que tu veux voyager à mes côtés ?",
    // Le message quand elle dit oui
    yesMessage: "Tu viens de rendre quelqu'un terriblement heureux.",
    // petite signature (utilise myName)
  };

  /* =========================================================== */

  // ---- intro title / signature ----
  if (CONFIG.herName) {
    document.getElementById("introTitle").textContent = "Pour toi, " + CONFIG.herName;
  }

  // ---- floating hearts canvas ----
  const canvas = document.getElementById("fx");
  const ctx = canvas.getContext("2d");
  let W, H, dpr;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  const hearts = [];
  function heartPath(x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.3);
    ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
    ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
    ctx.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
    ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
    ctx.closePath();
  }
  const HEART_COLORS = ["#ff8fb1", "#ffd6a5", "#ffb3c6", "#f9a8d4", "#fff"];
  function spawnHeart(burst) {
    const s = burst ? 10 + Math.random() * 16 : 8 + Math.random() * 12;
    hearts.push({
      x: burst ? W / 2 : Math.random() * W,
      y: burst ? H / 2 : H + 20,
      s,
      vx: burst ? (Math.random() - 0.5) * 9 : (Math.random() - 0.5) * 0.6,
      vy: burst ? (Math.random() - 0.5) * 9 - 2 : -(0.5 + Math.random() * 1.1),
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.05,
      life: 1,
      color: HEART_COLORS[(Math.random() * HEART_COLORS.length) | 0],
      grav: burst ? 0.18 : 0,
    });
  }
  let ambient = true;
  function tick() {
    ctx.clearRect(0, 0, W, H);
    if (ambient && Math.random() < 0.5 && hearts.length < 60) spawnHeart(false);
    for (let i = hearts.length - 1; i >= 0; i--) {
      const h = hearts[i];
      h.x += h.vx; h.y += h.vy; h.vy += h.grav; h.rot += h.vr;
      if (h.grav) h.life -= 0.012;
      if (h.y < -40 || h.life <= 0) { hearts.splice(i, 1); continue; }
      ctx.save();
      ctx.translate(h.x, h.y);
      ctx.rotate(h.rot);
      ctx.globalAlpha = Math.max(0, Math.min(0.85, h.life));
      ctx.fillStyle = h.color;
      ctx.shadowColor = h.color;
      ctx.shadowBlur = 12;
      heartPath(0, -h.s / 2, h.s);
      ctx.fill();
      ctx.restore();
    }
    requestAnimationFrame(tick);
  }
  tick();
  function burstHearts(n) { for (let i = 0; i < n; i++) spawnHeart(true); }

  // ---- gentle music (Web Audio, generated) ----
  let actx = null, masterGain = null, musicOn = false, schedTimer = null;
  // I–V–vi–IV en Do : Do, Sol, Lam, Fa
  const CHORDS = [
    [261.63, 329.63, 392.00],   // C
    [196.00, 246.94, 392.00],   // G
    [220.00, 261.63, 329.63],   // Am
    [174.61, 220.00, 261.63],   // F
  ];
  let chordIndex = 0, noteTime = 0, arpStep = 0;
  function playNote(freq, time, dur, gain) {
    const osc = actx.createOscillator();
    const g = actx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(g).connect(masterGain);
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.start(time); osc.stop(time + dur + 0.05);
  }
  function scheduler() {
    const lookahead = actx.currentTime + 0.3;
    while (noteTime < lookahead) {
      const chord = CHORDS[chordIndex];
      // arpeggio
      const note = chord[arpStep % chord.length];
      playNote(note, noteTime, 0.6, 0.06);
      // soft pad on first step of the chord
      if (arpStep === 0) chord.forEach((f) => playNote(f / 2, noteTime, 1.7, 0.025));
      arpStep++;
      noteTime += 0.42;
      if (arpStep % 4 === 0) chordIndex = (chordIndex + 1) % CHORDS.length;
    }
    schedTimer = setTimeout(scheduler, 120);
  }
  function startMusic() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
      if (!masterGain) {
        masterGain = actx.createGain();
        masterGain.gain.value = 0;
        masterGain.connect(actx.destination);
      }
      masterGain.gain.cancelScheduledValues(actx.currentTime);
      masterGain.gain.linearRampToValueAtTime(0.5, actx.currentTime + 1.2);
      if (!musicOn) {
        musicOn = true;
        noteTime = actx.currentTime + 0.1;
        chordIndex = 0; arpStep = 0;
        scheduler();
      }
      updateMusicBtn();
    } catch (e) { /* audio indispo, on continue sans */ }
  }
  function stopMusic() {
    if (!actx || !musicOn) return;
    musicOn = false;
    clearTimeout(schedTimer);
    masterGain.gain.cancelScheduledValues(actx.currentTime);
    masterGain.gain.linearRampToValueAtTime(0, actx.currentTime + 0.4);
    updateMusicBtn();
  }
  const musicBtn = document.getElementById("musicToggle");
  function updateMusicBtn() { musicBtn.classList.toggle("muted", !musicOn); }
  musicBtn.addEventListener("click", () => { musicOn ? stopMusic() : startMusic(); });

  // ---- navigation ----
  const intro = document.getElementById("intro");
  const journey = document.getElementById("journey");
  const finalScreen = document.getElementById("final");
  const slideWrap = document.getElementById("slideWrap");
  const dotsEl = document.getElementById("dots");
  const nextBtn = document.getElementById("nextBtn");

  // build slides + dots
  CONFIG.slides.forEach((s, i) => {
    const el = document.createElement("div");
    el.className = "slide" + (i === 0 ? " active" : "");
    el.innerHTML =
      `<div class="slide__emoji">${s.emoji}</div>` +
      `<div class="slide__place">${s.place}</div>` +
      `<p class="slide__text">${s.text}</p>`;
    slideWrap.appendChild(el);
    const d = document.createElement("div");
    d.className = "dot" + (i === 0 ? " on" : "");
    dotsEl.appendChild(d);
  });
  const slideEls = [...slideWrap.children];
  const dotEls = [...dotsEl.children];
  let idx = 0;

  function showSlide(n) {
    if (n < 0 || n >= slideEls.length) return;
    slideEls[idx].classList.remove("active");
    dotEls[idx].classList.remove("on");
    idx = n;
    slideEls[idx].classList.add("active");
    dotEls[idx].classList.add("on");
    nextBtn.innerHTML = (idx === slideEls.length - 1)
      ? `❤️`
      : `Suivant <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>`;
  }

  function nextSlide() {
    if (idx < slideEls.length - 1) showSlide(idx + 1);
    else goFinal();
  }
  nextBtn.addEventListener("click", nextSlide);

  // swipe between slides
  let sx = null;
  journey.addEventListener("touchstart", (e) => { sx = e.changedTouches[0].clientX; }, { passive: true });
  journey.addEventListener("touchend", (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx; sx = null;
    if (dx < -45) nextSlide();
    else if (dx > 45) showSlide(idx - 1);
  }, { passive: true });

  function show(el) { el.classList.remove("hidden"); }
  function hide(el) { el.classList.add("hidden"); }

  document.getElementById("beginBtn").addEventListener("click", () => {
    startMusic();
    musicBtn.hidden = false;
    hide(intro);
    setTimeout(() => show(journey), 380);
  });

  // ---- final ----
  const finalQ = document.getElementById("finalQ");
  const finalBtns = document.getElementById("finalBtns");
  const finalAnswer = document.getElementById("finalAnswer");
  const yesBtn = document.getElementById("yesBtn");
  const noBtn = document.getElementById("noBtn");
  finalQ.textContent = CONFIG.question;

  function goFinal() {
    hide(journey);
    setTimeout(() => show(finalScreen), 380);
  }

  // the playful runaway "Non" button
  let dodges = 0;
  function dodge() {
    dodges++;
    const pad = 70;
    const x = pad + Math.random() * (window.innerWidth - pad * 2) - window.innerWidth / 2;
    const y = pad + Math.random() * (window.innerHeight - pad * 2) - window.innerHeight / 2;
    noBtn.style.position = "fixed";
    noBtn.style.left = "50%";
    noBtn.style.top = "50%";
    noBtn.style.transform = `translate(${x}px, ${y}px)`;
    noBtn.style.transition = "transform 250ms cubic-bezier(0.34,1.56,0.64,1)";
    // make "Oui" grow & more tempting
    const grow = Math.min(1 + dodges * 0.12, 1.8);
    yesBtn.style.transform = `scale(${grow})`;
    const teases = ["Non", "Sûre ?", "Vraiment ?", "Réfléchis…", "Allez 🥺", "Non… ?"];
    noBtn.textContent = teases[Math.min(dodges, teases.length - 1)];
  }
  noBtn.addEventListener("pointerenter", dodge);
  noBtn.addEventListener("click", (e) => { e.preventDefault(); dodge(); });

  yesBtn.addEventListener("click", () => {
    finalBtns.hidden = true;
    finalQ.style.display = "none";
    document.getElementById("finalMsg").textContent = CONFIG.yesMessage;
    const sign = document.getElementById("finalSign");
    sign.textContent = CONFIG.myName ? "— " + CONFIG.myName + " 💕" : "💕";
    finalAnswer.hidden = false;
    if (!musicOn) startMusic();
    burstHearts(60);
    let n = 0;
    const iv = setInterval(() => { burstHearts(18); if (++n > 6) clearInterval(iv); }, 450);
  });

  // ---- test hook (?test=1) ----
  if (new URLSearchParams(location.search).get("test") === "1") {
    window.__love = {
      begin: () => document.getElementById("beginBtn").click(),
      next: nextSlide,
      slideIndex: () => idx,
      slideCount: slideEls.length,
      onFinal: () => !finalScreen.classList.contains("hidden"),
      sayYes: () => yesBtn.click(),
      answered: () => !finalAnswer.hidden,
      dodgeNo: () => { noBtn.dispatchEvent(new Event("pointerenter")); return dodges; },
      musicOn: () => musicOn,
    };
  }
})();
