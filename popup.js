const els = {
  modelSelect: document.querySelector("#modelSelect"),
  modeSelect: document.querySelector("#modeSelect"),
  languageSelect: document.querySelector("#languageSelect"),
  baseInput: document.querySelector("#baseInput"),
  saveBase: document.querySelector("#saveBase"),
  resetBase: document.querySelector("#resetBase"),
  pagePanelEnabled: document.querySelector("#pagePanelEnabled"),
  refreshModels: document.querySelector("#refreshModels"),
  summarizeButton: document.querySelector("#summarizeButton"),
  stopButton: document.querySelector("#stopButton"),
  status: document.querySelector("#status"),
  paperMeta: document.querySelector("#paperMeta"),
  progressBar: document.querySelector("#progressBar"),
  phase: document.querySelector("#phase"),
  streamLabel: document.querySelector("#streamLabel"),
  streamOutput: document.querySelector("#streamOutput"),
  streamThinking: document.querySelector("#streamThinking"),
  processLog: document.querySelector("#processLog"),
  copyLog: document.querySelector("#copyLog"),
  clearLog: document.querySelector("#clearLog"),
  storageSummary: document.querySelector("#storageSummary"),
  storageDetails: document.querySelector("#storageDetails"),
  refreshStorage: document.querySelector("#refreshStorage"),
  clearStoredLogs: document.querySelector("#clearStoredLogs"),
  clearSourceCache: document.querySelector("#clearSourceCache"),
  clearSummaryCache: document.querySelector("#clearSummaryCache"),
  clearAllStorage: document.querySelector("#clearAllStorage"),
  originHelp: document.querySelector("#originHelp"),
  summaryOutput: document.querySelector("#summaryOutput")
};

let port = null;
let detectedPaper = null;
let isBusy = false;
let streamedResponse = "";
let streamedThinking = "";
let logLines = [];
let logClearedAt = 0;
let currentLanguage = "ko";

const UI = {
  ko: {
    checkingTab: "현재 탭을 확인하는 중...",
    pagePanelTitle: "페이지 UI 표시",
    pagePanelDesc: "arXiv 논문 페이지에 요약 패널을 표시합니다.",
    ollamaBase: "Ollama 주소",
    save: "저장",
    local: "로컬",
    model: "Ollama 모델",
    loadingModels: "모델 불러오는 중...",
    noModels: "설치된 모델 없음",
    mode: "요약 모드",
    fast: "빠름",
    standard: "표준",
    detailed: "자세히",
    language: "사용 언어",
    refresh: "새로고침",
    summarizePaper: "논문 요약",
    stop: "작업 중단",
    ollamaRequired: "Ollama가 실행 중이어야 합니다.",
    waiting: "대기",
    streamWaiting: "모델 응답 대기 중",
    streamTitle: "실시간 출력",
    thinkingTitle: "모델 thinking",
    streamPlaceholder: "요약을 시작하면 모델 출력이 스트리밍됩니다.",
    thinkingPlaceholder: "thinking 필드를 보내는 모델에서만 표시됩니다.",
    logTitle: "진행 로그",
    copy: "복사",
    clear: "지우기",
    noLog: "아직 기록된 로그가 없습니다.",
    originTitle: "Ollama HTTP 403 해결",
    originBody1: "터미널에서 아래 명령을 실행한 뒤 Ollama를 완전히 종료하고 다시 실행하세요.",
    originBody2: "터미널에서 직접 Ollama를 실행한다면 아래 명령으로 실행할 수 있습니다.",
    storageTitle: "로컬 저장",
    storageLoading: "저장 내용을 확인하는 중...",
    storageDetailsLoading: "저장된 항목을 확인하는 중...",
    deleteLogs: "로그 삭제",
    deleteSource: "전문 캐시 삭제",
    deleteSummary: "요약 캐시 삭제",
    deleteAll: "전체 삭제",
    summaryPlaceholder: "요약 결과가 여기에 표시됩니다.",
    settings: "설정",
    logs: "로그",
    sourceCache: "전문 캐시",
    summaryCache: "요약 캐시",
    emptyStorage: "저장된 항목이 없습니다.",
    delete: "삭제",
    on: "켜짐",
    off: "꺼짐",
    empty: "비어 있음",
    noSavedDate: "저장일 없음"
  },
  en: {
    checkingTab: "Checking the current tab...",
    pagePanelTitle: "Show page UI",
    pagePanelDesc: "Show the Ollarxiv panel on arXiv paper pages.",
    ollamaBase: "Ollama URL",
    save: "Save",
    local: "Local",
    model: "Ollama model",
    loadingModels: "Loading models...",
    noModels: "No installed models",
    mode: "Summary mode",
    fast: "Fast",
    standard: "Standard",
    detailed: "Detailed",
    language: "Language",
    refresh: "Refresh",
    summarizePaper: "Summarize paper",
    stop: "Stop task",
    ollamaRequired: "Ollama must be running.",
    waiting: "Idle",
    streamWaiting: "Waiting for model response",
    streamTitle: "Live output",
    thinkingTitle: "Model thinking",
    streamPlaceholder: "Model output will stream here after summarization starts.",
    thinkingPlaceholder: "Shown only for models that stream a thinking field.",
    logTitle: "Progress log",
    copy: "Copy",
    clear: "Clear",
    noLog: "No logs yet.",
    originTitle: "Fix Ollama HTTP 403",
    originBody1: "Run this command in Terminal, then fully quit and restart Ollama.",
    originBody2: "If you run Ollama directly from Terminal, start it like this.",
    storageTitle: "Local storage",
    storageLoading: "Checking stored data...",
    storageDetailsLoading: "Checking stored items...",
    deleteLogs: "Delete logs",
    deleteSource: "Delete source cache",
    deleteSummary: "Delete summary cache",
    deleteAll: "Delete all",
    summaryPlaceholder: "Summary will appear here.",
    settings: "Settings",
    logs: "Logs",
    sourceCache: "Source cache",
    summaryCache: "Summary cache",
    emptyStorage: "No stored items.",
    delete: "Delete",
    on: "On",
    off: "Off",
    empty: "Empty",
    noSavedDate: "No saved date"
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  wireEvents();
  connectPort();
  setBusy(false);
  loadPagePanelSetting();
  loadInterfaceLanguage();
  await detectCurrentPaper();
  sendPortMessage({ type: "LOAD_MODELS" });
  loadStorageOverview();
});

