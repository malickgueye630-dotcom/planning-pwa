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
  origin: "",        // home address
  dest: "",          // work address
  mode: "DRIVING",   // DRIVING | WALKING | BICYCLING | TRANSIT
  navitiaKey: "",    // free Navitia API key, only needed for TRANSIT mode
  schedule: [],   // [{day, type, start, end}]
  wakes: [],      // [{day, wake, start}]
  weatherAdjust: {},   // {day: extraMinutes} — pluie/neige détectées via Open-Meteo
  theme: "dark",       // dark | light
  notifEnabled: false,  // re-armed automatically whenever the schedule changes
  pushUrl: "",       // URL du service de notifications push (Cloudflare Worker)
  pushVapidKey: "",  // clé publique VAPID correspondante
  pushSecret: "",    // doit correspondre au secret PUSH_SECRET côté serveur
};

let currentImageDataUrl = null;   // full original photo (data URL)
let cropImageDataUrl = null;      // cropped region, if user cropped (data URL)
let cropCorners = null;           // {tl,tr,br,bl} corner positions in stage px while cropping
let cropActiveHandle = null;      // corner key currently being dragged

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);

const els = {
  themeToggleBtn: $("themeToggleBtn"),
  preview: $("preview"),
  dropzoneEmpty: $("dropzoneEmpty"),
  cameraInput: $("cameraInput"),
  galleryInput: $("galleryInput"),
  targetName: $("targetName"),
  enhanceToggle: $("enhanceToggle"),
  analyzeBtn: $("analyzeBtn"),
  manualModeBtn: $("manualModeBtn"),
  cropRow: $("cropRow"),
  cropBtn: $("cropBtn"),
  cropStatus: $("cropStatus"),
  cropResetBtn: $("cropResetBtn"),
  cropper: $("cropper"),
  cropperStage: $("cropperStage"),
  cropperImage: $("cropperImage"),
  cropperPolygon: $("cropperPolygon"),
  cropHandles: {
    tl: $("cropHandleTl"),
    tr: $("cropHandleTr"),
    br: $("cropHandleBr"),
    bl: $("cropHandleBl"),
  },
  cropCancelBtn: $("cropCancelBtn"),
  cropConfirmBtn: $("cropConfirmBtn"),
  ocrProgress: $("ocrProgress"),
  ocrProgressBar: $("ocrProgressBar"),
  ocrProgressLabel: $("ocrProgressLabel"),
  cardResult: $("cardResult"),
  scheduleList: $("scheduleList"),
  addDayBtn: $("addDayBtn"),
  cardTravel: $("cardTravel"),
  originInput: $("originInput"),
  destInput: $("destInput"),
  travelMode: $("travelMode"),
  navitiaKeyField: $("navitiaKeyField"),
  navitiaKeyInput: $("navitiaKeyInput"),
  calcTravelBtn: $("calcTravelBtn"),
  travelResult: $("travelResult"),
  travelMapWrap: $("travelMapWrap"),
  travelSource: $("travelSource"),
  cardSettings: $("cardSettings"),
  prepTime: $("prepTime"),
  travelTime: $("travelTime"),
  marginTime: $("marginTime"),
  wakeList: $("wakeList"),
  weatherBtn: $("weatherBtn"),
  weatherResult: $("weatherResult"),
  weatherClearBtn: $("weatherClearBtn"),
  cardCalendar: $("cardCalendar"),
  downloadIcsBtn: $("downloadIcsBtn"),
  notifBtn: $("notifBtn"),
  notifNotice: $("notifNotice"),
  pushUrlInput: $("pushUrlInput"),
  pushVapidInput: $("pushVapidInput"),
  pushSecretInput: $("pushSecretInput"),
  checkTodayBtn: $("checkTodayBtn"),
  checkResult: $("checkResult"),
  historyList: $("historyList"),
  todaySummary: $("todaySummary"),
  cardStats: $("cardStats"),
  statHours: $("statHours"),
  statWorkDays: $("statWorkDays"),
  statRepos: $("statRepos"),
  statWake: $("statWake"),
  googleCalendarList: $("googleCalendarList"),
  shareBtn: $("shareBtn"),
  shareNotice: $("shareNotice"),
};

/* ---------- INIT ---------- */
window.addEventListener("DOMContentLoaded", () => {
  loadState();
  if (!state.pushVapidKey) state.pushVapidKey = els.pushVapidInput.value.trim();
  applyTheme(state.theme);
  renderHistory();
  refreshTodaySummary();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
});

els.themeToggleBtn.addEventListener("click", () => {
  state.theme = state.theme === "light" ? "dark" : "light";
  saveState();
  applyTheme(state.theme);
});

els.shareBtn.addEventListener("click", shareSchedule);

els.targetName.addEventListener("change", () => {
  state.targetName = els.targetName.value.trim().toUpperCase() || "MALICK";
  saveState();
});

els.cameraInput.addEventListener("change", (e) => handleImage(e.target.files[0]));
els.galleryInput.addEventListener("change", (e) => handleImage(e.target.files[0]));

els.analyzeBtn.addEventListener("click", runOcr);
els.manualModeBtn.addEventListener("click", startManualMode);
els.cropBtn.addEventListener("click", openCropper);
els.cropResetBtn.addEventListener("click", resetCrop);
els.cropCancelBtn.addEventListener("click", closeCropper);
els.cropConfirmBtn.addEventListener("click", confirmCrop);
for (const key of ["tl", "tr", "br", "bl"]) {
  els.cropHandles[key].addEventListener("pointerdown", (e) => onCropHandleDown(key, e));
}
els.addDayBtn.addEventListener("click", () => {
  state.schedule.push({ day: "Lundi", type: "work", start: "09:00", end: "17:00" });
  renderSchedule();
});
els.prepTime.addEventListener("input", recalcWakes);
els.travelTime.addEventListener("input", recalcWakes);
els.marginTime.addEventListener("input", recalcWakes);

els.originInput.addEventListener("change", () => { state.origin = els.originInput.value.trim(); saveState(); });
els.destInput.addEventListener("change", () => { state.dest = els.destInput.value.trim(); saveState(); });
els.travelMode.addEventListener("change", () => {
  state.mode = els.travelMode.value;
  saveState();
  updateNavitiaFieldVisibility();
});
els.navitiaKeyInput.addEventListener("change", () => {
  state.navitiaKey = els.navitiaKeyInput.value.trim();
  saveState();
});
els.calcTravelBtn.addEventListener("click", calcTravel);
els.weatherBtn.addEventListener("click", calcWeatherAdjustment);
els.weatherClearBtn.addEventListener("click", clearWeatherAdjustment);
els.downloadIcsBtn.addEventListener("click", downloadIcs);
els.notifBtn.addEventListener("click", enableNotifications);
els.pushUrlInput.addEventListener("change", () => { state.pushUrl = els.pushUrlInput.value.trim(); saveState(); });
els.pushVapidInput.addEventListener("change", () => { state.pushVapidKey = els.pushVapidInput.value.trim(); saveState(); });
els.pushSecretInput.addEventListener("change", () => { state.pushSecret = els.pushSecretInput.value.trim(); saveState(); });
els.checkTodayBtn.addEventListener("click", checkToday);

