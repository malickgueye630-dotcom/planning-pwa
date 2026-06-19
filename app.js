/* ===========================================================
   Mon Planning — app.js
   =========================================================== */

const DAYS = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const STORE_KEY = "planning_app_state_v1";
const HISTORY_KEY = "planning_app_history_v1";

let state = {
  targetName: "MALICK",
  prep: 60,
  travel: 30,
  margin: 10,
  schedule: [],   // [{day, type, start, end}]
  wakes: []       // [{day, wake, start}]
};

let currentImageDataUrl = null;

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);

const els = {
  preview: $("preview"),
  dropzoneEmpty: $("dropzoneEmpty"),
  cameraInput: $("cameraInput"),
  galleryInput: $("galleryInput"),
  targetName: $("targetName"),
  analyzeBtn: $("analyzeBtn"),
  ocrProgress: $("ocrProgress"),
  ocrProgressBar: $("ocrProgressBar"),
  ocrProgressLabel: $("ocrProgressLabel"),
  cardResult: $("cardResult"),
  scheduleList: $("scheduleList"),
  addDayBtn: $("addDayBtn"),
  cardSettings: $("cardSettings"),
  prepTime: $("prepTime"),
  travelTime: $("travelTime"),
  marginTime: $("marginTime"),
  wakeList: $("wakeList"),
  cardCalendar: $("cardCalendar"),
  downloadIcsBtn: $("downloadIcsBtn"),
  notifBtn: $("notifBtn"),
  notifNotice: $("notifNotice"),
  checkTodayBtn: $("checkTodayBtn"),
  checkResult: $("checkResult"),
  historyList: $("historyList"),
  todaySummary: $("todaySummary"),
};

/* ---------- INIT ---------- */
window.addEventListener("DOMContentLoaded", () => {
  loadState();
  renderHistory();
  refreshTodaySummary();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
});

els.targetName.addEventListener("change", () => {
  state.targetName = els.targetName.value.trim().toUpperCase() || "MALICK";
  saveState();
});

els.cameraInput.addEventListener("change", (e) => handleImage(e.target.files[0]));
els.galleryInput.addEventListener("change", (e) => handleImage(e.target.files[0]));

els.analyzeBtn.addEventListener("click", runOcr);
els.addDayBtn.addEventListener("click", () => {
  state.schedule.push({ day: "Lundi", type: "work", start: "09:00", end: "17:00" });
  renderSchedule();
});
els.prepTime.addEventListener("input", recalcWakes);
els.travelTime.addEventListener("input", recalcWakes);
els.marginTime.addEventListener("input", recalcWakes);
els.downloadIcsBtn.addEventListener("click", downloadIcs);
els.notifBtn.addEventListener("click", enableNotifications);
els.checkTodayBtn.addEventListener("click", checkToday);

/* ---------- IMAGE IMPORT ---------- */
function handleImage(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    currentImageDataUrl = e.target.result;
    els.preview.src = currentImageDataUrl;
    els.preview.hidden = false;
    els.dropzoneEmpty.hidden = true;
    els.analyzeBtn.disabled = false;
  };
  reader.readAsDataURL(file);
}

/* ---------- OCR ---------- */
async function runOcr() {
  if (!currentImageDataUrl) return;
  state.targetName = els.targetName.value.trim().toUpperCase() || "MALICK";

  els.analyzeBtn.disabled = true;
  els.ocrProgress.hidden = false;
  setProgress(0, "Initialisation…");

  try {
    const result = await Tesseract.recognize(currentImageDataUrl, "fra", {
      logger: (m) => {
        if (m.status === "recognizing text") {
          setProgress(Math.round(m.progress * 100), "Lecture en cours…");
        } else if (m.status) {
          setProgress(0, capitalize(m.status) + "…");
        }
      },
    });

    setProgress(100, "Analyse du texte…");
    const text = result.data.text;
    const parsed = parsePlanning(text, state.targetName);

    if (parsed.length === 0) {
      els.checkResult.textContent =
        `Le nom "${state.targetName}" n'a pas été détecté avec certitude. ` +
        `Vous pouvez ajouter les jours manuellement ci-dessous.`;
      state.schedule = defaultEmptyWeek();
    } else {
      state.schedule = parsed;
    }

    saveState();
    addToHistory(currentImageDataUrl, state.schedule);
    renderSchedule();
    els.cardResult.hidden = false;
    els.cardSettings.hidden = false;
    els.cardCalendar.hidden = false;
    recalcWakes();
    refreshTodaySummary();
    els.cardResult.scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    console.error(err);
    els.checkResult.textContent = "Erreur pendant la lecture de l'image. Réessayez avec une photo plus nette.";
  } finally {
    els.ocrProgress.hidden = true;
    els.analyzeBtn.disabled = false;
  }
}

