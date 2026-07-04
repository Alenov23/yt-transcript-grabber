// popup.js — popup que llama al backend local (localhost:8000).

const BACKEND_URL = "http://localhost:8000/transcript";
const LANGUAGES_URL = "http://localhost:8000/languages";

const statusEl = document.getElementById("status");
const controlsEl = document.getElementById("controls");
const langSelect = document.getElementById("language");
const showTimestampsEl = document.getElementById("show-timestamps");
const fetchBtn = document.getElementById("fetch");
const btnLabel = fetchBtn.querySelector(".btn-label");
const spinner = fetchBtn.querySelector(".spinner");
const errorEl = document.getElementById("error");
const resultEl = document.getElementById("result");
const copyBtn = document.getElementById("copy");
const downloadTxtBtn = document.getElementById("download-txt");
const downloadSrtBtn = document.getElementById("download-srt");
const metaEl = document.getElementById("meta");

let currentVideoId = null;
let segments = []; // guardados para re-formatear al togglear timestamps

const LANG_LABELS = {
  es: "Spanish", en: "English", de: "German", fr: "French", it: "Italian",
  pt: "Portuguese", ca: "Catalan", ja: "Japanese", "zh-Hans": "Chinese", "zh-Hant": "Chinese (traditional)",
  ko: "Korean", ru: "Russian", ar: "Arabic", hi: "Hindi", nl: "Dutch", pl: "Polish", sv: "Swedish",
  tr: "Turkish", uk: "Ukrainian", el: "Greek", "es-419": "Spanish (Latam)", "pt-BR": "Portuguese (Brazil)",
  "pt-PT": "Portuguese (Portugal)", "de-DE": "German (Germany)", "en-US": "English (US)",
  id: "Indonesian", zh: "Chinese",
};

function parseVideoId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      return /[A-Za-z0-9_-]{11}/.test(id) ? id : null;
    }
    if (host.endsWith("youtube.com")) {
      if (u.searchParams.get("v")) {
        const v = u.searchParams.get("v");
        return /[A-Za-z0-9_-]{11}/.test(v) ? v : null;
      }
      const parts = u.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "v"].includes(parts[0]) && /[A-Za-z0-9_-]{11}/.test(parts[1])) {
        return parts[1];
      }
    }
  } catch {
    return null;
  }
  return null;
}

function formatTime(seconds) {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  return m + ":" + String(s).padStart(2, "0");
}

function formatSrtTime(seconds) {
  const totalMs = Math.round(seconds * 1000);
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return (
    String(h).padStart(2, "0") + ":" +
    String(m).padStart(2, "0") + ":" +
    String(s).padStart(2, "0") + "," +
    String(ms).padStart(3, "0")
  );
}

function renderText() {
  if (segments.length === 0) return "";
  if (showTimestampsEl.checked) {
    return segments
      .map((s) => formatTime(s.start) + " " + s.text)
      .join("\n");
  }
  return segments.map((s) => s.text).join(" ");
}

function buildSrt() {
  let out = "";
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    out += (i + 1) + "\n";
    out += formatSrtTime(s.start) + " --> " + formatSrtTime(s.start + s.duration) + "\n";
    out += s.text + "\n\n";
  }
  return out;
}

function setError(message) {
  errorEl.textContent = message;
  errorEl.hidden = !message;
  if (message) {
    fetchBtn.classList.add("is-error");
    btnLabel.textContent = "Retry";
  } else {
    fetchBtn.classList.remove("is-error");
    btnLabel.textContent = "Get transcript";
  }
  spinner.hidden = true;
  fetchBtn.disabled = false;
}

function setLoading(loading) {
  fetchBtn.disabled = loading;
  fetchBtn.classList.toggle("is-loading", loading);
  spinner.hidden = !loading;
  btnLabel.textContent = loading ? "Extracting…" : "Get transcript";
  resultEl.readOnly = loading;
  if (loading) {
    resultEl.value = "";
    resultEl.placeholder = "Extracting transcript…";
  } else {
    resultEl.placeholder = "The transcript will appear here. You can edit it.";
  }
}