function wireEvents() {
  els.pagePanelEnabled.addEventListener("change", () => {
    setPagePanelEnabled(els.pagePanelEnabled.checked);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }
    if (changes.pagePanelEnabled) {
      els.pagePanelEnabled.checked = changes.pagePanelEnabled.newValue !== false;
    }
    if (changes.selectedLanguage) {
      setInterfaceLanguage(changes.selectedLanguage.newValue || "ko");
    }
  });

  els.refreshModels.addEventListener("click", () => {
    hideOriginHelp();
    setStatus(currentLanguage === "en" ? "Loading Ollama models..." : "Ollama 모델 목록을 가져오는 중...");
    sendPortMessage({ type: "LOAD_MODELS" });
  });

  els.summarizeButton.addEventListener("click", summarizeCurrentPaper);
  els.stopButton.addEventListener("click", () => {
    sendPortMessage({ type: "CANCEL" });
  });
  els.modelSelect.addEventListener("change", () => {
    els.summarizeButton.disabled = isBusy || !els.modelSelect.value || !detectedPaper;
    sendPortMessage({ type: "SAVE_MODEL", model: els.modelSelect.value });
  });
  els.modeSelect.addEventListener("change", () => {
    sendPortMessage({ type: "SAVE_MODE", mode: els.modeSelect.value });
  });
  els.languageSelect.addEventListener("change", () => {
    setInterfaceLanguage(els.languageSelect.value);
    loadStorageOverview();
    sendPortMessage({ type: "SAVE_LANGUAGE", language: els.languageSelect.value });
  });
  els.saveBase.addEventListener("click", () => {
    sendPortMessage({ type: "SAVE_OLLAMA_BASE", base: els.baseInput.value });
  });
  els.resetBase.addEventListener("click", () => {
    sendPortMessage({ type: "RESET_OLLAMA_BASE" });
  });
  els.copyLog.addEventListener("click", copyLog);
  els.clearLog.addEventListener("click", () => {
    clearLog();
    sendPortMessage({ type: "CLEAR_LOG", paperId: detectedPaper?.id || "" });
  });
  els.refreshStorage.addEventListener("click", loadStorageOverview);
  els.storageDetails.addEventListener("click", (event) => {
    const button = event.target.closest("[data-storage-key]");
    if (!button) {
      return;
    }
    removeStorageKey(button.dataset.storageKey);
  });
  els.clearStoredLogs.addEventListener("click", () => removeStorageByPrefix("processLog:", currentLanguage === "en" ? "Stored progress logs deleted." : "저장된 진행 로그를 삭제했습니다."));
  els.clearSourceCache.addEventListener("click", () => removeStorageByPrefix("sourceCache:", currentLanguage === "en" ? "Source text cache deleted." : "전문 텍스트 캐시를 삭제했습니다."));
  els.clearSummaryCache.addEventListener("click", () => removeStorageByPrefix("summaryCache:", currentLanguage === "en" ? "Summary cache deleted." : "요약 캐시를 삭제했습니다."));
  els.clearAllStorage.addEventListener("click", clearAllStorage);
}

function connectPort() {
  port = chrome.runtime.connect({ name: "arxiv-ollama-summary" });
  port.onMessage.addListener(handlePortMessage);
  port.onDisconnect.addListener(() => {
    const _disconnectError = chrome.runtime.lastError;
    port = null;
    if (isBusy) {
      setBusy(false);
      setStatus("확장 연결이 끊어졌습니다. 팝업을 다시 여세요.", true);
    }
  });
}

async function summarizeCurrentPaper() {
  if (!detectedPaper) {
    await detectCurrentPaper();
  }

  if (!detectedPaper) {
    setStatus("arXiv 논문 페이지에서 실행하세요.", true);
    return;
  }

  if (!els.modelSelect.value) {
    setStatus("사용할 Ollama 모델을 선택하세요.", true);
    return;
  }

  hideOriginHelp();
  sendPortMessage({
    type: "SUMMARIZE",
    paper: detectedPaper,
    model: els.modelSelect.value,
    mode: els.modeSelect.value
  });
}