function setProgress(pct, label) {
  els.ocrProgressBar.style.setProperty("--pct", pct + "%");
  els.ocrProgressLabel.textContent = label;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ---------- PARSING ---------- */
function normalize(s) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function parsePlanning(rawText, targetName) {
  const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
  const target = normalize(targetName);

  // Find the line(s) belonging to the target employee.
  // Often OCR keeps the name and the times on the same line; sometimes
  // the times wrap to the next 1-2 lines. We grab the name line plus
  // up to 2 following lines until another all-caps name-like line appears.
  let blockLines = [];
  let foundIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (normalize(lines[i]).includes(target)) {
      foundIndex = i;
      break;
    }
  }
  if (foundIndex === -1) return [];

  blockLines.push(lines[foundIndex]);
  for (let i = foundIndex + 1; i < lines.length && i <= foundIndex + 3; i++) {
    const norm = normalize(lines[i]);
    // Stop if line looks like a new employee name (all caps word, no digits, short)
    const looksLikeNewName = /^[A-Z\s\-]{3,20}$/.test(norm) && !/\d/.test(norm);
    if (looksLikeNewName) break;
    blockLines.push(lines[i]);
  }

  const fullBlock = blockLines.join(" ");
  return extractDaysFromText(fullBlock, lines, foundIndex);
}

function extractDaysFromText(blockText) {
  // Time token: 7h00, 07:00, 7H, 7h
  const timeRe = /(\d{1,2})\s*[hH:]\s*(\d{2})?/g;
  const reposRe = /REPOS|CONGE|CONGÉ/i;
  const formationRe = /FORMATION/i;

  // Try to split block text into day-sized chunks using day names as anchors.
  const dayPattern = DAYS.map((d) => normalize(d)).join("|");
  const dayRe = new RegExp(`(${dayPattern})`, "gi");

  const normBlock = normalize(blockText);
  const matches = [...normBlock.matchAll(dayRe)];

  const result = [];

  if (matches.length >= 3) {
    // Day names found inline — slice the text between them.
    for (let i = 0; i < matches.length; i++) {
      const dayNorm = matches[i][1];
      const dayName = DAYS.find((d) => normalize(d) === dayNorm);
      const start = matches[i].index;
      const end = i + 1 < matches.length ? matches[i + 1].index : normBlock.length;
      const chunk = blockText.slice(start, end);
      result.push(parseChunk(dayName, chunk));
    }
  } else {
    // No day labels in OCR text — fall back to splitting by token groups,
    // assigning them in week order. This is approximate; user can correct.
    const tokens = blockText.match(/(\d{1,2}\s*[hH:]\s*\d{0,2}|REPOS|CONGE|CONGÉ|FORMATION)/gi) || [];
    let dayIdx = 0;
    let i = 0;
    while (i < tokens.length && dayIdx < 7) {
      const tok = tokens[i];
      if (reposRe.test(tok)) {
        result.push({ day: DAYS[dayIdx], type: "repos", start: "", end: "" });
        i += 1;
      } else if (formationRe.test(tok)) {
        result.push({ day: DAYS[dayIdx], type: "formation", start: "", end: "" });
        i += 1;
      } else {
        const start = toTime(tok);
        const end = i + 1 < tokens.length ? toTime(tokens[i + 1]) : "";
        result.push({ day: DAYS[dayIdx], type: "work", start, end });
        i += 2;
      }
      dayIdx++;
    }
  }

  return result.filter((r) => r.day);
}