/* ---------- THEME ---------- */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
}

/* ---------- IMAGE IMPORT ---------- */
function handleImage(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    currentImageDataUrl = e.target.result;
    cropImageDataUrl = null;
    els.preview.src = currentImageDataUrl;
    els.preview.hidden = false;
    els.dropzoneEmpty.hidden = true;
    els.analyzeBtn.disabled = false;
    els.cropRow.hidden = false;
    els.cropStatus.hidden = true;
  };
  reader.readAsDataURL(file);
}

/* ---------- CROP (recadrage manuel à 4 coins + correction de perspective) ----------
 * Une simple sélection rectangulaire ne suffit pas quand la photo est prise de travers
 * (planning au mur, cadre sous verre, angle de prise de vue) : la ligne ciblée reste
 * inclinée dans le rectangle et empile visuellement plusieurs lignes pour l'OCR. On
 * laisse donc l'utilisateur positionner 4 coins sur les bords réels de sa ligne, puis
 * on redresse ce quadrilatère en un rectangle plat avant de lancer Tesseract.
 */
function openCropper() {
  els.cropperImage.src = currentImageDataUrl;
  els.cropConfirmBtn.disabled = false;
  els.cropper.hidden = false;
  els.cropper.scrollIntoView({ behavior: "smooth", block: "center" });

  const place = () => {
    initCropCorners();
    attachCropperEvents();
  };
  if (els.cropperImage.complete && els.cropperImage.naturalWidth) place();
  else els.cropperImage.onload = place;
}

function closeCropper() {
  els.cropper.hidden = true;
  detachCropperEvents();
}

function resetCrop() {
  cropImageDataUrl = null;
  els.preview.src = currentImageDataUrl;
  els.cropStatus.hidden = true;
}

function initCropCorners() {
  const rect = els.cropperStage.getBoundingClientRect();
  // Default to a tall band spanning most of the photo's height — the column
  // mapping needs the day-header row (Lundi…Dimanche) AND the target row
  // both inside the crop, so the starting guess should encourage "top to
  // bottom" rather than "a thin band around just my row".
  const marginX = rect.width * 0.05;
  const top = rect.height * 0.04;
  const bottom = rect.height * 0.96;
  cropCorners = {
    tl: { x: marginX, y: top },
    tr: { x: rect.width - marginX, y: top },
    br: { x: rect.width - marginX, y: bottom },
    bl: { x: marginX, y: bottom },
  };
  renderCropCorners();
}

function renderCropCorners() {
  if (!cropCorners) return;
  const rect = els.cropperStage.getBoundingClientRect();
  const pct = (v, total) => (total ? (v / total) * 100 : 0);

  for (const key of ["tl", "tr", "br", "bl"]) {
    const { x, y } = cropCorners[key];
    const handle = els.cropHandles[key];
    handle.style.left = pct(x, rect.width) + "%";
    handle.style.top = pct(y, rect.height) + "%";
  }

  const order = ["tl", "tr", "br", "bl"];
  const points = order
    .map((k) => `${pct(cropCorners[k].x, rect.width)},${pct(cropCorners[k].y, rect.height)}`)
    .join(" ");
  els.cropperPolygon.setAttribute("points", points);
}

function attachCropperEvents() {
  els.cropperStage.addEventListener("pointermove", onCropPointerMove);
  window.addEventListener("pointerup", onCropPointerUp);
}

function detachCropperEvents() {
  els.cropperStage.removeEventListener("pointermove", onCropPointerMove);
  window.removeEventListener("pointerup", onCropPointerUp);
  cropActiveHandle = null;
}

function onCropHandleDown(key, e) {
  e.preventDefault();
  cropActiveHandle = key;
}

function onCropPointerMove(e) {
  if (!cropActiveHandle || !cropCorners) return;
  const rect = els.cropperStage.getBoundingClientRect();
  cropCorners[cropActiveHandle] = {
    x: clamp(e.clientX - rect.left, 0, rect.width),
    y: clamp(e.clientY - rect.top, 0, rect.height),
  };
  renderCropCorners();
}

function onCropPointerUp() {
  cropActiveHandle = null;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerpPoint(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Computes the 2D affine matrix {a,b,c,d,e,f} mapping 3 source points to 3
 * destination points (dst = M * src). Used to texture-map small triangular
 * patches of the source image onto the warped output — Canvas2D has no
 * built-in projective transform, so a quad is approximated by subdividing
 * it into a fine grid of near-affine triangles (standard canvas perspective
 * warp technique).
 */
function affineFromTriangles(s0, s1, s2, d0, d1, d2) {
  const det = s0.x * (s1.y - s2.y) - s1.x * (s0.y - s2.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(det) < 1e-9) return null;
  function solve(d0v, d1v, d2v) {
    const a = (d0v * (s1.y - s2.y) - d1v * (s0.y - s2.y) + d2v * (s0.y - s1.y)) / det;
    const b = (s0.x * (d1v - d2v) - s1.x * (d0v - d2v) + s2.x * (d0v - d1v)) / det;
    const c = (s0.x * (s1.y * d2v - s2.y * d1v) - s1.x * (s0.y * d2v - s2.y * d0v) + s2.x * (s0.y * d1v - s1.y * d0v)) / det;
    return [a, b, c];
  }
  const [a, c, e] = solve(d0.x, d1.x, d2.x);
  const [b, d, f] = solve(d0.y, d1.y, d2.y);
  return { a, b, c, d, e, f };
}

function drawAffineTriangle(ctx, img, s0, s1, s2, d0, d1, d2) {
  const m = affineFromTriangles(s0, s1, s2, d0, d1, d2);
  if (!m) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y);
  ctx.lineTo(d1.x, d1.y);
  ctx.lineTo(d2.x, d2.y);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/** Warps the quadrilateral `corners` (in `img` natural-pixel coordinates) into a flat outW×outH canvas. */
function warpQuadToCanvas(img, corners, outW, outH) {
  const { tl, tr, br, bl } = corners;

  // Pre-crop to the quad's bounding box so each of the GRID² triangle draws
  // below blits a small bitmap instead of redrawing the entire (often
  // multi-megapixel) source photo hundreds of times.
  const minX = Math.max(0, Math.floor(Math.min(tl.x, tr.x, br.x, bl.x)));
  const minY = Math.max(0, Math.floor(Math.min(tl.y, tr.y, br.y, bl.y)));
  const maxX = Math.min(img.naturalWidth, Math.ceil(Math.max(tl.x, tr.x, br.x, bl.x)));
  const maxY = Math.min(img.naturalHeight, Math.ceil(Math.max(tl.y, tr.y, br.y, bl.y)));
  const boxW = Math.max(1, maxX - minX);
  const boxH = Math.max(1, maxY - minY);

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = boxW;
  cropCanvas.height = boxH;
  cropCanvas.getContext("2d").drawImage(img, minX, minY, boxW, boxH, 0, 0, boxW, boxH);

  const shift = (p) => ({ x: p.x - minX, y: p.y - minY });
  const local = { tl: shift(tl), tr: shift(tr), br: shift(br), bl: shift(bl) };

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");

  const GRID = 16;
  const srcAt = (u, v) => lerpPoint(lerpPoint(local.tl, local.tr, u), lerpPoint(local.bl, local.br, u), v);

  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const u0 = gx / GRID, u1 = (gx + 1) / GRID;
      const v0 = gy / GRID, v1 = (gy + 1) / GRID;

      const sTL = srcAt(u0, v0), sTR = srcAt(u1, v0), sBL = srcAt(u0, v1), sBR = srcAt(u1, v1);
      const dTL = { x: u0 * outW, y: v0 * outH };
      const dTR = { x: u1 * outW, y: v0 * outH };
      const dBL = { x: u0 * outW, y: v1 * outH };
      const dBR = { x: u1 * outW, y: v1 * outH };

      drawAffineTriangle(ctx, cropCanvas, sTL, sTR, sBL, dTL, dTR, dBL);
      drawAffineTriangle(ctx, cropCanvas, sTR, sBR, sBL, dTR, dBR, dBL);
    }
  }
  return canvas;
}