function handlePortMessage(message) {
  if (message.type === "MODELS") {
    renderModels(message.models || [], message.selectedModel || "");
    els.modeSelect.value = message.selectedMode || "standard";
    setInterfaceLanguage(message.selectedLanguage || "ko");
    els.baseInput.value = message.ollamaBase || els.baseInput.value || "http://localhost:11434";
    hideOriginHelp();
    if (!isBusy && !hasSummaryOutput()) {
      setStatus(message.models?.length
        ? (currentLanguage === "en" ? `Found ${message.models.length} models.` : `${message.models.length}개 모델을 찾았습니다.`)
        : ui("noModels"), !message.models?.length);
    }
    return;
  }

  if (message.type === "OPTION_STATE") {
    if (message.selectedModel && [...els.modelSelect.options].some((option) => option.value === message.selectedModel)) {
      els.modelSelect.value = message.selectedModel;
    }
    if (message.selectedMode) {
      els.modeSelect.value = message.selectedMode;
    }
    if (message.selectedLanguage) {
      setInterfaceLanguage(message.selectedLanguage);
    }
    if (message.ollamaBase) {
      els.baseInput.value = message.ollamaBase;
    }
    return;
  }

  if (message.type === "OLLAMA_BASE_ERROR") {
    setStatus(message.message || "Ollama 주소를 저장할 수 없습니다.", true);
    return;
  }

  if (message.type === "SESSION_RESET") {
    applySessionReset(message);
    return;
  }

  if (message.type === "SESSION_STATE") {
    applySessionState(message.state || {});
    return;
  }

  if (message.type === "LOG") {
    appendLog(message.message || "", message.level || "info", message.timestamp);
    return;
  }

  if (message.type === "LOG_RESET") {
    clearLog();
    return;
  }

  if (message.type === "STATUS") {
    setStatus(message.status || "");
    if (message.status) {
      els.phase.textContent = statusToPhase(message.status);
    }
    if (typeof message.progress === "number") {
      setProgress(message.progress);
    }
    return;
  }

  if (message.type === "STREAM_START") {
    resetStream(message.phase || "모델 실행", message.label || "Ollama 응답 수신 중");
    return;
  }

  if (message.type === "STREAM_DELTA") {
    appendStream(message.channel, message.delta || "");
    return;
  }

  if (message.type === "STREAM_DONE") {
    if (message.evalCount) {
      els.streamLabel.textContent = `${els.streamLabel.textContent} · ${message.evalCount} tokens`;
    }
    return;
  }

  if (message.type === "PARTIAL") {
    setSummaryOutput(message.output || "");
    return;
  }

  if (message.type === "FINAL") {
    setSummaryOutput(message.output || "");
    if (!streamedResponse && /캐시/.test(message.status || "")) {
      els.streamOutput.textContent = translateUiText("캐시된 요약 결과를 사용했습니다.");
      els.streamLabel.textContent = translateUiText("캐시 사용");
    }
    setStatus(message.status || "완료");
    setProgress(message.progress || 100);
    hideOriginHelp();
    return;
  }

  if (message.type === "ERROR") {
    setBusy(false);
    setStatus(message.message || "요약 중 오류가 발생했습니다.", !message.aborted);
    if (message.code === "OLLAMA_FORBIDDEN") {
      showOriginHelp(message.help);
    }
    return;
  }

  if (message.type === "DONE") {
    setBusy(false);
    els.phase.textContent = ui("waiting");
  }
}

function renderModels(models, selectedModel) {
  els.modelSelect.innerHTML = "";

  if (!models.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = ui("noModels");
    els.modelSelect.appendChild(option);
    setBusy(isBusy);
    return;
  }

  for (const model of models) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    option.selected = model === selectedModel;
    els.modelSelect.appendChild(option);
  }

  setBusy(isBusy);
}

function sendPortMessage(message) {
  if (!port) {
    return;
  }

  try {
    port.postMessage(message);
  } catch (_error) {
    setStatus("확장 연결이 끊어졌습니다. 팝업을 다시 여세요.", true);
  }
}

function setBusy(nextBusy) {
  isBusy = nextBusy;
  els.summarizeButton.disabled = nextBusy || !els.modelSelect.value || !detectedPaper;
  els.refreshModels.disabled = nextBusy;
  els.stopButton.disabled = !nextBusy;
  els.modelSelect.disabled = nextBusy;
  els.modeSelect.disabled = nextBusy;
  els.languageSelect.disabled = nextBusy;
  els.baseInput.disabled = nextBusy;
  els.saveBase.disabled = nextBusy;
  els.resetBase.disabled = nextBusy;
}

function setStatus(message, isError = false) {
  els.status.textContent = translateUiText(message);
  els.status.classList.toggle("error", isError);
}

function statusToPhase(status) {
  const text = String(status || "");
  if (currentLanguage === "en") {
    if (/모델 목록|model/i.test(text)) {
      return "Model check";
    }
    if (/HTML 본문|본문|body|source/i.test(text)) {
      return "Source check";
    }
    if (/부분 요약/.test(text)) {
      const match = text.match(/부분 요약\s+([0-9]+\/[0-9]+)/);
      return match ? `Partial summary ${match[1]}` : "Partial summary";
    }
    if (/최종 요약|final/i.test(text)) {
      return "Final summary";
    }
    if (/완료|done|complete/i.test(text)) {
      return "Complete";
    }
    if (/준비|prepare|ready/i.test(text)) {
      return "Preparing";
    }
  }
  if (/모델 목록/.test(text)) {
    return "모델 확인";
  }
  if (/HTML 본문|본문/.test(text)) {
    return "본문 확인";
  }
  if (/부분 요약/.test(text)) {
    const match = text.match(/부분 요약\s+([0-9]+\/[0-9]+)/);
    return match ? `부분 요약 ${match[1]}` : "부분 요약";
  }
  if (/최종 요약/.test(text)) {
    return "최종 요약";
  }
  if (/완료/.test(text)) {
    return "완료";
  }
  if (/준비/.test(text)) {
    return "요약 준비";
  }
  return text.length > 16 ? `${text.slice(0, 16)}...` : text;
}

