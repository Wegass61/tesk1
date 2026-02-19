// ====== LOGIN GUARD ======
function getSessionUser() {
  return localStorage.getItem("session_user");
}
function requireLogin() {
  const u = getSessionUser();
  if (!u) {
    window.location.href = "index.html";
    return null;
  }
  return u;
}
const sessionUser = requireLogin();

// UI: userInfo varsa yaz
const userInfoEl = document.getElementById("userInfo");
if (userInfoEl && sessionUser) userInfoEl.textContent = ` ${sessionUser}`;

// Çıkış
const logoutBtn = document.getElementById("logoutBtn");
logoutBtn?.addEventListener("click", () => {
  localStorage.removeItem("session_user");
  window.location.href = "index.html";
});

// ====== SABİT OCR AYARLARI (Dropdown yok) ======
const OCR_LANG = "tur";
const OCR_MODE = "gray";
const OCR_SCALE = 2;
const OCR_PSM = "6";

// ====== LOG SİSTEMİ (localStorage) ======
const LOG_KEY = "ocr_logs_v1";

function loadLogs() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); }
  catch { return []; }
}
function saveLogs(logs) {
  localStorage.setItem(LOG_KEY, JSON.stringify(logs));
}
function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function recordOcr(username, foundCount) {
  const logs = loadLogs();
  logs.push({
    user: username,
    date: todayKey(),
    ts: new Date().toISOString(),
    found: Number(foundCount || 0)
  });
  saveLogs(logs);
}
function getUserOcrCount(username) {
  return loadLogs().filter(x => x.user === username).length;
}
function updateOcrCountUI(username) {
  const el = document.getElementById("ocrCount");
  if (!el) return;
  el.textContent = String(getUserOcrCount(username));
}
updateOcrCountUI(sessionUser);

// Opsiyonel: günlük toplam (istersen bir yere yazarsın)
function summarizeByDay(username) {
  const logs = loadLogs().filter(x => x.user === username);
  const map = {};
  for (const l of logs) map[l.date] = (map[l.date] || 0) + 1;
  return Object.keys(map).sort().map(date => ({ date, count: map[date] }));
}

// ====== ELEMENTLER ======
const imgInput = document.getElementById("imgInput");
const pickBtn = document.getElementById("pickBtn");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const previewImg = document.getElementById("previewImg");
const previewEmpty = document.getElementById("previewEmpty");

const progressBox = document.getElementById("progressBox");
const progressText = document.getElementById("progressText");
const barFill = document.getElementById("barFill");

const linesEl = document.getElementById("lines");
const resultMeta = document.getElementById("resultMeta");
const copyAllCsvBtn = document.getElementById("copyAllCsvBtn");

const toast = document.getElementById("toast");

let imageFile = null;
let parsedPeople = [];

// ====== TOAST ======
function showToast(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 1400);
}

// ====== CLIPBOARD ======
async function copyToClipboard(text) {
  const t = String(text || "");
  if (!t.trim()) return showToast("Boş şey kopyalanmaz 🙂");

  try {
    await navigator.clipboard.writeText(t);
    showToast("Kopyalandı ✅");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showToast("Kopyalandı ✅");
  }
}

// ====== FILE -> IMAGE ======
async function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ====== PREPROCESS ======
function preprocessToBlob(img, { scale = 2 } = {}) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const w = Math.max(1, Math.floor(img.naturalWidth * scale));
  const h = Math.max(1, Math.floor(img.naturalHeight * scale));
  canvas.width = w;
  canvas.height = h;

  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;

  const contrastFactor = 1.22;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    let gray = 0.299 * r + 0.587 * g + 0.114 * b;
    gray = (gray - 128) * contrastFactor + 128;
    gray = Math.max(0, Math.min(255, gray));
    d[i] = d[i + 1] = d[i + 2] = gray;
  }

  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png", 1.0);
  });
}

// ====== AYIKLAMA ======
function extractPhoneDigits(line) {
  const digits = String(line || "").replace(/[^\d]/g, "");
  return digits.length >= 10 ? digits : null;
}

const KNOWN_ROLES = [
  "BAŞKAN",
  "YÖNETİM ÜYESİ",
  "DENETİM ÜYESİ",
  "GENEL SEKRETER",
  "DENETİM KURULU",
  "YÖNETİM KURULU",
];

function parseRoleAndName(textNoPhone) {
  const t = (textNoPhone || "").trim().replace(/\s+/g, " ");
  for (const role of KNOWN_ROLES) {
    if (t === role) return { role, name: "" };
    if (t.startsWith(role + " ")) return { role, name: t.slice(role.length).trim() };
  }
  return { role: "", name: t };
}