function confirmCrop() {
  if (!cropCorners) return;
  const stageRect = els.cropperStage.getBoundingClientRect();
  const img = els.cropperImage;
  const scaleX = img.naturalWidth / stageRect.width;
  const scaleY = img.naturalHeight / stageRect.height;
  const toNatural = (p) => ({ x: p.x * scaleX, y: p.y * scaleY });

  const corners = {
    tl: toNatural(cropCorners.tl),
    tr: toNatural(cropCorners.tr),
    br: toNatural(cropCorners.br),
    bl: toNatural(cropCorners.bl),
  };

  // Output size: average of the two horizontal/vertical edge lengths, with a
  // generous minimum so a thin row still gets enough pixels for OCR.
  const outW = Math.max(200, Math.round((dist(corners.tl, corners.tr) + dist(corners.bl, corners.br)) / 2));
  const outH = Math.max(60, Math.round((dist(corners.tl, corners.bl) + dist(corners.tr, corners.br)) / 2));

  const canvas = warpQuadToCanvas(img, corners, outW, outH);
  cropImageDataUrl = canvas.toDataURL("image/png");
  els.preview.src = cropImageDataUrl;
  els.cropStatus.hidden = false;
  closeCropper();
}

/* ---------- IMAGE PREPROCESSING ---------- */
/**
 * Upscale, grayscale, boost contrast and sharpen the source image to make
 * a small/dense/blurry printed table more legible for Tesseract.
 * Returns a <canvas> ready to be passed straight to Tesseract.recognize().
 */
function preprocessImage(sourceDataUrl, scale = 3) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, w, h);

        const imageData = ctx.getImageData(0, 0, w, h);
        grayscaleAndContrast(imageData.data);
        ctx.putImageData(imageData, 0, 0);

        sharpenCanvas(ctx, w, h);

        resolve(canvas);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = reject;
    img.src = sourceDataUrl;
  });
}

function grayscaleAndContrast(data) {
  // First pass: grayscale + find min/max luminance.
  let min = 255, max = 0;
  const lum = new Uint8ClampedArray(data.length / 4);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    lum[p] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }

  const range = Math.max(1, max - min);
  const contrastBoost = 1.35; // extra punch beyond pure stretch

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    let v = ((lum[p] - min) / range) * 255;
    v = clamp((v - 128) * contrastBoost + 128, 0, 255);
    data[i] = data[i + 1] = data[i + 2] = v;
  }
}

function sharpenCanvas(ctx, w, h) {
  const src = ctx.getImageData(0, 0, w, h);
  const dst = ctx.createImageData(w, h);
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  const sData = src.data;
  const dData = dst.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        dData[idx] = sData[idx];
        dData[idx + 1] = sData[idx + 1];
        dData[idx + 2] = sData[idx + 2];
        dData[idx + 3] = 255;
        continue;
      }
      let sum = 0;
      let k = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const nIdx = ((y + ky) * w + (x + kx)) * 4;
          sum += sData[nIdx] * kernel[k];
          k++;
        }
      }
      const v = clamp(sum, 0, 255);
      dData[idx] = dData[idx + 1] = dData[idx + 2] = v;
      dData[idx + 3] = 255;
    }
  }
  ctx.putImageData(dst, 0, 0);
}

/* ---------- MANUAL MODE ---------- */
function startManualMode() {
  state.targetName = els.targetName.value.trim().toUpperCase() || "MALICK";
  state.schedule = defaultEditableWeek();
  saveState();
  renderSchedule();
  els.cardResult.hidden = false;
  els.cardTravel.hidden = false;
  els.cardSettings.hidden = false;
  els.cardCalendar.hidden = false;
  els.checkResult.textContent = "Mode manuel : saisissez vos horaires jour par jour ci-dessous.";
  recalcWakes();
  refreshTodaySummary();
  els.cardResult.scrollIntoView({ behavior: "smooth" });
}

/* ---------- ANALYSE IA (Gemini, via le serveur Cloudflare Worker) ---------- */
async function resizeForUpload(dataUrl, maxDim) {
  const img = await loadImageEl(dataUrl);
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.85);
}