function setProgress(percent) {
  els.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function hasSummaryOutput() {
  const text = els.summaryOutput.textContent.trim();
  return Boolean(text && text !== UI.ko.summaryPlaceholder && text !== UI.en.summaryPlaceholder);
}

function setSummaryOutput(markdown) {
  els.summaryOutput.innerHTML = renderMarkdown(markdown || ui("summaryPlaceholder"));
}

function renderMarkdown(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let listType = "";

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = "";
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 2, 6);
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${renderInlineMarkdown(unordered[1])}</li>`);
      continue;
    }

    const ordered = line.match(/^([0-9]+)[.)]\s+(.+)$/);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        html.push(`<ol start="${ordered[1]}">`);
        listType = "ol";
      }
      html.push(`<li value="${ordered[1]}">${renderInlineMarkdown(ordered[2])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  closeList();
  return html.join("");
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function ui(key) {
  return (UI[currentLanguage] || UI.ko)[key] || UI.ko[key] || key;
}

function loadInterfaceLanguage() {
  chrome.storage.local.get(["selectedLanguage"], (items) => {
    setInterfaceLanguage(items.selectedLanguage || "ko");
  });
}

function setInterfaceLanguage(language) {
  currentLanguage = language === "en" ? "en" : "ko";
  els.languageSelect.value = currentLanguage;
  document.documentElement.lang = currentLanguage;
  applyInterfaceText();
}

function applyInterfaceText() {
  document.querySelector(".toggle-row strong").textContent = ui("pagePanelTitle");
  document.querySelector(".toggle-row small").textContent = ui("pagePanelDesc");
  document.querySelector(".server-field span").textContent = ui("ollamaBase");
  els.saveBase.textContent = ui("save");
  els.resetBase.textContent = ui("local");
  setFieldLabel(els.modelSelect, ui("model"));
  setFieldLabel(els.modeSelect, ui("mode"));
  setFieldLabel(els.languageSelect, ui("language"));
  setSelectOptionText(els.modeSelect, { fast: ui("fast"), standard: ui("standard"), detailed: ui("detailed") });
  setSelectOptionText(els.languageSelect, { ko: "한국어", en: "English" });
  if (!els.modelSelect.value && els.modelSelect.options.length === 1) {
    els.modelSelect.options[0].textContent = ui("loadingModels");
  }
  els.refreshModels.textContent = ui("refresh");
  els.summarizeButton.textContent = ui("summarizePaper");
  els.stopButton.textContent = ui("stop");
  document.querySelector(".stream-box h2").textContent = ui("streamTitle");
  document.querySelectorAll(".stream-box h2")[1].textContent = ui("thinkingTitle");
  document.querySelector(".log-header h2").textContent = ui("logTitle");
  els.copyLog.textContent = ui("copy");
  els.clearLog.textContent = ui("clear");
  els.originHelp.querySelector("strong").textContent = ui("originTitle");
  els.originHelp.querySelectorAll("p")[0].textContent = ui("originBody1");
  els.originHelp.querySelectorAll("p")[1].textContent = ui("originBody2");
  document.querySelector(".storage-header h2").textContent = ui("storageTitle");
  els.refreshStorage.textContent = ui("refresh");
  els.clearStoredLogs.textContent = ui("deleteLogs");
  els.clearSourceCache.textContent = ui("deleteSource");
  els.clearSummaryCache.textContent = ui("deleteSummary");
  els.clearAllStorage.textContent = ui("deleteAll");

  replaceIfPlaceholder(els.status, [UI.ko.ollamaRequired, UI.en.ollamaRequired], ui("ollamaRequired"));
  replaceIfPlaceholder(els.paperMeta, [UI.ko.checkingTab, UI.en.checkingTab], ui("checkingTab"));
  replaceIfPlaceholder(els.phase, [UI.ko.waiting, UI.en.waiting], ui("waiting"));
  replaceIfPlaceholder(els.streamLabel, [UI.ko.streamWaiting, UI.en.streamWaiting], ui("streamWaiting"));
  replaceIfPlaceholder(els.streamOutput, [UI.ko.streamPlaceholder, UI.en.streamPlaceholder], ui("streamPlaceholder"));
  replaceIfPlaceholder(els.streamThinking, [UI.ko.thinkingPlaceholder, UI.en.thinkingPlaceholder], ui("thinkingPlaceholder"));
  replaceIfPlaceholder(els.processLog, [UI.ko.noLog, UI.en.noLog], ui("noLog"));
  replaceIfPlaceholder(els.summaryOutput, [UI.ko.summaryPlaceholder, UI.en.summaryPlaceholder], ui("summaryPlaceholder"));
  replaceIfPlaceholder(els.storageSummary, [UI.ko.storageLoading, UI.en.storageLoading], ui("storageLoading"));
  replaceIfPlaceholder(els.storageDetails, [UI.ko.storageDetailsLoading, UI.en.storageDetailsLoading], ui("storageDetailsLoading"));
}

function setFieldLabel(control, text) {
  const label = control?.closest("label")?.querySelector("span");
  if (label) {
    label.textContent = text;
  }
}

function setSelectOptionText(select, labels) {
  for (const option of select.options) {
    if (labels[option.value]) {
      option.textContent = labels[option.value];
    }
  }
}

function replaceIfPlaceholder(element, candidates, nextText) {
  if (candidates.includes(element.textContent.trim())) {
    element.textContent = nextText;
  }
}

function translateUiText(value) {
  if (currentLanguage !== "en") {
    return value;
  }

  return String(value || "")
    .replace("Ollama 모델 목록을 확인하는 중...", "Checking Ollama models...")
    .replace("Ollama 모델 목록을 가져오는 중...", "Loading Ollama models...")
    .replace("Ollama에 설치된 모델이 없습니다.", "No Ollama models are installed.")
    .replace("Ollama 주소를 저장할 수 없습니다.", "Could not save the Ollama URL.")
    .replace("요약 준비 중...", "Preparing summary...")
    .replace("논문 본문을 가져오는 중...", "Loading paper text...")
    .replace("모델을 선택한 뒤 요약을 실행하세요.", "Select a model, then start summarization.")
    .replace("확장 연결이 끊어졌습니다. 팝업을 다시 여세요.", "Extension connection was closed. Reopen the popup.")
    .replace("arXiv 논문 페이지에서 실행하세요.", "Run this on an arXiv paper page.")
    .replace("사용할 Ollama 모델을 선택하세요.", "Select an Ollama model.")
    .replace("완료", "Complete")
    .replace("대기", "Idle")
    .replace("캐시된 요약 결과를 사용했습니다.", "Used cached summary.")
    .replace("캐시 사용", "Using cache")
    .replace("요약 중 오류가 발생했습니다.", "An error occurred during summarization.")
    .replace("Ollama 모델 목록 요청 시작", "Started Ollama model list request")
    .replace("Ollama 모델 목록 수신 완료", "Received Ollama model list")
    .replace("Ollama 모델 목록 요청 실패", "Failed to request Ollama model list")
    .replace("논문 본문 소스 확인 시작", "Started checking paper text sources")
    .replace("논문 본문 소스 선택", "Selected paper text source")
    .replace("요약 입력 준비 완료", "Summary input prepared")
    .replace("청크 요약 준비 완료", "Chunk summarization prepared")
    .replace("부분 요약", "Partial summary")
    .replace("최종 요약", "Final summary")
    .replace("단일 요약", "Single-pass summary")
    .replace("요약 시작", "Summary started")
    .replace("요약 완료", "Summary complete")
    .replace("오류 발생", "Error")
    .replace("본문 후보 요청", "Requested body candidate")
    .replace("본문 후보 사용 가능", "Body candidate available")
    .replace("본문 후보 건너뜀", "Skipped body candidate")
    .replace("본문 후보 텍스트가 너무 짧음", "Body candidate text too short")
    .replace("원본 소스 후보 요청", "Requested source candidate")
    .replace("원본 소스 후보 사용 가능", "Source candidate available")
    .replace("PDF 후보 요청", "Requested PDF candidate")
    .replace("PDF 후보 사용 가능", "PDF candidate available")
    .replace("전문 텍스트를 찾지 못해 arXiv 초록/메타데이터로 폴백", "No full text found; falling back to arXiv abstract/metadata")
    .replace("Ollama 스트리밍 시작", "Ollama streaming started")
    .replace("Ollama 스트리밍 완료", "Ollama streaming complete")
    .replace("요약 작업 중단됨", "Summary task cancelled")
    .replace("질문 수신", "Question received")
    .replace("질문 답변 시작", "Question answering started")
    .replace("질문 답변 모델 호출 시작", "Question answering model call started")
    .replace("질문 답변 완료", "Question answering complete")
    .replace("질문 답변 오류", "Question answering error")
    .replace("저장된 전문 캐시 사용", "Using stored source cache")
    .replace("빠름", "Fast")
    .replace("표준", "Standard")
    .replace("자세히", "Detailed");
}

function applySessionReset(message) {
  clearLog();
  hideOriginHelp();
  if (message.model && [...els.modelSelect.options].some((option) => option.value === message.model)) {
    els.modelSelect.value = message.model;
  }
  if (message.mode) {
    els.modeSelect.value = message.mode;
  }
  setSummaryOutput(currentLanguage === "en" ? "Loading paper text..." : "논문 본문을 가져오는 중...");
  resetStream(message.phase || ui("waiting"), message.streamLabel || (currentLanguage === "en" ? "Task started" : "작업 시작"));
  setProgress(message.progress || 0);
  setStatus(message.status || (currentLanguage === "en" ? "Preparing summary..." : "요약 준비 중..."));
  setBusy(true);
}

function applySessionState(state) {
  if (state.model && [...els.modelSelect.options].some((option) => option.value === state.model)) {
    els.modelSelect.value = state.model;
  }
  if (state.mode) {
    els.modeSelect.value = state.mode;
  }
  if (state.language) {
    els.languageSelect.value = state.language;
  }
  if (state.ollamaBase) {
    els.baseInput.value = state.ollamaBase;
  }
  els.phase.textContent = translateUiText(state.phase || ui("waiting"));
  els.streamLabel.textContent = translateUiText(state.streamLabel || ui("streamWaiting"));
  els.streamOutput.textContent = translateUiText(state.streamOutput || ui("streamPlaceholder"));
  els.streamThinking.textContent = translateUiText(state.streamThinking || ui("thinkingPlaceholder"));
  streamedResponse = state.streamOutput || "";
  streamedThinking = state.streamThinking || "";
  setSummaryOutput(state.output || ui("summaryPlaceholder"));
  setProgress(typeof state.progress === "number" ? state.progress : 0);
  setStatus(state.status || ui("ollamaRequired"), Boolean(state.statusIsError));
  if (Array.isArray(state.logs) && state.logs.length) {
    applyLogEntries(state.logs);
  } else if (state.isBusy || state.output || state.status) {
    applyLogEntries([]);
  }
  if (state.originHelp) {
    showOriginHelp(state.originHelp);
  } else {
    hideOriginHelp();
  }
  setBusy(Boolean(state.isBusy));
}

function resetStream(phase, label) {
  streamedResponse = "";
  streamedThinking = "";
  els.phase.textContent = phase;
  els.streamLabel.textContent = label;
  els.streamOutput.textContent = currentLanguage === "en" ? "Waiting for model output..." : "모델 출력 대기 중...";
  els.streamThinking.textContent = currentLanguage === "en" ? "Waiting for thinking field..." : "thinking 필드를 기다리는 중...";
}

function appendStream(channel, delta) {
  if (!delta) {
    return;
  }

  if (channel === "thinking") {
    streamedThinking += delta;
    els.streamThinking.textContent = streamedThinking;
    els.streamThinking.scrollTop = els.streamThinking.scrollHeight;
    return;
  }

  streamedResponse += delta;
  els.streamOutput.textContent = streamedResponse;
  els.streamOutput.scrollTop = els.streamOutput.scrollHeight;
}

function appendLog(message, level = "info", timestamp = new Date().toISOString()) {
  if (!message) {
    return;
  }

  const time = formatLogTime(timestamp);
  const label = level.toUpperCase();
  logLines.push(`[${time}] [${label}] ${translateUiText(message)}`);
  if (logLines.length > 400) {
    logLines = logLines.slice(-400);
  }
  els.processLog.textContent = logLines.join("\n");
  els.processLog.scrollTop = els.processLog.scrollHeight;
  persistLog();
}

function applyLogEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    logLines = [];
    els.processLog.textContent = ui("noLog");
    persistLog();
    return;
  }

  logLines = entries.slice(-400).map((entry) => {
    const time = formatLogTime(entry.timestamp);
    const label = String(entry.level || "info").toUpperCase();
    return `[${time}] [${label}] ${translateUiText(entry.message || "")}`;
  });
  els.processLog.textContent = logLines.join("\n");
  els.processLog.scrollTop = els.processLog.scrollHeight;
  persistLog();
}