function setActionsEnabled(enabled) {
  copyBtn.disabled = !enabled;
  downloadTxtBtn.disabled = !enabled;
  downloadSrtBtn.disabled = !enabled;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function populateLanguages(available, defaultLang) {
  langSelect.innerHTML = "";

  if (available && available.length > 0) {
    const autoOpt = document.createElement("option");
    autoOpt.value = "auto";
    autoOpt.textContent = "Auto";
    langSelect.appendChild(autoOpt);

    available.forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l.code;
      opt.textContent = (LANG_LABELS[l.code] || l.name || l.code) + (l.is_generated ? " (auto)" : "");
      langSelect.appendChild(opt);
    });

    if (defaultLang) {
      for (const opt of langSelect.options) {
        if (opt.value === defaultLang) {
          langSelect.value = defaultLang;
          return;
        }
      }
      for (const opt of langSelect.options) {
        if (opt.value.startsWith(defaultLang)) {
          langSelect.value = opt.value;
          return;
        }
      }
    }
    langSelect.value = "auto";
    return;
  }

  // Fallback static
  const fallback = [
    ["auto", "Auto"], ["es", "Spanish"], ["en", "English"], ["de", "German"],
    ["fr", "French"], ["it", "Italian"], ["pt", "Portuguese"], ["ru", "Russian"],
    ["ja", "Japanese"], ["zh", "Chinese"], ["ko", "Korean"],
  ];
  fallback.forEach(([code, label]) => {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = label;
    langSelect.appendChild(opt);
  });
}

async function init() {
  const tab = await getActiveTab();
  const url = tab?.url || "";
  currentVideoId = parseVideoId(url);

  if (!currentVideoId || !/youtube\.com|youtu\.be/.test(url)) {
    statusEl.textContent = "Open a YouTube video to use the extension.";
    controlsEl.hidden = true;
    return;
  }

  statusEl.textContent = `Vídeo: ${currentVideoId} · loading languages…`;
  controlsEl.hidden = false;

  try {
    const res = await fetch(LANGUAGES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.languages) {
        populateLanguages(data.languages, data.default);
        statusEl.textContent = `${data.languages.length} languages · selected: ${langSelect.options[langSelect.selectedIndex]?.textContent}`;
        return;
      }
    }
  } catch (e) {}

  populateLanguages(null, null);
  statusEl.textContent = `Vídeo: ${currentVideoId}`;
  
  // Auto transcribe when popup opens
  setTimeout(() => fetchBtn.click(), 300);
}

fetchBtn.addEventListener("click", async () => {
  setError("");
  const tab = await getActiveTab();
  const url = tab?.url || "";
  if (!url || !/youtube\.com|youtu\.be/.test(url)) {
    setError("Open a YouTube video first.");
    return;
  }

  setLoading(true);
  setActionsEnabled(false);
  metaEl.hidden = true;

  try {
    const res = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        language: langSelect.value || "auto",
        format: "segments",
        no_timestamps: false,
        clean_noise: true,
      }),
    });

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error("Backend responded unexpectedly. Is it running?");
    }

    if (!res.ok) {
      throw new Error(data.error || `Backend error (HTTP ${res.status}).`);
    }

    segments = data.segments || [];
    resultEl.value = renderText();
    currentVideoId = data.video_id || currentVideoId;
    metaEl.textContent = `${data.source || "?"} · ${data.language || "?"} · ${segments.length} segments`;
    metaEl.hidden = false;
    setActionsEnabled(true);
    setLoading(false);
  } catch (e) {
    setLoading(false);
    setActionsEnabled(false);
    if (e.message.includes("Failed to fetch") || e.message.includes("NetworkError")) {
      setError("Could not connect to backend. Start: uv run uvicorn app.main:app --reload");
    } else {
      setError(e.message || "Could not extract transcript.");
    }
  }
});

// Re-render al togglear timestamps (sin volver a pedir al backend).
showTimestampsEl.addEventListener("change", () => {
  if (segments.length > 0) {
    resultEl.value = renderText();
  }
});

// Auto transcribe when popup opens
setTimeout(() => fetchBtn.click(), 300);

copyBtn.addEventListener("click", async () => {
  const text = resultEl.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const original = copyBtn.textContent;
    copyBtn.textContent = "Copied";
    setTimeout(() => { copyBtn.textContent = original; }, 1200);
  } catch {
    setError("Could not copy to clipboard.");
  }
});

downloadTxtBtn.addEventListener("click", () => {
  const text = resultEl.value;
  if (!text) return;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = `transcript_${currentVideoId || "video"}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(u);
});

downloadSrtBtn.addEventListener("click", () => {
  if (segments.length === 0) return;
  const srt = buildSrt();
  const blob = new Blob([srt], { type: "text/plain;charset=utf-8" });
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = `transcript_${currentVideoId || "video"}.srt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(u);
});

init();