async function analyzeWithGemini(imageDataUrl, targetName) {
  const upload = await resizeForUpload(imageDataUrl, 1600);
  const res = await fetch(`${state.pushUrl.replace(/\/$/, "")}/analyze-schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Push-Secret": state.pushSecret || "" },
    body: JSON.stringify({ image: upload, targetName }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) throw new Error((data && data.error) || `analyze_http_${res.status}`);
  if (!Array.isArray(data.schedule)) throw new Error("bad_schedule_response");
  return data.schedule
    .map((e) => ({
      day: DAYS.includes(e.day) ? e.day : "",
      type: ["work", "repos", "formation"].includes(e.type) ? e.type : "work",
      start: typeof e.start === "string" ? e.start : "",
      end: typeof e.end === "string" ? e.end : "",
    }))
    .filter((e) => e.day);
}

/* ---------- OCR LOCAL (repli si le serveur d'analyse n'est pas configuré) ---------- */
async function runLocalOcr(baseImage) {
  const enhance = els.enhanceToggle.checked;
  const ocrSource = enhance ? await preprocessImage(baseImage, 3) : baseImage;

  setProgress(10, "Initialisation…");

  const result = await Tesseract.recognize(ocrSource, "fra", {
    logger: (m) => {
      if (m.status === "recognizing text") {
        setProgress(10 + Math.round(m.progress * 85), "Lecture en cours…");
      } else if (m.status) {
        setProgress(10, capitalize(m.status) + "…");
      }
    },
  });

  setProgress(95, "Recherche de votre ligne…");
  const text = result.data.text;
  const baseImg = await loadImageEl(baseImage);
  const ocrScale = enhance ? 3 : 1;
  const fromGeometry = await parsePlanningFromWordsWithZoom(
    result.data.blocks,
    state.targetName,
    baseImg,
    ocrScale
  );
  return fromGeometry || parsePlanning(text, state.targetName);
}

async function runOcr() {
  if (!currentImageDataUrl) return;
  state.targetName = els.targetName.value.trim().toUpperCase() || "MALICK";

  els.analyzeBtn.disabled = true;
  els.ocrProgress.hidden = false;
  setProgress(0, "Préparation de l'image…");

  const baseImage = cropImageDataUrl || currentImageDataUrl;
  let aiFailed = false;

  try {
    let parsed = null;

    if (state.pushUrl) {
      setProgress(20, "Analyse par IA (Gemini)…");
      try {
        parsed = await analyzeWithGemini(baseImage, state.targetName);
      } catch (err) {
        console.error("Échec de l'analyse IA, repli sur la lecture locale", err);
        aiFailed = true;
      }
    }

    if (!parsed) {
      setProgress(10, aiFailed ? "Repli sur la lecture locale…" : "Lecture locale (OCR)…");
      parsed = await runLocalOcr(baseImage);
    }

    setProgress(100, "Analyse terminée…");
    const confidence = assessConfidence(parsed);

    if (parsed.length === 0) {
      els.checkResult.textContent =
        `Le nom "${state.targetName}" n'a pas été détecté avec certitude sur cette image. ` +
        (aiFailed ? `Le serveur d'analyse IA n'a pas répondu (vérifiez l'URL configurée). ` : "") +
        `Une semaine vierge est affichée ci-dessous : complétez-la manuellement, ou essayez ` +
        `"Recadrer sur ma ligne MALICK" pour zoomer sur la bonne ligne avant de relancer l'analyse.`;
      state.schedule = defaultEditableWeek();
    } else if (!confidence.reliable) {
      els.checkResult.textContent =
        `"${state.targetName}" a été repéré, mais plusieurs horaires sont incertains ` +
        `(${confidence.missing} jour(s) sans heure claire). Vérifiez et complétez la semaine ` +
        `ci-dessous avant de générer le calendrier.`;
      state.schedule = parsed;
    } else {
      els.checkResult.textContent = "";
      state.schedule = parsed;
    }

    saveState();
    addToHistory(currentImageDataUrl, state.schedule);
    renderSchedule();
    els.cardResult.hidden = false;
    els.cardTravel.hidden = false;
    els.cardSettings.hidden = false;
    els.cardCalendar.hidden = false;
    recalcWakes();
    refreshTodaySummary();
    els.cardResult.scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    console.error(err);
    els.checkResult.textContent = "Erreur pendant la lecture de l'image. Réessayez avec une photo plus nette, ou utilisez le mode manuel rapide.";
  } finally {
    els.ocrProgress.hidden = true;
    els.analyzeBtn.disabled = false;
  }
}

/**
 * Heuristic confidence check: a "work" day with no readable start time
 * counts as missing. If too many days are missing, the OCR result is
 * surfaced as an editable (not silently REPOS) week so the user corrects it.
 */
function assessConfidence(parsed) {
  if (parsed.length === 0) return { reliable: false, missing: 7 };
  const missing = parsed.filter((d) => d.type === "work" && !d.start).length;
  return { reliable: missing <= 1, missing };
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

/* ---------- GEOMETRIC TABLE PARSING (word bounding boxes) ---------- */
/**
 * Plain OCR text from a dense, multi-employee schedule table interleaves
 * rows and columns once flattened to a single string — this is why the
 * line-based parser above can end up reading the wrong row entirely
 * (e.g. every day showing REPOS). This rebuilds the grid from Tesseract's
 * word-level bounding boxes instead: rows are clusters of words at the same
 * height, columns are derived from the x-position of the day-name headers,
 * and the target row is matched by name (with light fuzzy-matching since
 * OCR often misreads 1-2 letters of a name on a blurry/angled photo).
 */
function flattenWords(blocks) {
  const words = [];
  for (const block of blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        for (const word of line.words || []) {
          if (!word.text || !word.bbox) continue;
          words.push({
            text: word.text,
            x: (word.bbox.x0 + word.bbox.x1) / 2,
            y: (word.bbox.y0 + word.bbox.y1) / 2,
            height: word.bbox.y1 - word.bbox.y0,
          });
        }
      }
    }
  }
  return words;
}

function clusterRows(words) {
  if (words.length === 0) return [];
  const sorted = [...words].sort((a, b) => a.y - b.y);
  const heights = sorted.map((w) => w.height).filter((h) => h > 0).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 14;
  const threshold = medianHeight * 0.7;

  const rows = [];
  let current = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y - current[current.length - 1].y > threshold) {
      rows.push(current);
      current = [];
    }
    current.push(sorted[i]);
  }
  if (current.length) rows.push(current);
  return rows.map((r) => r.sort((a, b) => a.x - b.x));
}