function clearLog() {
  logClearedAt = Date.now();
  logLines = [];
  els.processLog.textContent = ui("noLog");
  removeStoredLog();
}

function loadStoredLog() {
  const key = logStorageKey();
  if (!key) {
    return;
  }

  const requestedAt = Date.now();
  chrome.storage.local.get([key], (items) => {
    if (logClearedAt && requestedAt <= logClearedAt) {
      return;
    }
    const stored = items[key];
    if (!Array.isArray(stored) || !stored.length) {
      return;
    }
    logLines = Array.from(new Set([...(stored || []), ...logLines])).slice(-400);
    els.processLog.textContent = logLines.join("\n");
    els.processLog.scrollTop = els.processLog.scrollHeight;
  });
}

function persistLog() {
  const key = logStorageKey();
  if (!key) {
    return;
  }
  chrome.storage.local.set({ [key]: logLines.slice(-400) });
}

function removeStoredLog() {
  const key = logStorageKey();
  if (!key) {
    return;
  }
  chrome.storage.local.remove(key, loadStorageOverview);
}

function loadPagePanelSetting() {
  chrome.storage.local.get(["pagePanelEnabled"], (items) => {
    els.pagePanelEnabled.checked = items.pagePanelEnabled !== false;
  });
}

function setPagePanelEnabled(enabled) {
  chrome.storage.local.set({ pagePanelEnabled: Boolean(enabled) }, () => {
    loadStorageOverview();
    setStatus(enabled
      ? (currentLanguage === "en" ? "Page UI is on. Open arXiv paper tabs will update." : "arXiv 페이지 UI 표시를 켰습니다. 열려 있는 논문 탭에 반영됩니다.")
      : (currentLanguage === "en" ? "Page UI is off. The panel is hidden on open arXiv paper tabs." : "arXiv 페이지 UI 표시를 껐습니다. 열려 있는 논문 탭에서 패널이 숨겨집니다."));
  });
}