function parseChunk(dayName, chunk) {
  if (/REPOS|CONGE/i.test(chunk)) {
    return { day: dayName, type: "repos", start: "", end: "" };
  }
  if (/FORMATION/i.test(chunk)) {
    return { day: dayName, type: "formation", start: "", end: "" };
  }
  const times = chunk.match(/\d{1,2}\s*[hH:]\s*\d{0,2}/g) || [];
  const start = times[0] ? toTime(times[0]) : "";
  const end = times[1] ? toTime(times[1]) : "";
  return { day: dayName, type: "work", start, end };
}

function toTime(token) {
  const m = token.match(/(\d{1,2})\s*[hH:]\s*(\d{0,2})/);
  if (!m) return "";
  const h = m[1].padStart(2, "0");
  const min = (m[2] || "00").padStart(2, "0");
  return `${h}:${min}`;
}

function defaultEmptyWeek() {
  return DAYS.map((d) => ({ day: d, type: "repos", start: "", end: "" }));
}

/* ---------- RENDER SCHEDULE ---------- */
function renderSchedule() {
  els.scheduleList.innerHTML = "";
  state.schedule.forEach((entry, idx) => {
    const row = document.createElement("div");
    row.className = "day-row" + (entry.type !== "work" ? " day-row--repos" : "");

    const nameSel = document.createElement("select");
    DAYS.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      if (d === entry.day) opt.selected = true;
      nameSel.appendChild(opt);
    });
    nameSel.addEventListener("change", () => {
      state.schedule[idx].day = nameSel.value;
      saveState();
      recalcWakes();
    });
    nameSel.className = "day-row__name";
    nameSel.style.background = "transparent";
    nameSel.style.border = "none";
    nameSel.style.color = "var(--text)";
    nameSel.style.fontWeight = "600";
    nameSel.style.fontSize = "0.85rem";
    nameSel.style.width = "78px";
    nameSel.style.flexShrink = "0";

    const timesWrap = document.createElement("div");
    timesWrap.className = "day-row__times";

    const typeSel = document.createElement("select");
    ["work", "repos", "formation"].forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t === "work" ? "Travail" : t === "repos" ? "Repos" : "Formation";
      if (t === entry.type) opt.selected = true;
      typeSel.appendChild(opt);
    });
    typeSel.addEventListener("change", () => {
      state.schedule[idx].type = typeSel.value;
      saveState();
      renderSchedule();
      recalcWakes();
    });
    timesWrap.appendChild(typeSel);

    if (entry.type === "work") {
      const startInput = document.createElement("input");
      startInput.type = "time";
      startInput.value = entry.start || "";
      startInput.addEventListener("change", () => {
        state.schedule[idx].start = startInput.value;
        saveState();
        recalcWakes();
      });

      const sep = document.createElement("span");
      sep.className = "day-row__sep";
      sep.textContent = "→";

      const endInput = document.createElement("input");
      endInput.type = "time";
      endInput.value = entry.end || "";
      endInput.addEventListener("change", () => {
        state.schedule[idx].end = endInput.value;
        saveState();
      });

      timesWrap.appendChild(startInput);
      timesWrap.appendChild(sep);
      timesWrap.appendChild(endInput);
    } else {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = entry.type === "repos" ? "Repos" : "Formation";
      timesWrap.appendChild(tag);
    }

    const removeBtn = document.createElement("button");
    removeBtn.className = "day-row__remove";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
      state.schedule.splice(idx, 1);
      saveState();
      renderSchedule();
      recalcWakes();
    });

    row.appendChild(nameSel);
    row.appendChild(timesWrap);
    row.appendChild(removeBtn);
    els.scheduleList.appendChild(row);
  });
}

/* ---------- WAKE CALC ---------- */
function recalcWakes() {
  state.prep = parseInt(els.prepTime.value, 10) || 0;
  state.travel = parseInt(els.travelTime.value, 10) || 0;
  state.margin = parseInt(els.marginTime.value, 10) || 0;
  saveState();

  const wakes = state.schedule
    .filter((e) => e.type === "work" && e.start)
    .map((e) => {
      const totalMin = state.prep + state.travel + state.margin;
      const wake = subtractMinutes(e.start, totalMin);
      return { day: e.day, wake, start: e.start };
    });

  state.wakes = wakes;
  saveState();
  renderWakes();
}