function editDistanceCapped(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = [];
  for (let i = 0; i <= a.length; i++) dp.push([i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function rowMatchesName(row, target) {
  return row.some((w) => {
    const norm = normalize(w.text);
    if (norm.length < 3) return false;
    if (norm.includes(target) || target.includes(norm)) return true;
    return norm.length >= 4 && editDistanceCapped(norm, target) <= 1;
  });
}

const DAY_PREFIXES = DAYS.map((d) => normalize(d).slice(0, 3));

function findDayHeaderRow(rows) {
  let best = null;
  for (const row of rows) {
    const hits = [];
    for (const w of row) {
      const norm = normalize(w.text);
      const idx = DAY_PREFIXES.findIndex((p) => norm.startsWith(p));
      if (idx !== -1 && !hits.some((h) => h.dayIndex === idx)) {
        hits.push({ dayIndex: idx, x: w.x });
      }
    }
    if (hits.length >= 5 && (!best || hits.length > best.length)) {
      best = hits.sort((a, b) => a.x - b.x);
    }
  }
  return best;
}

function buildResultFromRow(headerHits, targetRow) {
  // Column boundaries: midpoints between consecutive day headers. The
  // first/last column stay open-ended so the name/role text to the left
  // and any trailing "Total" column to the right are dropped rather than
  // absorbed into Monday/Sunday.
  const xs = headerHits.map((h) => h.x);
  const boundaries = [-Infinity];
  for (let i = 0; i < xs.length - 1; i++) boundaries.push((xs[i] + xs[i + 1]) / 2);
  boundaries.push(Infinity);

  const result = [];
  for (let i = 0; i < headerHits.length; i++) {
    const dayName = DAYS[headerHits[i].dayIndex];
    const bucket = targetRow.filter((w) => w.x >= boundaries[i] && w.x < boundaries[i + 1]);
    const chunk = bucket.map((w) => w.text).join(" ");
    result.push(parseChunk(dayName, chunk));
  }

  // If the reconstruction still finds nothing usable, let the caller fall
  // back to the flat-text parser instead of confidently returning an
  // all-REPOS week.
  const usable = result.some((r) => r.type !== "work" || r.start);
  return usable ? result : null;
}

/**
 * Name cells are frequently printed on a colored background (blue/green
 * header bands in real schedule photos). At the resolution of a full-width,
 * multi-day crop, Tesseract's automatic page segmentation reliably fails to
 * even emit a word for that cell — there's nothing for rowMatchesName to
 * compare against, regardless of fuzzy tolerance. This finds the row a
 * cheap plain-text pass missed by re-OCRing just the name-column sliver of
 * each candidate row, heavily zoomed in and forced to single-line mode,
 * which is dramatically more reliable on the same blurry source photo.
 */
async function findTargetRowByZoom(img, scale, rows, headerHits, target) {
  if (typeof Tesseract === "undefined" || !Tesseract.createWorker) return null;
  const xs = headerHits.map((h) => h.x);
  const nameColEndOcrPx = Math.min(...xs) * 0.88;
  const nameColEndOrigPx = nameColEndOcrPx / scale;
  if (nameColEndOrigPx < 8) return null;

  const MAX_ROWS = 40;
  const candidates = rows.slice(0, MAX_ROWS);

  let worker;
  try {
    worker = await Tesseract.createWorker("fra");
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE });
  } catch (err) {
    return null;
  }

  let best = null;
  let bestScore = 2; // only accept matches scoring <= 1 (same tolerance as rowMatchesName)
  try {
    for (const row of candidates) {
      const yMin = Math.min(...row.map((w) => w.y - (w.height || 0) / 2));
      const yMax = Math.max(...row.map((w) => w.y + (w.height || 0) / 2));
      const yMinOrig = yMin / scale;
      const yMaxOrig = yMax / scale;
      if (yMaxOrig - yMinOrig < 4) continue;
      const pad = (yMaxOrig - yMinOrig) * 0.25;
      const canvas = buildZoomedRowCanvas(
        img,
        nameColEndOrigPx,
        Math.max(0, yMinOrig - pad),
        yMaxOrig + pad,
        170
      );
      try {
        const { data } = await worker.recognize(canvas);
        const score = nameTokenScore(data.text, target);
        if (score < bestScore) {
          bestScore = score;
          best = row;
          if (score === 0) break;
        }
      } catch (err) {
        // Skip rows the secondary pass can't read; the main loop continues.
      }
    }
  } finally {
    await worker.terminate();
  }

  return bestScore <= 1 ? best : null;
}

function nameTokenScore(text, target) {
  const tokens = normalize(text).replace(/[^A-Z]/g, " ").split(/\s+/).filter(Boolean);
  let best = 99;
  for (const tok of tokens) {
    if (tok.length < 3) continue;
    if (tok === target || tok.includes(target) || target.includes(tok)) return 0;
    if (tok.length >= 4) best = Math.min(best, editDistanceCapped(tok, target));
  }
  return best;
}

function buildZoomedRowCanvas(img, xEnd, yStart, yEnd, targetHeight) {
  const rowH = Math.max(1, yEnd - yStart);
  const scale = clamp(targetHeight / rowH, 1, 14);
  const outW = Math.max(1, Math.round(xEnd * scale));
  const outH = Math.max(1, Math.round(rowH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, yStart, xEnd, rowH, 0, 0, outW, outH);

  const imageData = ctx.getImageData(0, 0, outW, outH);
  grayscaleAndContrast(imageData.data);
  ctx.putImageData(imageData, 0, 0);
  sharpenCanvas(ctx, outW, outH);

  return canvas;
}

function loadImageEl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function parsePlanningFromWordsWithZoom(blocks, targetName, img, scale) {
  const words = flattenWords(blocks);
  if (words.length === 0) return null;

  const rows = clusterRows(words);
  const headerHits = findDayHeaderRow(rows);
  if (!headerHits) return null;

  const target = normalize(targetName);
  let targetRow = rows.find((row) => rowMatchesName(row, target));
  if (!targetRow) {
    targetRow = await findTargetRowByZoom(img, scale, rows, headerHits, target);
  }
  if (!targetRow) return null;

  return buildResultFromRow(headerHits, targetRow);
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

function defaultEditableWeek() {
  return DAYS.map((d) => ({ day: d, type: "work", start: "", end: "" }));
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
    removeBtn.setAttribute("aria-label", "Supprimer ce jour");
    removeBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
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
      const weatherExtra = (state.weatherAdjust && state.weatherAdjust[e.day]) || 0;
      const totalMin = state.prep + state.travel + state.margin + weatherExtra;
      const wake = subtractMinutes(e.start, totalMin);
      return { day: e.day, wake, start: e.start, weatherExtra };
    });

  state.wakes = wakes;
  saveState();
  renderWakes();
  renderStats();
  renderGoogleCalendarLinks();
  if (state.notifEnabled && "Notification" in window && Notification.permission === "granted") {
    if (state.pushUrl) {
      syncPushIfEnabled();
    } else {
      scheduleLocalReminders();
    }
  }
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
        <div class="wake-row__sub">prise de poste ${w.start}${w.weatherExtra ? ` · +${w.weatherExtra} min météo` : ""}</div>
      </div>
      <div class="wake-row__time">${w.wake}</div>
    `;
    els.wakeList.appendChild(row);
  });
}

/* ---------- STATISTIQUES ---------- */
function workMinutes(entry) {
  if (entry.type !== "work" || !entry.start || !entry.end) return 0;
  const [sh, sm] = entry.start.split(":").map(Number);
  const [eh, em] = entry.end.split(":").map(Number);
  let total = eh * 60 + em - (sh * 60 + sm);
  if (total <= 0) total += 24 * 60;
  return total;
}

function computeWeekStats() {
  const totalMin = state.schedule.reduce((sum, e) => sum + workMinutes(e), 0);
  const workCount = state.schedule.filter((e) => e.type === "work" && e.start && e.end).length;
  const reposCount = state.schedule.filter((e) => e.type === "repos").length;
  const earliestWake = state.wakes.length
    ? state.wakes.reduce((min, w) => (w.wake < min ? w.wake : min), state.wakes[0].wake)
    : null;
  return { totalMin, workCount, reposCount, earliestWake };
}

function renderStats() {
  if (state.schedule.length === 0) {
    els.cardStats.hidden = true;
    return;
  }
  const stats = computeWeekStats();
  els.cardStats.hidden = false;
  els.statHours.textContent = stats.totalMin > 0 ? formatDuration(stats.totalMin) : "—";
  els.statWorkDays.textContent = stats.workCount;
  els.statRepos.textContent = stats.reposCount;
  els.statWake.textContent = stats.earliestWake || "—";
}

/* ---------- GOOGLE CALENDAR (lien direct, gratuit, sans clé API) ----------
 * Complète l'export .ics : ouvre directement l'écran de création d'événement
 * de Google Calendar, pré-rempli, jour par jour. Aucun compte développeur,
 * aucune clé OAuth — juste une URL signée par les paramètres de l'événement.
 */
function googleCalendarUrl(entry) {
  const date = nextDateForDay(entry.day);
  const start = combineDateTime(date, entry.start);
  let end;
  if (entry.end) {
    end = combineDateTime(date, entry.end);
    if (end <= start) end = new Date(end.getTime() + 24 * 3600 * 1000);
  } else {
    end = new Date(start.getTime() + 8 * 3600 * 1000);
  }
  const fmt = (d) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `Travail — ${state.targetName}`,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: `Prise de poste ${entry.start}.`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function renderGoogleCalendarLinks() {
  els.googleCalendarList.innerHTML = "";
  const workDays = state.schedule.filter((e) => e.type === "work" && e.start);
  if (workDays.length === 0) {
    els.googleCalendarList.hidden = true;
    return;
  }
  els.googleCalendarList.hidden = false;
  workDays.forEach((entry) => {
    const a = document.createElement("a");
    a.href = googleCalendarUrl(entry);
    a.target = "_blank";
    a.rel = "noopener";
    a.className = "gcal-chip";
    a.textContent = entry.day;
    els.googleCalendarList.appendChild(a);
  });
}

/* ---------- PARTAGE ---------- */
function buildWeekSummaryText() {
  const lines = [`Planning de ${state.targetName} :`];
  state.schedule.forEach((e) => {
    if (e.type === "repos") {
      lines.push(`${e.day} : repos`);
    } else if (e.type === "formation") {
      lines.push(`${e.day} : formation`);
    } else if (e.start) {
      const wake = state.wakes.find((w) => w.day === e.day);
      lines.push(
        `${e.day} : ${e.start}${e.end ? " → " + e.end : ""}` +
          (wake ? ` (réveil ${wake.wake})` : "")
      );
    }
  });
  return lines.join("\n");
}

async function shareSchedule() {
  if (state.schedule.length === 0) return;
  const text = buildWeekSummaryText();
  if (navigator.share) {
    try {
      await navigator.share({ title: "Mon Planning", text });
    } catch (e) {
      // user cancelled the share sheet — nothing to do
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    els.shareNotice.hidden = false;
    els.shareNotice.textContent = "Planning copié dans le presse-papier.";
  } catch (e) {
    els.shareNotice.hidden = false;
    els.shareNotice.textContent = "Impossible de partager automatiquement sur cet appareil.";
  }
}

/* ---------- TRAJET (OPENSTREETMAP — gratuit, sans clé API) ----------
 * Géocodage : Nominatim (OpenStreetMap).
 * Itinéraire : serveurs OSRM publics FOSSGIS (routing.openstreetmap.de),
 * un par profil (voiture / vélo / piéton). Aucune clé, aucune carte
 * bancaire, aucun compte requis.
 */
const OSRM_PROFILES = {
  DRIVING: { base: "https://routing.openstreetmap.de/routed-car/route/v1/driving", label: "en voiture" },
  BICYCLING: { base: "https://routing.openstreetmap.de/routed-bike/route/v1/bike", label: "à vélo" },
  WALKING: { base: "https://routing.openstreetmap.de/routed-foot/route/v1/foot", label: "à pied" },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodeAddress(query) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=0&q=" +
    encodeURIComponent(query);
  const res = await fetch(url, { headers: { "Accept-Language": "fr" } });
  if (!res.ok) throw new Error("GEOCODE_HTTP");
  const data = await res.json();
  if (!data.length) throw new Error("GEOCODE_NOT_FOUND");
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

async function fetchRoute(mode, origin, dest) {
  const profile = OSRM_PROFILES[mode];
  const coords = `${origin.lon},${origin.lat};${dest.lon},${dest.lat}`;
  const url = `${profile.base}/${coords}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("ROUTE_HTTP");
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes || !data.routes.length) throw new Error("ROUTE_NOT_FOUND");
  return data.routes[0]; // { duration (s), distance (m), geometry (GeoJSON) }
}