function logStorageKey() {
  return detectedPaper?.id ? `processLog:${detectedPaper.id}` : "";
}

function loadStorageOverview() {
  chrome.storage.local.get(null, (items) => {
    const keys = Object.keys(items || {});
    const logKeys = keys.filter((key) => key.startsWith("processLog:"));
    const sourceKeys = keys.filter((key) => key.startsWith("sourceCache:"));
    const cacheKeys = keys.filter((key) => key.startsWith("summaryCache:"));
    const settings = ["ollamaBase", "selectedModel", "selectedMode", "selectedLanguage", "pagePanelEnabled"].filter((key) => key in items);
    const totalBytes = new Blob([JSON.stringify(items || {})]).size;
    els.storageSummary.innerHTML = [
      `<span>${ui("settings")} ${settings.length}</span>`,
      `<span>${ui("logs")} ${logKeys.length}</span>`,
      `<span>${ui("sourceCache")} ${sourceKeys.length}</span>`,
      `<span>${ui("summaryCache")} ${cacheKeys.length}</span>`,
      `<span>${formatBytes(totalBytes)}</span>`
    ].join("");
    renderStorageDetails(items || {});
  });
}

function renderStorageDetails(items) {
  const groups = [
    {
      title: ui("settings"),
      keys: ["ollamaBase", "selectedModel", "selectedMode", "selectedLanguage", "pagePanelEnabled"].filter((key) => key in items)
    },
    {
      title: ui("logTitle"),
      keys: Object.keys(items).filter((key) => key.startsWith("processLog:")).sort()
    },
    {
      title: ui("sourceCache"),
      keys: Object.keys(items).filter((key) => key.startsWith("sourceCache:")).sort()
    },
    {
      title: ui("summaryCache"),
      keys: Object.keys(items).filter((key) => key.startsWith("summaryCache:")).sort()
    }
  ];

  const html = groups.map((group) => {
    const rows = group.keys.length
      ? group.keys.map((key) => renderStorageRow(key, items[key])).join("")
      : `<p class="storage-empty">${escapeHtml(ui("emptyStorage"))}</p>`;
    return `<details open><summary>${escapeHtml(group.title)} <span>${group.keys.length}</span></summary><div class="storage-list">${rows}</div></details>`;
  }).join("");

  els.storageDetails.innerHTML = html;
}