function subtractMinutes(timeStr, minutes) {
  const [h, m] = timeStr.split(":").map(Number);
  let total = h * 60 + m - minutes;
  total = ((total % 1440) + 1440) % 1440;
  const hh = Math.floor(total / 60).toString().padStart(2, "0");
  const mm = (total % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function renderWakes() {
  els.wakeList.innerHTML = "";
  if (state.wakes.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Aucun jour travaillé détecté pour le moment.";
    els.wakeList.appendChild(p);
    return;
  }
  state.wakes.forEach((w) => {
    const row = document.createElement("div");
    row.className = "wake-row";
    row.innerHTML = `
      <div>
        <div class="wake-row__day">${w.day}</div>
        <div class="wake-row__sub">prise de poste ${w.start}</div>
      </div>
      <div class="wake-row__time">${w.wake}</div>
    `;
    els.wakeList.appendChild(row);
  });
}

/* ---------- ICS EXPORT ---------- */
function downloadIcs() {
  if (state.schedule.filter((e) => e.type === "work" && e.start).length === 0) {
    alert("Aucun horaire de travail à exporter.");
    return;
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MonPlanning//FR",
    "CALSCALE:GREGORIAN",
  ];

  state.schedule.forEach((entry) => {
    if (entry.type !== "work" || !entry.start) return;
    const date = nextDateForDay(entry.day);
    const startDate = combineDateTime(date, entry.start);
    let endDate;
    if (entry.end) {
      endDate = combineDateTime(date, entry.end);
      if (endDate <= startDate) endDate = new Date(endDate.getTime() + 24 * 3600 * 1000);
    } else {
      endDate = new Date(startDate.getTime() + 8 * 3600 * 1000);
    }

    const wake = state.wakes.find((w) => w.day === entry.day);
    const totalMin = state.prep + state.travel + state.margin;

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${cryptoRandom()}@monplanning`);
    lines.push(`DTSTAMP:${formatIcsDate(new Date())}`);
    lines.push(`DTSTART:${formatIcsDate(startDate)}`);
    lines.push(`DTEND:${formatIcsDate(endDate)}`);
    lines.push(`SUMMARY:Travail — ${state.targetName}`);
    lines.push(`DESCRIPTION:Prise de poste ${entry.start}. Réveil conseillé : ${wake ? wake.wake : "n/a"}.`);
    lines.push("BEGIN:VALARM");
    lines.push("ACTION:DISPLAY");
    lines.push(`DESCRIPTION:Réveil — ${state.targetName}`);
    lines.push(`TRIGGER:-PT${totalMin}M`);
    lines.push("END:VALARM");
    lines.push("END:VEVENT");
  });

  lines.push("END:VCALENDAR");

  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "planning.ics";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function nextDateForDay(dayName) {
  const idx = DAYS.indexOf(dayName); // 0 = Lundi
  const today = new Date();
  const todayIdx = (today.getDay() + 6) % 7; // convert JS Sun=0 to Mon=0
  let diff = idx - todayIdx;
  if (diff < 0) diff += 7;
  const d = new Date(today);
  d.setDate(today.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function combineDateTime(date, timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

function formatIcsDate(date) {
  const pad = (n) => n.toString().padStart(2, "0");
  return (
    date.getFullYear().toString() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    "T" +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    "00"
  );
}

function cryptoRandom() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* ---------- NOTIFICATIONS ---------- */
async function enableNotifications() {
  if (!("Notification" in window)) {
    els.notifNotice.textContent = "Les notifications ne sont pas supportées sur ce navigateur. Utilisez l'export .ics.";
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === "granted") {
    els.notifNotice.textContent =
      "Rappels activés pour cette session. Sur iPhone, ces notifications peuvent être interrompues si l'app n'est pas ouverte — gardez l'export .ics comme solution fiable.";
    scheduleLocalReminders();
  } else {
    els.notifNotice.textContent = "Notifications refusées. L'export .ics reste la solution la plus fiable sur iPhone.";
  }
}

function scheduleLocalReminders() {
  state.wakes.forEach((w) => {
    const date = nextDateForDay(w.day);
    const wakeDate = combineDateTime(date, w.wake);
    const delay = wakeDate.getTime() - Date.now();
    if (delay > 0 && delay < 24 * 3600 * 1000) {
      setTimeout(() => {
        new Notification("Réveil — " + state.targetName, {
          body: `Prise de poste ${w.start} aujourd'hui.`,
        });
      }, delay);
    }
  });
}