/* ---------- TRAJET (TRANSPORTS EN COMMUN — Navitia, clé gratuite) ----------
 * Navitia (navitia.io) est le seul moyen gratuit de calculer un trajet en
 * transport en commun (métro, RER, bus...) sans dépendre de Google. Il
 * nécessite une clé API gratuite (inscription par email, sans carte
 * bancaire) — contrairement à la voiture/vélo/piéton qui ne demandent rien.
 */
function updateNavitiaFieldVisibility() {
  els.navitiaKeyField.hidden = els.travelMode.value !== "TRANSIT";
}

function formatNavitiaDatetime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) +
    "T" + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds())
  );
}

async function fetchTransitRoute(origin, dest, apiKey) {
  if (!apiKey) throw new Error("TRANSIT_NO_KEY");
  // Using the origin's coordinates as the Navitia "region" lets it
  // auto-resolve the right coverage area instead of hard-coding Paris.
  const region = `${origin.lon};${origin.lat}`;
  const datetime = formatNavitiaDatetime(new Date());
  const url =
    `https://api.navitia.io/v1/coverage/${encodeURIComponent(region)}/journeys` +
    `?from=${origin.lon};${origin.lat}&to=${dest.lon};${dest.lat}` +
    `&datetime=${datetime}&count=1`;
  const res = await fetch(url, { headers: { Authorization: "Basic " + btoa(apiKey + ":") } });
  if (res.status === 401 || res.status === 403) throw new Error("TRANSIT_BAD_KEY");
  if (!res.ok) throw new Error("TRANSIT_HTTP");
  const data = await res.json();
  const journey = data.journeys && data.journeys[0];
  if (!journey) throw new Error("TRANSIT_NOT_FOUND");
  return journey; // { duration (s), sections: [...] }
}