function renderStorageRow(key, value) {
  const meta = describeStorageValue(key, value);
  return [
    "<div class=\"storage-item\">",
    "<div>",
    `<strong>${escapeHtml(meta.title)}</strong>`,
    `<small>${escapeHtml(meta.description)}</small>`,
    "</div>",
    `<button class="secondary" type="button" data-storage-key="${escapeHtml(key)}">${escapeHtml(ui("delete"))}</button>`,
    "</div>"
  ].join("");
}

function describeStorageValue(key, value) {
  if (key.startsWith("processLog:")) {
    return {
      title: key.replace("processLog:", "log "),
      description: `${Array.isArray(value) ? value.length : 0} ${currentLanguage === "en" ? "lines" : "줄"} · ${formatBytes(storageValueBytes(value))}`
    };
  }

  if (key.startsWith("sourceCache:")) {
    return {
      title: key.replace("sourceCache:", "source "),
      description: `${value?.sourceLabel || (currentLanguage === "en" ? "Source text" : "전문 텍스트")} · ${value?.chars || String(value?.text || "").length || 0} ${currentLanguage === "en" ? "chars" : "자"} · ${formatStorageDate(value?.savedAt)}`
    };
  }

  if (key.startsWith("summaryCache:")) {
    const parts = key.split(":");
    return {
      title: `summary ${parts[1] || ""}`,
      description: `${parts[2] || "mode"} · ${parts[3] || "language"} · ${value?.sourceLabel || (currentLanguage === "en" ? "Summary" : "요약")} · ${formatStorageDate(value?.savedAt)}`
    };
  }

  return {
    title: key,
    description: `${formatSettingValue(value)} · ${formatBytes(storageValueBytes(value))}`
  };
}

function formatSettingValue(value) {
  if (typeof value === "boolean") {
    return value ? ui("on") : ui("off");
  }
  if (value === "ko") {
    return currentLanguage === "en" ? "Korean" : "한국어";
  }
  if (value === "en") {
    return "English";
  }
  return String(value || ui("empty"));
}