/* ---------- CHECK TODAY ---------- */
function checkToday() {
  const todayIdx = (new Date().getDay() + 6) % 7;
  const todayName = DAYS[todayIdx];
  const entry = state.schedule.find((e) => e.day === todayName);

  if (!entry) {
    els.checkResult.textContent = `Aucune information pour aujourd'hui (${todayName}).`;
    return;
  }
  if (entry.type === "repos") {
    els.checkResult.textContent = `${todayName} : repos. Pas de réveil prévu.`;
  } else if (entry.type === "formation") {
    els.checkResult.textContent = `${todayName} : formation.`;
  } else {
    const wake = state.wakes.find((w) => w.day === todayName);
    els.checkResult.textContent =
      `${todayName} : travail ${entry.start}${entry.end ? " → " + entry.end : ""}.\n` +
      (wake ? `Réveil conseillé : ${wake.wake}.` : "");
  }
}

function refreshTodaySummary() {
  if (state.schedule.length === 0) {
    els.todaySummary.textContent = "Importez une photo pour commencer";
    return;
  }
  const todayIdx = (new Date().getDay() + 6) % 7;
  const todayName = DAYS[todayIdx];
  const entry = state.schedule.find((e) => e.day === todayName);
  if (!entry) {
    els.todaySummary.textContent = "Aujourd'hui : non renseigné";
  } else if (entry.type === "repos") {
    els.todaySummary.textContent = "Aujourd'hui : repos";
  } else if (entry.type === "formation") {
    els.todaySummary.textContent = "Aujourd'hui : formation";
  } else {
    els.todaySummary.textContent = `Aujourd'hui : ${entry.start}${entry.end ? " → " + entry.end : ""}`;
  }
}

/* ---------- HISTORY ---------- */
function addToHistory(imageDataUrl, schedule) {
  let history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  history.unshift({
    date: new Date().toISOString(),
    schedule,
    thumb: imageDataUrl,
  });
  history = history.slice(0, 5);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  els.historyList.innerHTML = "";
  if (history.length === 0) {
    const p = document.createElement("p");
    p.className = "history__empty";
    p.textContent = "Aucun planning importé pour le moment.";
    els.historyList.appendChild(p);
    return;
  }
  history.forEach((h, idx) => {
    const item = document.createElement("div");
    item.className = "history-item";
    const d = new Date(h.date);
    const label = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    item.innerHTML = `<span>${label}</span>`;
    const btn = document.createElement("button");
    btn.textContent = "Recharger";
    btn.addEventListener("click", () => {
      state.schedule = h.schedule;
      saveState();
      renderSchedule();
      els.cardResult.hidden = false;
      els.cardSettings.hidden = false;
      els.cardCalendar.hidden = false;
      recalcWakes();
      refreshTodaySummary();
      els.cardResult.scrollIntoView({ behavior: "smooth" });
    });
    item.appendChild(btn);
    els.historyList.appendChild(item);
  });
}

/* ---------- PERSISTENCE ---------- */
function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function loadState() {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    state = { ...state, ...saved };
    els.targetName.value = state.targetName || "MALICK";
    els.prepTime.value = state.prep ?? 60;
    els.travelTime.value = state.travel ?? 30;
    els.marginTime.value = state.margin ?? 10;
    if (state.schedule && state.schedule.length > 0) {
      renderSchedule();
      els.cardResult.hidden = false;
      els.cardSettings.hidden = false;
      els.cardCalendar.hidden = false;
      recalcWakes();
    }
  } catch (e) {
    console.warn("Impossible de charger l'état sauvegardé", e);
  }
}