function journeyToGeometry(journey) {
  const coordinates = [];
  for (const section of journey.sections || []) {
    const geo = section.geojson;
    if (!geo || !geo.coordinates) continue;
    if (geo.type === "LineString") coordinates.push(...geo.coordinates);
    else if (geo.type === "MultiLineString") geo.coordinates.forEach((line) => coordinates.push(...line));
  }
  return coordinates.length >= 2 ? { type: "LineString", coordinates } : null;
}

function setTravelLoading(loading) {
  els.calcTravelBtn.disabled = loading;
  els.calcTravelBtn.classList.toggle("btn--loading", loading);
}

async function calcTravel() {
  const origin = els.originInput.value.trim();
  const dest = els.destInput.value.trim();
  const mode = els.travelMode.value;

  state.origin = origin;
  state.dest = dest;
  state.mode = mode;
  saveState();

  if (!origin || !dest) {
    els.travelResult.textContent = "Renseignez l'adresse de départ et l'adresse d'arrivée.";
    return;
  }

  setTravelLoading(true);
  els.travelResult.textContent = "Calcul du trajet en cours…";

  try {
    let originPt, destPt;
    try {
      originPt = await geocodeAddress(origin);
    } catch (e) {
      throw new Error("GEOCODE_ORIGIN");
    }
    await sleep(300); // reste courtois avec le service public Nominatim (≤1 req/s)
    try {
      destPt = await geocodeAddress(dest);
    } catch (e) {
      throw new Error("GEOCODE_DEST");
    }

    if (mode === "TRANSIT") {
      const journey = await fetchTransitRoute(originPt, destPt, state.navitiaKey);
      const minutes = Math.max(1, Math.round(journey.duration / 60));
      els.travelTime.value = minutes;
      state.travel = minutes;
      saveState();
      recalcWakes();

      els.travelResult.textContent =
        `Trajet en transports en commun : ${formatDuration(minutes)}. ` +
        `Le champ « Trajet » du réveil est passé à ${minutes} min.`;

      renderTravelMap(originPt, destPt, journeyToGeometry(journey));
      return;
    }

    let route;
    try {
      route = await fetchRoute(mode, originPt, destPt);
    } catch (e) {
      throw new Error("ROUTE_FAILED");
    }

    const minutes = Math.max(1, Math.round(route.duration / 60));
    els.travelTime.value = minutes;
    state.travel = minutes;
    saveState();
    recalcWakes();

    const profile = OSRM_PROFILES[mode];
    els.travelResult.textContent =
      `Trajet ${profile.label} : ${formatDuration(minutes)} (${formatDistance(route.distance)}). ` +
      `Le champ « Trajet » du réveil est passé à ${minutes} min.`;

    renderTravelMap(originPt, destPt, route.geometry);
  } catch (err) {
    els.travelResult.textContent = travelErrorMessage(err.message);
  } finally {
    setTravelLoading(false);
  }
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function travelErrorMessage(code) {
  switch (code) {
    case "GEOCODE_ORIGIN":
      return "Adresse de départ introuvable. Précisez-la (numéro, ville, code postal).";
    case "GEOCODE_DEST":
      return "Adresse d'arrivée introuvable. Précisez-la (numéro, ville, code postal).";
    case "ROUTE_FAILED":
      return "Aucun itinéraire trouvé entre ces deux adresses pour ce mode de transport.";
    case "TRANSIT_NO_KEY":
      return "Ajoutez votre clé Navitia gratuite (champ ci-dessus) pour activer les transports en commun.";
    case "TRANSIT_BAD_KEY":
      return "Clé Navitia invalide ou expirée. Vérifiez la clé collée dans le champ ci-dessus.";
    case "TRANSIT_NOT_FOUND":
      return "Aucun trajet en transports en commun trouvé entre ces deux adresses.";
    case "TRANSIT_HTTP":
      return "Impossible de contacter le service de transports en commun. Réessayez plus tard.";
    default:
      return "Impossible de calculer le trajet. Vérifiez votre connexion internet et réessayez.";
  }
}

/* ---------- CARTE (LEAFLET + OPENSTREETMAP) ---------- */
let travelMap = null;
let travelMapLayer = null;

function ensureTravelMap() {
  if (travelMap) return travelMap;
  travelMap = L.map("travelMap", { zoomControl: true, attributionControl: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors",
  }).addTo(travelMap);
  travelMap.setView([46.6, 2.3], 5); // vue par défaut : France
  return travelMap;
}

function renderTravelMap(originPt, destPt, geometry) {
  const map = ensureTravelMap();
  els.travelMapWrap.hidden = false;
  els.travelSource.hidden = false;

  if (travelMapLayer) {
    travelMapLayer.clearLayers();
    travelMapLayer.remove();
  }

  // Transit journeys without a usable route shape (e.g. missing geojson on
  // a Navitia section) fall back to a straight dashed line between the two
  // points, so the map and duration are still shown.
  const line = geometry
    ? L.geoJSON(geometry, { style: { color: "#F5A524", weight: 4 } })
    : L.polyline([[originPt.lat, originPt.lon], [destPt.lat, destPt.lon]], {
        color: "#F5A524",
        weight: 3,
        dashArray: "6 8",
      });
  const originMarker = L.marker([originPt.lat, originPt.lon]);
  const destMarker = L.marker([destPt.lat, destPt.lon]);
  travelMapLayer = L.layerGroup([line, originMarker, destMarker]).addTo(map);

  // The map container can be measured incorrectly while it was `hidden`.
  setTimeout(() => {
    map.invalidateSize();
    map.fitBounds(line.getBounds(), { padding: [28, 28] });
  }, 50);
}

/* ---------- RÉVEIL ADAPTÉ À LA MÉTÉO (Open-Meteo — gratuit, sans clé) ----------
 * Ajoute quelques minutes de marge au réveil les jours où de la pluie, de la
 * neige ou du verglas sont prévus à l'heure du trajet, en se basant sur les
 * prévisions horaires Open-Meteo pour l'adresse de départ déjà saisie dans
 * la carte Trajet. Open-Meteo ne demande ni compte ni clé API.
 */
const WEATHER_RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const WEATHER_SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

function weatherExtraMinutes(hour) {
  if (!hour) return 0;
  if (hour.snowfall > 0 || WEATHER_SNOW_CODES.has(hour.weathercode)) return 20;
  if (hour.precipitation > 0 || WEATHER_RAIN_CODES.has(hour.weathercode)) return 10;
  return 0;
}

function weatherLabel(hour) {
  if (hour.snowfall > 0 || WEATHER_SNOW_CODES.has(hour.weathercode)) return "neige/verglas";
  if (hour.precipitation > 0 || WEATHER_RAIN_CODES.has(hour.weathercode)) return "pluie";
  return "";
}

async function fetchHourlyForecast(point) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${point.lat}&longitude=${point.lon}` +
    "&hourly=precipitation,snowfall,weathercode&timezone=auto&forecast_days=7";
  const res = await fetch(url);
  if (!res.ok) throw new Error("WEATHER_HTTP");
  return res.json();
}

function findForecastHour(forecast, date) {
  const pad = (n) => String(n).padStart(2, "0");
  const key =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
  const idx = forecast.hourly.time.indexOf(key);
  if (idx === -1) return null;
  return {
    precipitation: forecast.hourly.precipitation[idx],
    snowfall: forecast.hourly.snowfall[idx],
    weathercode: forecast.hourly.weathercode[idx],
  };
}

async function calcWeatherAdjustment() {
  if (!state.origin) {
    els.weatherResult.textContent = "Renseignez d'abord votre adresse de départ dans la carte Trajet.";
    return;
  }
  els.weatherBtn.disabled = true;
  els.weatherResult.textContent = "Récupération des prévisions météo…";
  try {
    const origin = await geocodeAddress(state.origin);
    const forecast = await fetchHourlyForecast(origin);

    const notes = [];
    const adjust = {};
    state.schedule.forEach((entry) => {
      if (entry.type !== "work" || !entry.start) return;
      const startDate = combineDateTime(nextDateForDay(entry.day), entry.start);
      const hour = findForecastHour(forecast, startDate);
      const extra = weatherExtraMinutes(hour);
      if (extra > 0) {
        adjust[entry.day] = extra;
        notes.push(`${entry.day} : +${extra} min (${weatherLabel(hour)} prévue à ${entry.start})`);
      }
    });

    state.weatherAdjust = adjust;
    saveState();
    recalcWakes();

    els.weatherResult.textContent = notes.length
      ? "Ajustement appliqué :\n" + notes.join("\n")
      : "Pas de pluie ni de neige prévue sur les 7 prochains jours : aucun ajustement nécessaire.";
  } catch (err) {
    els.weatherResult.textContent = "Impossible de récupérer les prévisions météo. Réessayez plus tard.";
  } finally {
    els.weatherBtn.disabled = false;
  }
}

function clearWeatherAdjustment() {
  state.weatherAdjust = {};
  saveState();
  recalcWakes();
  els.weatherResult.textContent = "Ajustement météo désactivé.";
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
    const totalMin = state.prep + state.travel + state.margin + (wake ? wake.weatherExtra : 0);

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
let notifTimers = [];

async function enableNotifications() {
  if (!("Notification" in window)) {
    els.notifNotice.textContent = "Les notifications ne sont pas supportées sur ce navigateur. Utilisez l'export .ics.";
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    state.notifEnabled = false;
    saveState();
    els.notifNotice.textContent = "Notifications refusées. L'export .ics reste la solution la plus fiable sur iPhone.";
    return;
  }

  state.notifEnabled = true;
  saveState();

  if (state.pushUrl) {
    const ok = await subscribeToPush();
    if (ok) {
      els.notifNotice.textContent =
        "Notifications push activées : elles arrivent même si l'app est fermée. Elles se remettent à jour automatiquement à chaque changement d'horaire.";
      return;
    }
    els.notifNotice.textContent =
      "Impossible de joindre le service de notifications push. Vérifiez l'URL et le code secret, ou laissez-les vides pour les rappels locaux.";
  }

  els.notifNotice.textContent =
    "Rappels locaux activés. Ils se remettent à jour automatiquement à chaque changement d'horaire mais ne fonctionnent que si l'app reste ouverte ou récemment utilisée. Sur iPhone, gardez l'export .ics comme solution fiable.";
  scheduleLocalReminders();
}

function clearNotifTimers() {
  notifTimers.forEach((id) => clearTimeout(id));
  notifTimers = [];
}

function scheduleLocalReminders() {
  clearNotifTimers();
  state.wakes.forEach((w) => {
    const date = nextDateForDay(w.day);
    const wakeDate = combineDateTime(date, w.wake);
    const delay = wakeDate.getTime() - Date.now();
    if (delay > 0 && delay < 24 * 3600 * 1000) {
      const id = setTimeout(() => {
        new Notification("Réveil — " + state.targetName, {
          body: `Prise de poste ${w.start} aujourd'hui.`,
        });
      }, delay);
      notifTimers.push(id);
    }
  });
}

