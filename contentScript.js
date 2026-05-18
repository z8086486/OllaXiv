(() => {
  const PANEL_ID = "ao-ollama-summary";
  const PAGE_PANEL_ENABLED_KEY = "pagePanelEnabled";

  let port = null;
  let paper = null;
  let isBusy = false;
  let streamedResponse = "";
  let streamedThinking = "";
  let logLines = [];
  let logClearedAt = 0;
  let chatBusy = false;
  let currentLanguage = "ko";

  const refs = {};
  const UI = {
    ko: {
      hint: "논문 요약과 질의응답을 펼쳐서 확인하세요.",
      expand: "펼치기",
      collapse: "접기",
      ollamaBase: "Ollama 주소",
      saveBase: "주소 저장",
      resetBase: "로컬로 리셋",
      model: "모델",
      loadingModels: "모델 불러오는 중...",
      noModels: "설치된 모델 없음",
      mode: "요약 모드",
      fast: "빠름",
      standard: "표준",
      detailed: "자세히",
      refresh: "새로고침",
      summarize: "요약",
      summarizePaper: "논문 요약",
      cancel: "중단",
      checkingModels: "Ollama 모델 목록을 확인하는 중...",
      waiting: "대기",
      streamWaiting: "모델 응답 대기 중",
      resultTitle: "요약 결과",
      summaryPlaceholder: "요약 결과가 여기에 표시됩니다.",
      chatTitle: "논문에 질문",
      clearChat: "대화 지우기",
      chatPlaceholder: "요약 후 궁금한 점을 물어보세요. 답변에는 근거 위치가 함께 표시됩니다.",
      questionPlaceholder: "예: 이 논문의 핵심 가정은 뭐야?",
      ask: "질문",
      streamTitle: "실시간 출력",
      streamPlaceholder: "요약을 시작하면 모델 출력이 스트리밍됩니다.",
      thinkingTitle: "모델 thinking",
      thinkingPlaceholder: "thinking 필드를 보내는 모델에서만 표시됩니다.",
      logTitle: "진행 로그",
      copy: "복사",
      clear: "지우기",
      noLog: "아직 기록된 로그가 없습니다.",
      originTitle: "Ollama HTTP 403 해결",
      originBody1: "터미널에서 아래 명령을 실행한 뒤 Ollama를 완전히 종료하고 다시 실행하세요.",
      originBody2: "터미널에서 직접 Ollama를 실행한다면 아래 명령으로 실행할 수 있습니다.",
      questionLabel: "질문",
      answerLabel: "답변",
      answering: "답변 생성 중...",
      evidenceCount: "근거 {count}개 보기",
      unknownLocation: "위치 미상"
    },
    en: {
      hint: "Expand to summarize the paper and ask questions.",
      expand: "Expand",
      collapse: "Collapse",
      ollamaBase: "Ollama URL",
      saveBase: "Save URL",
      resetBase: "Reset to local",
      model: "Model",
      loadingModels: "Loading models...",
      noModels: "No installed models",
      mode: "Summary mode",
      fast: "Fast",
      standard: "Standard",
      detailed: "Detailed",
      refresh: "Refresh",
      summarize: "Summarize",
      summarizePaper: "Summarize paper",
      cancel: "Cancel",
      checkingModels: "Checking Ollama models...",
      waiting: "Idle",
      streamWaiting: "Waiting for model response",
      resultTitle: "Summary",
      summaryPlaceholder: "Summary will appear here.",
      chatTitle: "Ask about the paper",
      clearChat: "Clear chat",
      chatPlaceholder: "Ask a question after summarization. Answers include evidence locations.",
      questionPlaceholder: "Example: What is the core assumption of this paper?",
      ask: "Ask",
      streamTitle: "Live output",
      streamPlaceholder: "Model output will stream here after summarization starts.",
      thinkingTitle: "Model thinking",
      thinkingPlaceholder: "Shown only for models that stream a thinking field.",
      logTitle: "Progress log",
      copy: "Copy",
      clear: "Clear",
      noLog: "No logs yet.",
      originTitle: "Fix Ollama HTTP 403",
      originBody1: "Run this command in Terminal, then fully quit and restart Ollama.",
      originBody2: "If you run Ollama directly from Terminal, start it like this.",
      questionLabel: "Question",
      answerLabel: "Answer",
      answering: "Generating answer...",
      evidenceCount: "Show {count} evidence snippets",
      unknownLocation: "Unknown location"
    }
  };

  function cleanText(value) {
    return (value || "")
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:])/g, "$1")
      .trim();
  }

  function stripLabel(value, label) {
    return cleanText(value).replace(new RegExp(`^${label}\\s*:?\\s*`, "i"), "").trim();
  }

  function parseArxivId(urlString) {
    try {
      const url = new URL(urlString);
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

  function extractMetadataFromDocument(doc, urlString) {
    const id = parseArxivId(urlString);
    const title = stripLabel(doc.querySelector("h1.title")?.textContent, "Title");
    const abstract = stripLabel(doc.querySelector("blockquote.abstract")?.textContent, "Abstract");
    const authorLinks = [...doc.querySelectorAll("div.authors a")].map((node) => cleanText(node.textContent)).filter(Boolean);
    const authorFallback = stripLabel(doc.querySelector("div.authors")?.textContent, "Authors")
      .split(/,\s*/)
      .map((name) => cleanText(name))
      .filter(Boolean);
    const subjects = cleanText(doc.querySelector("td.subjects, .subjects")?.textContent);
    const comments = cleanText(doc.querySelector("td.comments, .comments")?.textContent);
    const journalRef = cleanText(doc.querySelector("td.journal-ref, .journal-ref")?.textContent);
    const doi = cleanText(doc.querySelector("td.doi, .doi")?.textContent);

    return {
      id,
      title,
      abstract,
      authors: authorLinks.length ? authorLinks : authorFallback,
      subjects,
      comments,
      journalRef,
      doi,
      url: urlString
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "GET_ARXIV_METADATA") {
      return false;
    }

    sendResponse({
      ok: true,
      paper: extractMetadataFromDocument(document, window.location.href)
    });
    return false;
  });

  function initPagePanel() {
    if (!window.location.pathname.startsWith("/abs/")) {
      return;
    }

    if (document.getElementById(PANEL_ID)) {
      return;
    }

    paper = extractMetadataFromDocument(document, window.location.href);
    if (!paper.id) {
      return;
    }

    const panel = buildPanel();
    const anchor = document.querySelector("blockquote.abstract");
    const content = document.querySelector("#content") || document.body;
    if (anchor?.parentElement) {
      anchor.insertAdjacentElement("afterend", panel);
    } else {
      content.prepend(panel);
    }

    bindPanel(panel);
    loadStoredLog();
    connectPort();
  }

  function removePagePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      panel.remove();
    }

    if (port) {
      try {
        port.disconnect();
      } catch (_error) {
        // The port may already be closed.
      }
      port = null;
    }

    for (const key of Object.keys(refs)) {
      delete refs[key];
    }

    isBusy = false;
    chatBusy = false;
    streamedResponse = "";
    streamedThinking = "";
  }

  function syncPanelVisibility(enabled) {
    if (enabled === false) {
      removePagePanel();
      return;
    }
    initPagePanel();
  }

  function bootPagePanel() {
    chrome.storage.local.get([PAGE_PANEL_ENABLED_KEY], (items) => {
      syncPanelVisibility(items[PAGE_PANEL_ENABLED_KEY] !== false);
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[PAGE_PANEL_ENABLED_KEY]) {
      return;
    }
    syncPanelVisibility(changes[PAGE_PANEL_ENABLED_KEY].newValue !== false);
  });

  window.addEventListener("pageshow", (event) => {
    if (!event.persisted || !paper?.id) {
      return;
    }
    connectPort();
  });

  window.addEventListener("pagehide", () => {
    port = null;
  });

  function buildPanel() {
    const panel = document.createElement("section");
    const logoUrl = chrome.runtime.getURL("assets/icon-128.png");
    panel.id = PANEL_ID;
    panel.className = "ao-collapsed";
    panel.innerHTML = `
      <div class="ao-inner">
        <div class="ao-header">
          <div class="ao-brand">
            <img class="ao-brand-icon" src="${logoUrl}" alt="" aria-hidden="true">
            <div>
              <h2>Ollarxiv</h2>
              <p data-ao-summary-hint>논문 요약과 질의응답을 펼쳐서 확인하세요.</p>
              <div class="ao-runner" aria-hidden="true">
                <span class="ao-runner-track">
                  <img class="ao-runner-mascot" src="${logoUrl}" alt="">
                </span>
              </div>
            </div>
          </div>
          <button type="button" data-ao-toggle aria-expanded="false">펼치기</button>
        </div>
        <div class="ao-server-row">
          <label class="ao-field">
            <span>Ollama 주소</span>
            <input data-ao-base type="url" placeholder="http://localhost:11434" autocomplete="off">
          </label>
          <button type="button" data-ao-save-base>주소 저장</button>
          <button type="button" data-ao-reset-base>로컬로 리셋</button>
        </div>
        <div class="ao-controls">
          <label class="ao-field">
            <span>모델</span>
            <select data-ao-model>
              <option value="">모델 불러오는 중...</option>
            </select>
          </label>
          <label class="ao-field">
            <span>요약 모드</span>
            <select data-ao-mode>
              <option value="fast">빠름</option>
              <option value="standard" selected>표준</option>
              <option value="detailed">자세히</option>
            </select>
          </label>
          <button type="button" data-ao-refresh>새로고침</button>
          <button type="button" class="ao-primary" data-ao-summarize>요약</button>
          <button type="button" data-ao-cancel disabled>중단</button>
        </div>
        <div class="ao-progress" aria-hidden="true">
          <div class="ao-progress-bar" data-ao-progress></div>
        </div>
        <p class="ao-status" data-ao-status role="status">Ollama 모델 목록을 확인하는 중...</p>
        <div class="ao-process">
          <span data-ao-phase>대기</span>
          <span data-ao-stream-label>모델 응답 대기 중</span>
        </div>
        <div class="ao-page-actions">
          <button type="button" class="ao-primary" data-ao-page-summarize>논문 요약</button>
          <button type="button" data-ao-page-cancel disabled>중단</button>
        </div>
        <section class="ao-result-section">
          <h3>요약 결과</h3>
          <div class="ao-output ao-markdown" data-ao-output>요약 결과가 여기에 표시됩니다.</div>
        </section>
        <section class="ao-chat-section">
          <div class="ao-chat-header">
            <h3>논문에 질문</h3>
            <button type="button" data-ao-clear-chat>대화 지우기</button>
          </div>
          <div class="ao-chat-messages" data-ao-chat-messages>요약 후 궁금한 점을 물어보세요. 답변에는 근거 위치가 함께 표시됩니다.</div>
          <form class="ao-chat-form" data-ao-chat-form>
            <input data-ao-question type="text" placeholder="예: 이 논문의 핵심 가정은 뭐야?" autocomplete="off">
            <button type="submit" data-ao-ask>질문</button>
          </form>
        </section>
        <div class="ao-stream-grid">
          <section class="ao-stream-box">
            <h3>실시간 출력</h3>
            <pre data-ao-stream-output>요약을 시작하면 모델 출력이 스트리밍됩니다.</pre>
          </section>
          <section class="ao-stream-box">
            <h3>모델 thinking</h3>
            <pre data-ao-stream-thinking>thinking 필드를 보내는 모델에서만 표시됩니다.</pre>
          </section>
        </div>
        <section class="ao-log-section">
          <div class="ao-log-header">
            <h3>진행 로그</h3>
            <div class="ao-log-actions">
              <button type="button" data-ao-copy-log>복사</button>
              <button type="button" data-ao-clear-log>지우기</button>
            </div>
          </div>
          <pre data-ao-log>아직 기록된 로그가 없습니다.</pre>
        </section>
        <div class="ao-origin-help" data-ao-origin-help hidden>
          <strong>Ollama HTTP 403 해결</strong>
          <p>터미널에서 아래 명령을 실행한 뒤 Ollama를 완전히 종료하고 다시 실행하세요.</p>
          <code>launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"</code>
          <p>터미널에서 직접 Ollama를 실행한다면 아래 명령으로 실행할 수 있습니다.</p>
          <code>OLLAMA_ORIGINS="chrome-extension://*" ollama serve</code>
        </div>
      </div>
    `;
    return panel;
  }

  function bindPanel(panel) {
    refs.model = panel.querySelector("[data-ao-model]");
    refs.mode = panel.querySelector("[data-ao-mode]");
    refs.base = panel.querySelector("[data-ao-base]");
    refs.saveBase = panel.querySelector("[data-ao-save-base]");
    refs.resetBase = panel.querySelector("[data-ao-reset-base]");
    refs.refresh = panel.querySelector("[data-ao-refresh]");
    refs.summarize = panel.querySelector("[data-ao-summarize]");
    refs.cancel = panel.querySelector("[data-ao-cancel]");
    refs.pageSummarize = panel.querySelector("[data-ao-page-summarize]");
    refs.pageCancel = panel.querySelector("[data-ao-page-cancel]");
    refs.header = panel.querySelector(".ao-header");
    refs.toggle = panel.querySelector("[data-ao-toggle]");
    refs.summaryHint = panel.querySelector("[data-ao-summary-hint]");
    refs.progress = panel.querySelector("[data-ao-progress]");
    refs.status = panel.querySelector("[data-ao-status]");
    refs.phase = panel.querySelector("[data-ao-phase]");
    refs.streamLabel = panel.querySelector("[data-ao-stream-label]");
    refs.streamOutput = panel.querySelector("[data-ao-stream-output]");
    refs.streamThinking = panel.querySelector("[data-ao-stream-thinking]");
    refs.log = panel.querySelector("[data-ao-log]");
    refs.copyLog = panel.querySelector("[data-ao-copy-log]");
    refs.clearLog = panel.querySelector("[data-ao-clear-log]");
    refs.output = panel.querySelector("[data-ao-output]");
    refs.chatMessages = panel.querySelector("[data-ao-chat-messages]");
    refs.chatForm = panel.querySelector("[data-ao-chat-form]");
    refs.question = panel.querySelector("[data-ao-question]");
    refs.ask = panel.querySelector("[data-ao-ask]");
    refs.clearChat = panel.querySelector("[data-ao-clear-chat]");
    refs.originHelp = panel.querySelector("[data-ao-origin-help]");
    applyInterfaceText();

    refs.refresh.addEventListener("click", () => {
      hideOriginHelp();
      setStatus(ui("checkingModels"));
      sendPortMessage({ type: "LOAD_MODELS" });
    });

    refs.model.addEventListener("change", () => {
      refs.summarize.disabled = isBusy || !refs.model.value;
      refs.pageSummarize.disabled = isBusy || !refs.model.value;
      refs.ask.disabled = chatBusy;
      sendPortMessage({ type: "SAVE_MODEL", model: refs.model.value });
    });

    refs.mode.addEventListener("change", () => {
      sendPortMessage({ type: "SAVE_MODE", mode: refs.mode.value });
    });

    refs.saveBase.addEventListener("click", () => {
      sendPortMessage({ type: "SAVE_OLLAMA_BASE", base: refs.base.value });
    });

    refs.resetBase.addEventListener("click", () => {
      sendPortMessage({ type: "RESET_OLLAMA_BASE" });
    });

    refs.summarize.addEventListener("click", () => {
      summarizeFromPage();
    });

    refs.pageSummarize.addEventListener("click", () => {
      summarizeFromPage();
    });

    refs.cancel.addEventListener("click", () => {
      sendPortMessage({ type: "CANCEL" });
    });

    refs.pageCancel.addEventListener("click", () => {
      sendPortMessage({ type: "CANCEL" });
    });

    refs.toggle.addEventListener("click", () => {
      togglePanel();
    });

    refs.header.addEventListener("click", (event) => {
      if (event.target.closest("button")) {
        return;
      }
      togglePanel(true);
    });

    refs.copyLog.addEventListener("click", copyLog);
    refs.clearLog.addEventListener("click", () => {
      clearLog();
      sendPortMessage({ type: "CLEAR_LOG", paperId: paper?.id || "" });
    });

    refs.chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      askQuestion();
    });
    refs.question.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
        return;
      }
      event.preventDefault();
      askQuestion();
    });

    refs.clearChat.addEventListener("click", () => {
      sendPortMessage({ type: "CLEAR_CHAT" });
    });
  }

  function connectPort() {
    if (port) {
      try {
        port.disconnect();
      } catch (_error) {
        // The old port may already be closed by bfcache navigation.
      }
    }
    port = chrome.runtime.connect({ name: "arxiv-ollama-summary" });
    port.onMessage.addListener(handlePortMessage);
    port.onDisconnect.addListener(() => {
      const disconnectError = chrome.runtime.lastError;
      port = null;
      if (isBusy) {
        setBusy(false);
        setStatus(disconnectError?.message?.includes("back/forward cache")
          ? "페이지 이동으로 연결이 잠시 닫혔습니다. 돌아오면 자동으로 다시 연결합니다."
          : "확장 연결이 끊어졌습니다. 페이지를 새로고침하세요.", true);
      }
    });
    sendPortMessage({ type: "REGISTER_VIEW", paper });
    sendPortMessage({ type: "LOAD_MODELS" });
  }

  function handlePortMessage(message) {
    if (message.type === "MODELS") {
      renderModels(message.models || [], message.selectedModel || "");
      refs.mode.value = message.selectedMode || "standard";
      setInterfaceLanguage(message.selectedLanguage || "ko");
      refs.base.value = message.ollamaBase || refs.base.value || "http://localhost:11434";
      hideOriginHelp();
      if (!isBusy && !hasSummaryOutput()) {
        setStatus(message.models?.length
          ? (currentLanguage === "en" ? `Found ${message.models.length} models.` : `${message.models.length}개 모델을 찾았습니다.`)
          : ui("noModels"), !message.models?.length);
      }
      return;
    }

    if (message.type === "OPTION_STATE") {
      if (message.selectedModel && [...refs.model.options].some((option) => option.value === message.selectedModel)) {
        refs.model.value = message.selectedModel;
      }
      if (message.selectedMode) {
        refs.mode.value = message.selectedMode;
      }
      if (message.selectedLanguage) {
        setInterfaceLanguage(message.selectedLanguage);
      }
      if (message.ollamaBase) {
        refs.base.value = message.ollamaBase;
      }
      return;
    }

    if (message.type === "OLLAMA_BASE_ERROR") {
      setStatus(message.message || (currentLanguage === "en" ? "Could not save the Ollama URL." : "Ollama 주소를 저장할 수 없습니다."), true);
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

    if (message.type === "CHAT_START" || message.type === "CHAT_DELTA" || message.type === "CHAT_FINAL" || message.type === "CHAT_ERROR" || message.type === "CHAT_RESET" || message.type === "CHAT_DONE") {
      applyChatEvent(message);
      return;
    }

    if (message.type === "STATUS") {
      setStatus(message.status || "");
      if (typeof message.progress === "number") {
        setProgress(message.progress);
      }
      if (message.status) {
        refs.phase.textContent = statusToPhase(message.status);
      }
      return;
    }

    if (message.type === "STREAM_START") {
      resetStream(message.phase || ui("waiting"), message.label || ui("streamWaiting"));
      return;
    }

    if (message.type === "STREAM_DELTA") {
      appendStream(message.channel, message.delta || "");
      return;
    }

    if (message.type === "STREAM_DONE") {
      refs.streamLabel.textContent = message.evalCount
        ? `${refs.streamLabel.textContent} · ${message.evalCount} tokens`
        : refs.streamLabel.textContent;
      return;
    }

    if (message.type === "PARTIAL") {
      setSummaryOutput(message.output || "");
      return;
    }

    if (message.type === "FINAL") {
      setSummaryOutput(message.output || "");
      if (!streamedResponse && /캐시|cache/i.test(message.status || "")) {
        refs.streamOutput.textContent = currentLanguage === "en" ? "Used cached summary." : "캐시된 요약 결과를 사용했습니다.";
        refs.streamLabel.textContent = currentLanguage === "en" ? "Using cache" : "캐시 사용";
      }
      setStatus(message.status || (currentLanguage === "en" ? "Complete" : "완료"));
      setProgress(message.progress || 100);
      hideOriginHelp();
      return;
    }

    if (message.type === "ERROR") {
      setBusy(false);
      setStatus(message.message || (currentLanguage === "en" ? "An error occurred during summarization." : "요약 중 오류가 발생했습니다."), !message.aborted);
      if (message.code === "OLLAMA_FORBIDDEN") {
        showOriginHelp(message.help);
      }
      return;
    }

    if (message.type === "DONE") {
      setBusy(false);
      refs.phase.textContent = ui("waiting");
    }
  }

  function renderModels(models, selectedModel) {
    refs.model.innerHTML = "";
    if (!models.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = ui("noModels");
      refs.model.appendChild(option);
      setBusy(isBusy);
      return;
    }

    for (const model of models) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      option.selected = model === selectedModel;
      refs.model.appendChild(option);
    }
    setBusy(isBusy);
  }

  function sendPortMessage(message) {
    if (!port) {
      setStatus(currentLanguage === "en" ? "Extension connection is not ready. Reload the page." : "확장 연결이 준비되지 않았습니다. 페이지를 새로고침하세요.", true);
      return;
    }

    try {
      port.postMessage(message);
    } catch (_error) {
      setStatus(currentLanguage === "en" ? "Extension connection was closed. Reload the page." : "확장 연결이 끊어졌습니다. 페이지를 새로고침하세요.", true);
    }
  }

  function setBusy(nextBusy) {
    isBusy = nextBusy;
    document.getElementById(PANEL_ID)?.classList.toggle("ao-running", nextBusy);
    refs.summarize.disabled = nextBusy || !refs.model.value;
    refs.pageSummarize.disabled = nextBusy || !refs.model.value;
    refs.refresh.disabled = nextBusy;
    refs.cancel.disabled = !nextBusy;
    refs.pageCancel.disabled = !nextBusy;
    refs.model.disabled = nextBusy;
    refs.mode.disabled = nextBusy;
    refs.base.disabled = nextBusy;
    refs.saveBase.disabled = nextBusy;
    refs.resetBase.disabled = nextBusy;
    refs.question.disabled = chatBusy;
    refs.ask.disabled = chatBusy;
  }

  function ui(key) {
    return (UI[currentLanguage] || UI.ko)[key] || UI.ko[key] || key;
  }

  function setInterfaceLanguage(language) {
    currentLanguage = language === "en" ? "en" : "ko";
    applyInterfaceText();
  }

  function applyInterfaceText() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !refs.toggle) {
      return;
    }

    refs.summaryHint.textContent = ui("hint");
    refs.toggle.textContent = refs.toggle.getAttribute("aria-expanded") === "true" ? ui("collapse") : ui("expand");
    setFieldLabel(refs.base, ui("ollamaBase"));
    refs.saveBase.textContent = ui("saveBase");
    refs.resetBase.textContent = ui("resetBase");
    setFieldLabel(refs.model, ui("model"));
    setFieldLabel(refs.mode, ui("mode"));
    setSelectOptionText(refs.mode, { fast: ui("fast"), standard: ui("standard"), detailed: ui("detailed") });
    if (!refs.model.value && refs.model.options.length === 1) {
      refs.model.options[0].textContent = ui("loadingModels");
    }
    refs.refresh.textContent = ui("refresh");
    refs.summarize.textContent = ui("summarize");
    refs.pageSummarize.textContent = ui("summarizePaper");
    refs.cancel.textContent = ui("cancel");
    refs.pageCancel.textContent = ui("cancel");
    panel.querySelector(".ao-result-section h3").textContent = ui("resultTitle");
    panel.querySelector(".ao-chat-header h3").textContent = ui("chatTitle");
    refs.clearChat.textContent = ui("clearChat");
    refs.question.placeholder = ui("questionPlaceholder");
    refs.ask.textContent = ui("ask");
    panel.querySelectorAll(".ao-stream-box h3")[0].textContent = ui("streamTitle");
    panel.querySelectorAll(".ao-stream-box h3")[1].textContent = ui("thinkingTitle");
    panel.querySelector(".ao-log-header h3").textContent = ui("logTitle");
    refs.copyLog.textContent = ui("copy");
    refs.clearLog.textContent = ui("clear");
    refs.originHelp.querySelector("strong").textContent = ui("originTitle");
    refs.originHelp.querySelectorAll("p")[0].textContent = ui("originBody1");
    refs.originHelp.querySelectorAll("p")[1].textContent = ui("originBody2");

    replaceIfPlaceholder(refs.status, [UI.ko.checkingModels, UI.en.checkingModels], ui("checkingModels"));
    replaceIfPlaceholder(refs.phase, [UI.ko.waiting, UI.en.waiting], ui("waiting"));
    replaceIfPlaceholder(refs.streamLabel, [UI.ko.streamWaiting, UI.en.streamWaiting], ui("streamWaiting"));
    replaceIfPlaceholder(refs.output, [UI.ko.summaryPlaceholder, UI.en.summaryPlaceholder], ui("summaryPlaceholder"));
    replaceIfPlaceholder(refs.chatMessages, [UI.ko.chatPlaceholder, UI.en.chatPlaceholder], ui("chatPlaceholder"));
    replaceIfPlaceholder(refs.streamOutput, [UI.ko.streamPlaceholder, UI.en.streamPlaceholder], ui("streamPlaceholder"));
    replaceIfPlaceholder(refs.streamThinking, [UI.ko.thinkingPlaceholder, UI.en.thinkingPlaceholder], ui("thinkingPlaceholder"));
    replaceIfPlaceholder(refs.log, [UI.ko.noLog, UI.en.noLog], ui("noLog"));
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
    if (element && candidates.includes(element.textContent.trim())) {
      element.textContent = nextText;
    }
  }

  function hasSummaryOutput() {
    const text = refs.output.textContent.trim();
    return Boolean(text && text !== UI.ko.summaryPlaceholder && text !== UI.en.summaryPlaceholder);
  }

  function setSummaryOutput(markdown) {
    refs.output.innerHTML = renderMarkdown(markdown || ui("summaryPlaceholder"));
  }

  function summarizeFromPage() {
    hideOriginHelp();
    if (!refs.model.value) {
      setStatus(currentLanguage === "en" ? "Select an Ollama model in the popup." : "사용할 Ollama 모델을 팝업에서 선택하세요.", true);
      return;
    }
    sendPortMessage({
      type: "SUMMARIZE",
      paper,
      model: refs.model.value,
      mode: refs.mode.value
    });
  }

  function togglePanel(forceExpanded) {
    const shouldExpand = typeof forceExpanded === "boolean"
      ? forceExpanded
      : refs.toggle.getAttribute("aria-expanded") !== "true";
    refs.toggle.setAttribute("aria-expanded", String(shouldExpand));
    refs.toggle.textContent = shouldExpand ? ui("collapse") : ui("expand");
    document.getElementById(PANEL_ID)?.classList.toggle("ao-collapsed", !shouldExpand);
  }

  function askQuestion() {
    const question = refs.question.value.trim();
    if (!question) {
      setStatus(currentLanguage === "en" ? "Enter a question." : "질문을 입력하세요.", true);
      return;
    }
    refs.question.value = "";
    setStatus(currentLanguage === "en" ? "Question sent. Waiting for Ollama..." : "질문을 보냈습니다. Ollama 응답을 기다리는 중...");
    sendPortMessage({
      type: "ASK_QUESTION",
      paper,
      model: refs.model.value,
      question
    });
  }

  function applyChatEvent(message) {
    if (message.type === "CHAT_RESET") {
      chatBusy = false;
      renderChatMessages([]);
      setBusy(isBusy);
      return;
    }

    if (message.type === "CHAT_DONE") {
      chatBusy = false;
      setBusy(isBusy);
      return;
    }

    if (message.type === "CHAT_START") {
      chatBusy = true;
      appendChatMessage({ role: "user", content: message.question || "" });
      appendChatMessage({ role: "assistant", content: "", streaming: true });
      setBusy(isBusy);
      return;
    }

    if (message.type === "CHAT_DELTA") {
      const content = refs.chatMessages.querySelector(".ao-chat-message.ao-assistant:last-child .ao-chat-content");
      if (content) {
        content.dataset.raw = `${content.dataset.raw || ""}${message.delta || ""}`;
        content.innerHTML = renderMarkdown(content.dataset.raw || ui("answering"));
        refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
      }
      return;
    }

    if (message.type === "CHAT_FINAL") {
      chatBusy = false;
      const item = refs.chatMessages.querySelector(".ao-chat-message.ao-assistant:last-child");
      const content = item?.querySelector(".ao-chat-content");
      if (content) {
        content.dataset.raw = message.answer || content.dataset.raw || "";
        content.innerHTML = renderMarkdown(content.dataset.raw);
        renderEvidence(item, message.evidence || []);
      }
      setBusy(isBusy);
      return;
    }

    if (message.type === "CHAT_ERROR") {
      chatBusy = false;
      const item = refs.chatMessages.querySelector(".ao-chat-message.ao-assistant:last-child");
      const content = item?.querySelector(".ao-chat-content");
      if (content) {
        item.classList.add("ao-chat-error");
        content.dataset.raw = message.message || (currentLanguage === "en" ? "An error occurred while answering." : "답변 중 오류가 발생했습니다.");
        content.innerHTML = renderMarkdown(content.dataset.raw);
      } else {
        appendChatMessage({ role: "assistant", content: message.message || (currentLanguage === "en" ? "An error occurred while answering." : "답변 중 오류가 발생했습니다."), error: true });
      }
      setBusy(isBusy);
    }
  }

  function renderChatMessages(messages) {
    refs.chatMessages.innerHTML = "";
    if (!messages.length) {
      refs.chatMessages.textContent = ui("chatPlaceholder");
      setBusy(isBusy);
      return;
    }

    for (const message of messages) {
      appendChatMessage(message);
    }
    refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
    setBusy(isBusy);
  }

  function appendChatMessage(message) {
    if ([UI.ko.chatPlaceholder, UI.en.chatPlaceholder].includes(refs.chatMessages.textContent.trim())) {
      refs.chatMessages.textContent = "";
    }

    const item = document.createElement("div");
    item.className = `ao-chat-message ${message.role === "user" ? "ao-user" : "ao-assistant"}${message.error ? " ao-chat-error" : ""}`;
    const label = document.createElement("strong");
    label.textContent = message.role === "user" ? ui("questionLabel") : ui("answerLabel");
    const content = document.createElement("div");
    content.className = "ao-chat-content ao-markdown";
    content.dataset.raw = message.content || "";
    content.innerHTML = renderMarkdown(message.content || (message.streaming ? ui("answering") : ""));
    item.append(label, content);
    renderEvidence(item, message.evidence || []);
    refs.chatMessages.appendChild(item);
    refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
  }

  function renderEvidence(container, evidence) {
    container.querySelector(".ao-evidence-list")?.remove();
    if (!Array.isArray(evidence) || !evidence.length) {
      return;
    }

    const details = document.createElement("details");
    details.className = "ao-evidence-list";
    const summary = document.createElement("summary");
    summary.textContent = ui("evidenceCount").replace("{count}", evidence.length);
    details.appendChild(summary);

    for (const snippet of evidence) {
      const card = document.createElement("div");
      card.className = "ao-evidence-card";
      const title = document.createElement("strong");
      title.textContent = `[${snippet.id}] ${snippet.location || ui("unknownLocation")}`;
      const text = document.createElement("p");
      text.textContent = snippet.text || "";
      card.append(title, text);
      details.appendChild(card);
    }

    container.appendChild(details);
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

  function applySessionReset(message) {
    clearLog();
    hideOriginHelp();
    if (message.model && [...refs.model.options].some((option) => option.value === message.model)) {
      refs.model.value = message.model;
    }
    if (message.mode) {
      refs.mode.value = message.mode;
    }
    if (message.language) {
      setInterfaceLanguage(message.language);
    }
    setSummaryOutput(currentLanguage === "en" ? "Loading paper text..." : "논문 본문을 가져오는 중...");
    resetStream(message.phase || ui("waiting"), message.streamLabel || (currentLanguage === "en" ? "Task started" : "작업 시작"));
    setProgress(message.progress || 0);
    setStatus(message.status || (currentLanguage === "en" ? "Preparing summary..." : "요약 준비 중..."));
    setBusy(true);
  }

  function applySessionState(state) {
    if (state.model && [...refs.model.options].some((option) => option.value === state.model)) {
      refs.model.value = state.model;
    }
    if (state.mode) {
      refs.mode.value = state.mode;
    }
    if (state.language) {
      setInterfaceLanguage(state.language);
    }
    if (state.ollamaBase) {
      refs.base.value = state.ollamaBase;
    }
    refs.phase.textContent = translateUiText(state.phase || ui("waiting"));
    refs.streamLabel.textContent = translateUiText(state.streamLabel || ui("streamWaiting"));
    refs.streamOutput.textContent = translateUiText(state.streamOutput || ui("streamPlaceholder"));
    refs.streamThinking.textContent = translateUiText(state.streamThinking || ui("thinkingPlaceholder"));
    streamedResponse = state.streamOutput || "";
    streamedThinking = state.streamThinking || "";
    setSummaryOutput(state.output || ui("summaryPlaceholder"));
    setProgress(typeof state.progress === "number" ? state.progress : 0);
    setStatus(state.status || (currentLanguage === "en" ? "Select a model, then start summarization." : "모델을 선택한 뒤 요약을 실행하세요."), Boolean(state.statusIsError));
    if (Array.isArray(state.logs) && state.logs.length) {
      applyLogEntries(state.logs);
    } else if (state.isBusy || state.output || state.status) {
      applyLogEntries([]);
    }
    chatBusy = Boolean(state.chatBusy);
    renderChatMessages(state.chatMessages || []);
    if (state.originHelp) {
      showOriginHelp(state.originHelp);
    } else {
      hideOriginHelp();
    }
    setBusy(Boolean(state.isBusy));
  }

  function setStatus(message, isError = false) {
    const text = translateUiText(message);
    refs.status.textContent = text;
    refs.status.classList.toggle("ao-error", isError);
    if (refs.summaryHint && message) {
      refs.summaryHint.textContent = text;
    }
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
    refs.progress.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }

  function resetStream(phase, label) {
    streamedResponse = "";
    streamedThinking = "";
    refs.phase.textContent = translateUiText(phase);
    refs.streamLabel.textContent = translateUiText(label);
    refs.streamOutput.textContent = currentLanguage === "en" ? "Waiting for model output..." : "모델 출력 대기 중...";
    refs.streamThinking.textContent = currentLanguage === "en" ? "Waiting for thinking field..." : "thinking 필드를 기다리는 중...";
  }

  function translateUiText(value) {
    if (currentLanguage !== "en") {
      return value;
    }

    return String(value || "")
      .replace("Ollama 모델 목록을 확인하는 중...", "Checking Ollama models...")
      .replace("Ollama에 설치된 모델이 없습니다.", "No Ollama models are installed.")
      .replace("Ollama 주소를 저장할 수 없습니다.", "Could not save the Ollama URL.")
      .replace("요약 준비 중...", "Preparing summary...")
      .replace("논문 본문을 가져오는 중...", "Loading paper text...")
      .replace("모델을 선택한 뒤 요약을 실행하세요.", "Select a model, then start summarization.")
      .replace("확장 연결이 끊어졌습니다. 페이지를 새로고침하세요.", "Extension connection was closed. Reload the page.")
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

  function appendStream(channel, delta) {
    if (!delta) {
      return;
    }

    if (channel === "thinking") {
      streamedThinking += delta;
      refs.streamThinking.textContent = streamedThinking;
      refs.streamThinking.scrollTop = refs.streamThinking.scrollHeight;
      return;
    }

    streamedResponse += delta;
    refs.streamOutput.textContent = streamedResponse;
    refs.streamOutput.scrollTop = refs.streamOutput.scrollHeight;
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
    refs.log.textContent = logLines.join("\n");
    refs.log.scrollTop = refs.log.scrollHeight;
    persistLog();
  }

  function applyLogEntries(entries) {
    if (!Array.isArray(entries) || !entries.length) {
      logLines = [];
      refs.log.textContent = ui("noLog");
      persistLog();
      return;
    }

    logLines = entries.slice(-400).map((entry) => {
      const time = formatLogTime(entry.timestamp);
      const label = String(entry.level || "info").toUpperCase();
      return `[${time}] [${label}] ${translateUiText(entry.message || "")}`;
    });
    refs.log.textContent = logLines.join("\n");
    refs.log.scrollTop = refs.log.scrollHeight;
    persistLog();
  }

  function clearLog() {
    logClearedAt = Date.now();
    logLines = [];
    refs.log.textContent = ui("noLog");
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
      refs.log.textContent = logLines.join("\n");
      refs.log.scrollTop = refs.log.scrollHeight;
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
    chrome.storage.local.remove(key);
  }

  function logStorageKey() {
    return paper?.id ? `processLog:${paper.id}` : "";
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
      const codeBlocks = refs.originHelp.querySelectorAll("code");
      codeBlocks[0].textContent = help.setupCommand;
      codeBlocks[1].textContent = help.serveCommand;
    }
    refs.originHelp.hidden = false;
  }

  function hideOriginHelp() {
    refs.originHelp.hidden = true;
  }

  bootPagePanel();
})();