function cleanName(name) {
  return (name || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildPeopleFromText(text) {
  const people = [];
  const lines = String(text || "")
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  for (const raw of lines) {
    const phone = extractPhoneDigits(raw);
    if (!phone) continue;

    const noDigits = raw.replace(/[0-9]/g, " ").replace(/\s+/g, " ").trim();
    const { role, name } = parseRoleAndName(noDigits);

    people.push({
      role,
      name: cleanName(name),
      phone,
      raw
    });
  }
  return people;
}

// ====== KART (her alanın yanında kopyala) ======
function makeKVRow(label, value, onCopy) {
  const frag = document.createDocumentFragment();

  const k = document.createElement("div");
  k.className = "k";
  k.textContent = label;

  const vRow = document.createElement("div");
  vRow.className = "vRow";

  const v = document.createElement("span");
  v.className = "v";
  v.textContent = value;

  const btn = document.createElement("button");
  btn.className = "copyInline";
  btn.type = "button";
  btn.textContent = "Kopyala";
  btn.disabled = !String(value || "").trim() || value === "-";
  btn.addEventListener("click", onCopy);

  vRow.appendChild(v);
  vRow.appendChild(btn);

  frag.appendChild(k);
  frag.appendChild(vRow);

  return frag;
}

function makePersonCard(p) {
  const card = document.createElement("div");
  card.className = "lineCard";

  const kv = document.createElement("div");
  kv.className = "kv";

  kv.appendChild(makeKVRow("İsim", p.name || "-", () => copyToClipboard(p.name || "")));
  kv.appendChild(makeKVRow("Numara", p.phone || "-", () => copyToClipboard(p.phone || "")));

  if (p.role) {
    kv.appendChild(makeKVRow("Görev", p.role, () => copyToClipboard(p.role)));
  }

  const raw = document.createElement("div");
  raw.className = "raw";
  raw.innerHTML = `<b>Satır:</b> ${escapeHtml(p.raw || "")}`;

  card.appendChild(kv);
  card.appendChild(raw);
  return card;
}

// ====== CSV KOPYALA ======
copyAllCsvBtn?.addEventListener("click", async () => {
  if (!parsedPeople.length) return;

  const header = "Gorev,Isim,Numara";
  const rows = parsedPeople.map(p => {
    const r = (p.role || "").replaceAll('"', '""');
    const n = (p.name || "").replaceAll('"', '""');
    const ph = (p.phone || "").replaceAll('"', '""');
    return `"${r}","${n}","${ph}"`;
  });

  await copyToClipboard([header, ...rows].join("\n"));
  showToast("CSV kopyalandı ✅");
});

// ====== FOTO SEÇ (GARANTİ) ======
pickBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  imgInput?.click();
});

imgInput?.addEventListener("change", () => {
  const f = imgInput.files?.[0];
  if (!f) return;

  imageFile = f;

  const url = URL.createObjectURL(f);
  if (previewImg) {
    previewImg.src = url;
    previewImg.style.display = "block";
  }
  if (previewEmpty) previewEmpty.style.display = "none";

  runBtn.disabled = false;
  clearBtn.disabled = false;

  linesEl.innerHTML = "";
  resultMeta.textContent = "OCR başlatmak için ‘OCR Başlat’ tıkla.";
  copyAllCsvBtn.disabled = true;

  parsedPeople = [];

  // Yaşlılar için istersen otomatik başlat:
  // runBtn.click();
});

// ====== TEMİZLE ======
clearBtn?.addEventListener("click", () => {
  if (imgInput) imgInput.value = "";
  imageFile = null;

  if (previewImg) {
    previewImg.src = "";
    previewImg.style.display = "none";
  }
  if (previewEmpty) previewEmpty.style.display = "block";

  runBtn.disabled = true;
  clearBtn.disabled = true;

  progressBox.style.display = "none";
  barFill.style.width = "0%";

  linesEl.innerHTML = "";
  resultMeta.textContent = "Henüz OCR yapılmadı.";
  copyAllCsvBtn.disabled = true;

  parsedPeople = [];
});

// ====== OCR BAŞLAT ======
runBtn?.addEventListener("click", async () => {
  if (!imageFile) return;

  runBtn.disabled = true;
  copyAllCsvBtn.disabled = true;

  linesEl.innerHTML = "";
  resultMeta.textContent = "OCR çalışıyor...";
  progressBox.style.display = "block";
  progressText.textContent = "Hazırlanıyor...";
  barFill.style.width = "0%";

  try {
    const imgEl = await fileToImage(imageFile);

    progressText.textContent = "Görüntü iyileştiriliyor...";
    barFill.style.width = "8%";

    const preBlob = await preprocessToBlob(imgEl, { scale: OCR_SCALE, mode: OCR_MODE });

    const { data } = await Tesseract.recognize(preBlob, OCR_LANG, {
      logger: (m) => {
        if (m.status) progressText.textContent = `${m.status}...`;
        if (typeof m.progress === "number") {
          const p = Math.max(8, Math.round(m.progress * 100));
          barFill.style.width = p + "%";
        }
      },
      tessedit_pageseg_mode: OCR_PSM
    });

    const text = (data?.text || "").trim();
    parsedPeople = buildPeopleFromText(text);

    if (!parsedPeople.length) {
      resultMeta.textContent = "Kişi bulunamadı. Foto daha net olmalı.";
      showToast("Kişi bulunamadı 😅");
      return;
    }

    // LOG: Başarılı OCR kaydı (kalıcı: localStorage)
    recordOcr(sessionUser, parsedPeople.length);
    updateOcrCountUI(sessionUser);

    resultMeta.textContent = `Toplam ${parsedPeople.length} kişi bulundu.`;

    for (const p of parsedPeople) {
      linesEl.appendChild(makePersonCard(p));
    }

    copyAllCsvBtn.disabled = false;
    showToast("OCR bitti ✅");
  } catch (e) {
    console.error(e);
    resultMeta.textContent = "Hata oluştu. F12 → Console bak.";
    showToast("Hata ❌");
  } finally {
    runBtn.disabled = false;
  }
});