/* ---------- NOTIFICATIONS PUSH (Cloudflare Worker — service maison, gratuit) ----------
 * Web Push standard (RFC 8291/8292) : une fois abonné, le navigateur reçoit la
 * notification même si l'app/l'onglet est fermé. Le serveur (worker/) est un
 * Cloudflare Worker gratuit, sans dépendance, déployé séparément par l'utilisateur.
 */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function upcomingWakeTimestamps() {
  // nextDateForDay renvoie la prochaine occurrence de chaque jour de la
  // semaine (0 à 6 jours dans le futur) : un wake par jour distinct couvre
  // donc déjà toute la semaine à venir. Resynchronisé à chaque ouverture
  // de l'app pour couvrir la semaine suivante.
  return state.wakes
    .map((w) => combineDateTime(nextDateForDay(w.day), w.wake).toISOString())
    .sort();
}

async function subscribeToPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(state.pushVapidKey),
      });
    }
    return sendPushSubscriptionToServer(subscription);
  } catch (err) {
    console.warn("Abonnement push impossible", err);
    return false;
  }
}

async function sendPushSubscriptionToServer(subscription) {
  try {
    const res = await fetch(`${state.pushUrl.replace(/\/$/, "")}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Push-Secret": state.pushSecret || "" },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        targetName: state.targetName,
        wakeTimes: upcomingWakeTimestamps(),
      }),
    });
    return res.ok;
  } catch (err) {
    console.warn("Synchronisation push impossible", err);
    return false;
  }
}

async function syncPushIfEnabled() {
  if (!state.notifEnabled || !state.pushUrl || !("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) sendPushSubscriptionToServer(subscription);
  } catch (err) {
    console.warn("Synchronisation push impossible", err);
  }
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
      els.cardTravel.hidden = false;
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
    els.originInput.value = state.origin || "";
    els.destInput.value = state.dest || "";
    els.navitiaKeyInput.value = state.navitiaKey || "";
    els.pushUrlInput.value = state.pushUrl || "";
    if (state.pushVapidKey) els.pushVapidInput.value = state.pushVapidKey;
    els.pushSecretInput.value = state.pushSecret || "";
    const validModes = [...Object.keys(OSRM_PROFILES), "TRANSIT"];
    els.travelMode.value = validModes.includes(state.mode) ? state.mode : "DRIVING";
    updateNavitiaFieldVisibility();
    if (state.schedule && state.schedule.length > 0) {
      renderSchedule();
      els.cardResult.hidden = false;
      els.cardTravel.hidden = false;
      els.cardSettings.hidden = false;
      els.cardCalendar.hidden = false;
      recalcWakes();
    }
  } catch (e) {
    console.warn("Impossible de charger l'état sauvegardé", e);
  }
}