function formatStorageDate(value) {
  if (!value) {
    return ui("noSavedDate");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function storageValueBytes(value) {
  return new Blob([JSON.stringify(value ?? null)]).size;
}

function removeStorageKey(key) {
  chrome.storage.local.remove(key, () => {
    if (key === logStorageKey()) {
      logLines = [];
      els.processLog.textContent = ui("noLog");
    }
    loadPagePanelSetting();
    loadStorageOverview();
    setStatus(currentLanguage === "en" ? `Deleted stored item: ${key}` : `저장 항목을 삭제했습니다: ${key}`);
  });
}

function removeStorageByPrefix(prefix, message) {
  chrome.storage.local.get(null, (items) => {
    const keys = Object.keys(items || {}).filter((key) => key.startsWith(prefix));
    if (!keys.length) {
      loadStorageOverview();
      setStatus(currentLanguage === "en" ? "No stored data to delete." : "삭제할 저장 데이터가 없습니다.");
      return;
    }
    chrome.storage.local.remove(keys, () => {
      if (prefix === "processLog:") {
        logLines = [];
        els.processLog.textContent = ui("noLog");
      }
      loadStorageOverview();
      setStatus(message);
    });
  });
}

function clearAllStorage() {
  chrome.storage.local.clear(() => {
    logLines = [];
    els.processLog.textContent = ui("noLog");
    loadPagePanelSetting();
    loadStorageOverview();
    setStatus(currentLanguage === "en" ? "All local storage data deleted." : "로컬 저장 데이터를 모두 삭제했습니다.");
    sendPortMessage({ type: "LOAD_MODELS" });
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function copyLog() {
  const text = logLines.join("\n");
  if (!text) {
    setStatus(currentLanguage === "en" ? "No logs to copy." : "복사할 로그가 없습니다.");
    return;
  }

  try {
    await copyTextToClipboard(text);
    setStatus(currentLanguage === "en" ? "Copied progress log to clipboard." : "진행 로그를 클립보드에 복사했습니다.");
  } catch (_error) {
    setStatus(currentLanguage === "en" ? "Failed to copy to clipboard." : "클립보드 복사에 실패했습니다.", true);
  }
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (_error) {
      // Fall through to the textarea fallback.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("copy failed");
  }
}

function formatLogTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }
  return date.toLocaleTimeString("ko-KR", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function showOriginHelp(help) {
  if (help?.setupCommand) {
    const codeBlocks = els.originHelp.querySelectorAll("code");
    codeBlocks[0].textContent = help.setupCommand;
    codeBlocks[1].textContent = help.serveCommand;
  }
  els.originHelp.hidden = false;
}

function hideOriginHelp() {
  els.originHelp.hidden = true;
}

function cleanText(value) {
  return (value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function compactText(value) {
  return cleanText(value).replace(/\s+/g, " ").trim();
}

function stripLabel(value, label) {
  return compactText(value).replace(new RegExp(`^${label}\\s*:?\\s*`, "i"), "").trim();
}

function parseArxivId(urlString) {
  try {
    const url = new URL(urlString);
    if (!/(^|\.)arxiv\.org$/i.test(url.hostname)) {
      return null;
    }

    const path = decodeURIComponent(url.pathname);
    const modern = path.match(/\/(?:abs|pdf|html|e-print)\/([0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?)(?:\.pdf)?/i);
    if (modern) {
      return modern[1].replace(/\.pdf$/i, "");
    }

    const legacy = path.match(/\/(?:abs|pdf|html|e-print)\/([a-z-]+(?:\.[A-Z]{2})?\/[0-9]{7}(?:v[0-9]+)?)(?:\.pdf)?/i);
    if (legacy) {
      return legacy[1].replace(/\.pdf$/i, "");
    }
  } catch (_error) {
    return null;
  }

  return null;
}

async function detectCurrentPaper() {
  try {
    const tab = await getActiveTab();
    const id = parseArxivId(tab.url || "");
    if (!id) {
      detectedPaper = null;
      els.paperMeta.textContent = currentLanguage === "en" ? "Run this on an arXiv paper page." : "arXiv 논문 페이지에서 실행하세요.";
      setStatus(currentLanguage === "en" ? "The current tab is not an arXiv abs/pdf page." : "현재 탭이 arXiv abs/pdf 페이지가 아닙니다.", true);
      setBusy(false);
      return;
    }

    detectedPaper = await getPaperMetadata(tab, id);
    const label = detectedPaper.title ? `${detectedPaper.title} (${detectedPaper.id})` : `arXiv:${detectedPaper.id}`;
    els.paperMeta.textContent = label;
    setStatus(currentLanguage === "en" ? "Select a model and summary mode, then start summarization." : "모델과 요약 모드를 선택한 뒤 요약을 실행하세요.");
    loadStoredLog();
    sendPortMessage({ type: "REGISTER_VIEW", paper: detectedPaper });
    setBusy(false);
  } catch (error) {
    detectedPaper = null;
    els.paperMeta.textContent = currentLanguage === "en" ? "Cannot read the current tab." : "현재 탭을 읽을 수 없습니다.";
    setStatus(error.message || (currentLanguage === "en" ? "Failed to check the current tab." : "현재 탭 확인에 실패했습니다."), true);
    setBusy(false);
  }
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      if (!tabs?.[0]) {
        reject(new Error("활성 탭을 찾을 수 없습니다."));
        return;
      }

      resolve(tabs[0]);
    });
  });
}

async function getPaperMetadata(tab, id) {
  let paper = null;

  if (tab.id) {
    try {
      const response = await sendTabMessage(tab.id, { type: "GET_ARXIV_METADATA" });
      if (response?.ok && response.paper?.id) {
        paper = response.paper;
      }
    } catch (_error) {
      paper = null;
    }
  }

  if (!paper?.title || !paper?.abstract) {
    try {
      const fetched = await fetchAbsMetadata(id);
      paper = { ...paper, ...fetched };
    } catch (_error) {
      paper = paper || { id };
    }
  }

  return {
    id: paper.id || id,
    title: paper.title || "",
    abstract: paper.abstract || "",
    authors: paper.authors || [],
    subjects: paper.subjects || "",
    comments: paper.comments || "",
    journalRef: paper.journalRef || "",
    doi: paper.doi || "",
    url: `https://arxiv.org/abs/${id}`
  };
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

async function fetchAbsMetadata(id) {
  const response = await fetch(`https://arxiv.org/abs/${id}`);
  if (!response.ok) {
    throw new Error(`arXiv 메타데이터 요청 실패: HTTP ${response.status}`);
  }

  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  return extractMetadataFromDocument(doc, `https://arxiv.org/abs/${id}`);
}

function extractMetadataFromDocument(doc, urlString) {
  const id = parseArxivId(urlString);
  const title = stripLabel(doc.querySelector("h1.title")?.textContent, "Title");
  const abstract = stripLabel(doc.querySelector("blockquote.abstract")?.textContent, "Abstract");
  const authorLinks = [...doc.querySelectorAll("div.authors a")]
    .map((node) => compactText(node.textContent))
    .filter(Boolean);
  const authorFallback = stripLabel(doc.querySelector("div.authors")?.textContent, "Authors")
    .split(/,\s*/)
    .map((name) => compactText(name))
    .filter(Boolean);

  return {
    id,
    title,
    abstract,
    authors: authorLinks.length ? authorLinks : authorFallback,
    subjects: compactText(doc.querySelector("td.subjects, .subjects")?.textContent),
    comments: compactText(doc.querySelector("td.comments, .comments")?.textContent),
    journalRef: compactText(doc.querySelector("td.journal-ref, .journal-ref")?.textContent),
    doi: compactText(doc.querySelector("td.doi, .doi")?.textContent)
  };
}
