const DEFAULT_OLLAMA_BASE = "http://localhost:11434";
const SUMMARY_CACHE_VERSION = 1;
const DEFAULT_SUMMARY_MODE = "standard";
const DEFAULT_LANGUAGE = "ko";
const CHAT_CONTEXT_MAX_CHARS = 18000;
const SUMMARY_MODES = {
  fast: {
    id: "fast",
    label: "빠름",
    sourceMaxChars: 65000,
    maxTotalChars: 22000,
    chunkSize: 22000,
    think: false,
    direct: true,
    focused: true,
    numCtx: 8192
  },
  standard: {
    id: "standard",
    label: "표준",
    maxTotalChars: 60000,
    chunkSize: 14000,
    think: false,
    direct: false,
    focused: false,
    numCtx: 8192
  },
  detailed: {
    id: "detailed",
    label: "자세히",
    maxTotalChars: 91200,
    chunkSize: 7600,
    think: true,
    direct: false,
    focused: false,
    numCtx: 8192
  }
};
const OLLAMA_ORIGIN_HELP = {
  setupCommand: 'launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"',
  serveCommand: 'OLLAMA_ORIGINS="chrome-extension://*" ollama serve',
  message: "Ollama가 Chrome 확장 요청을 거부했습니다. 터미널에서 OLLAMA_ORIGINS를 설정하고 Ollama를 다시 실행하세요."
};

let ollamaBase = null;
const portStates = new Map();
const paperSessions = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "arxiv-ollama-summary") {
    return;
  }

  const state = {
    paperId: ""
  };
  portStates.set(port, state);

  port.onMessage.addListener(async (message) => {
    if (message?.type === "REGISTER_VIEW") {
      const paperId = message.paper?.id || "";
      state.paperId = paperId;
      if (paperId) {
        const session = ensurePaperSession(paperId, message.paper);
        sendSessionSnapshot(port, session);
      }
      return;
    }

    if (message?.type === "LOAD_MODELS") {
      loadModelsForPort(port);
      return;
    }

    if (message?.type === "SAVE_MODEL") {
      storageSet({ selectedModel: message.model || "" });
      broadcastToAllPorts({ type: "OPTION_STATE", selectedModel: message.model || "" });
      return;
    }

    if (message?.type === "SAVE_MODE") {
      const selectedMode = getSummaryMode(message.mode).id;
      storageSet({ selectedMode });
      broadcastToAllPorts({ type: "OPTION_STATE", selectedMode });
      return;
    }

    if (message?.type === "SAVE_LANGUAGE") {
      const selectedLanguage = getLanguage(message.language).id;
      storageSet({ selectedLanguage });
      for (const session of paperSessions.values()) {
        session.language = selectedLanguage;
      }
      broadcastToAllPorts({ type: "OPTION_STATE", selectedLanguage });
      return;
    }

    if (message?.type === "SAVE_OLLAMA_BASE") {
      const result = normalizeOllamaBase(message.base);
      if (!result.ok) {
        postToPort(port, {
          type: "OLLAMA_BASE_ERROR",
          message: result.message
        });
        return;
      }

      ollamaBase = result.value;
      storageSet({ ollamaBase: result.value }).then(() => loadModelsForPort(port));
      broadcastToAllPorts({ type: "OPTION_STATE", ollamaBase: result.value });
      postToPort(port, {
        type: "STATUS",
        status: `Ollama 주소 저장됨: ${result.value}`
      });
      return;
    }

    if (message?.type === "RESET_OLLAMA_BASE") {
      ollamaBase = DEFAULT_OLLAMA_BASE;
      storageSet({ ollamaBase: DEFAULT_OLLAMA_BASE }).then(() => loadModelsForPort(port));
      broadcastToAllPorts({ type: "OPTION_STATE", ollamaBase: DEFAULT_OLLAMA_BASE });
      postToPort(port, {
        type: "STATUS",
        status: `Ollama 주소가 로컬 기본값으로 복원됨: ${DEFAULT_OLLAMA_BASE}`
      });
      return;
    }

    if (message?.type === "CANCEL") {
      const session = state.paperId ? paperSessions.get(state.paperId) : null;
      session?.abortController?.abort();
      session?.chatAbortController?.abort();
      return;
    }

    if (message?.type === "CLEAR_LOG") {
      const paperId = message.paperId || state.paperId;
      if (paperId) {
        storageRemove(logStorageKey(paperId));
      }
      const session = paperId ? paperSessions.get(paperId) : null;
      if (session) {
        emitToSession(session, { type: "LOG_RESET" });
      }
      return;
    }

    if (message?.type === "ASK_QUESTION") {
      const paperId = message.paper?.id || state.paperId;
      if (!paperId) {
        postPortError(port, new Error("arXiv 논문 정보를 찾을 수 없습니다."));
        return;
      }
      const session = ensurePaperSession(paperId, message.paper);
      state.paperId = paperId;
      const cleanQuestion = cleanText(message.question || "");
      const stored = await storageGet(["selectedModel"]);
      const model = message.model || stored.selectedModel || session.model || "";

      if (session.chatBusy) {
        postToPort(port, {
          type: "CHAT_ERROR",
          message: "이미 답변을 생성하는 중입니다."
        });
        return;
      }

      postLog(session, `질문 수신: chars=${cleanQuestion.length}, preview="${cleanQuestion.slice(0, 120)}"`);
      session.chatAbortController?.abort();
      session.chatAbortController = new AbortController();
      answerQuestionForSession(session, message.paper, model, cleanQuestion, session.chatAbortController.signal)
        .catch((error) => postChatError(session, error))
        .finally(() => {
          session.chatAbortController = null;
          emitToSession(session, { type: "CHAT_DONE" });
        });
      return;
    }

    if (message?.type === "CLEAR_CHAT") {
      const session = state.paperId ? paperSessions.get(state.paperId) : null;
      if (session) {
        emitToSession(session, { type: "CHAT_RESET" });
      }
      return;
    }

    if (message?.type === "SUMMARIZE") {
      const paperId = message.paper?.id || state.paperId;
      if (!paperId) {
        postPortError(port, new Error("arXiv 논문 정보를 찾을 수 없습니다."));
        return;
      }
      const session = ensurePaperSession(paperId, message.paper);
      state.paperId = paperId;

      if (session.isBusy) {
        postLog(session, "이미 진행 중인 요약 작업에 연결했습니다.", "warn");
        sendSessionSnapshot(port, session);
        return;
      }

      const mode = getSummaryMode(message.mode);
      session.abortController?.abort();
      session.abortController = new AbortController();
      emitToSession(session, {
        type: "SESSION_RESET",
        model: message.model || "",
        mode: mode.id,
        language: session.language,
        status: "요약 준비 중...",
        progress: 0,
        phase: "요약 준비",
        streamLabel: "작업 시작"
      });

      summarizeForPort(session, message.paper, message.model, mode.id, session.abortController.signal)
        .catch((error) => postPortError(session, error))
        .finally(() => {
          session.abortController = null;
          emitToSession(session, { type: "DONE" });
        });
    }
  });

  port.onDisconnect.addListener(() => {
    const _disconnectError = chrome.runtime.lastError;
    portStates.delete(port);
  });
});

async function loadModelsForPort(port) {
  const sessionTarget = targetForPort(port);
  const target = sessionTarget?.kind === "paper-session" && (sessionTarget.isBusy || sessionTarget.output || sessionTarget.status)
    ? port
    : sessionTarget;
  try {
    postToPort(target, {
      type: "STATUS",
      status: "Ollama 모델 목록을 확인하는 중..."
    });
    postLog(target, "Ollama 모델 목록 요청 시작");
    const models = await listOllamaModels();
    const storage = await storageGet(["selectedModel", "selectedMode", "selectedLanguage", "ollamaBase"]);
    const selectedModel = storage.selectedModel && models.includes(storage.selectedModel)
      ? storage.selectedModel
      : models[0] || "";
    const selectedMode = getSummaryMode(storage.selectedMode).id;
    const selectedLanguage = getLanguage(storage.selectedLanguage).id;
    const normalizedBase = normalizeOllamaBase(storage.ollamaBase);
    const storedBase = normalizedBase.ok
      ? normalizedBase.value
      : DEFAULT_OLLAMA_BASE;

    if (selectedModel) {
      await storageSet({ selectedModel });
    }
    await storageSet({ selectedMode, selectedLanguage, ollamaBase: storedBase });
    for (const session of paperSessions.values()) {
      session.language = selectedLanguage;
    }

    broadcastToAllPorts({
      type: "MODELS",
      models,
      selectedModel,
      selectedMode,
      selectedLanguage,
      ollamaBase: storedBase
    });
    postLog(target, `Ollama 모델 목록 수신 완료: ${models.length}개`);
  } catch (error) {
    postLog(target, `Ollama 모델 목록 요청 실패: ${error.message}`, "error");
    postPortError(target, error);
  }
}

async function listOllamaModels() {
  const data = await ollamaJson("/api/tags", { method: "GET" });
  return (data.models || [])
    .map((model) => model.name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

async function summarizeForPort(port, paper, model, modeId, signal) {
  if (!paper?.id) {
    throw new Error("arXiv 논문 정보를 찾을 수 없습니다.");
  }

  if (!model) {
    throw new Error("사용할 Ollama 모델을 선택하세요.");
  }

  const mode = getSummaryMode(modeId);
  const language = getLanguage((await storageGet(["selectedLanguage"])).selectedLanguage);
  port.language = language.id;
  await storageSet({ selectedMode: mode.id, selectedLanguage: language.id });
  const cacheKey = summaryCacheKey(paper.id, model, mode.id, language.id);
  const cached = await getCachedSummary(cacheKey);

  postLog(port, `요약 시작: arXiv:${paper.id}, model=${model}, mode=${mode.label}, language=${language.label}`);
  if (cached?.output) {
    postLog(port, `캐시된 요약 사용: mode=${mode.label}, cachedAt=${cached.savedAt}`);
    postToPort(port, {
      type: "FINAL",
      output: cached.output,
      status: `완료: 캐시 (${cached.sourceLabel || mode.label}, ${language.label})`,
      progress: 100
    });
    return;
  }

  postToPort(port, {
    type: "STATUS",
    status: "arXiv HTML 본문을 확인하는 중...",
    progress: 3
  });

  postLog(port, "논문 본문 소스 확인 시작");
  const fullPaper = await getPaperWithReadableText(paper, signal, mode, (message, level) => {
    postLog(port, message, level);
  });
  const textForSummary = buildSourceText(fullPaper, mode);
  rememberPaperContext(port, fullPaper, textForSummary);
  await storeCachedSource(paper.id, port);
  postLog(port, `요약 입력 준비 완료: source=${textForSummary.sourceLabel}, chars=${textForSummary.text.length}, mode=${mode.label}`);

  if (mode.direct) {
    postToPort(port, {
      type: "STATUS",
      status: `${mode.label} 모드 단일 요약 생성 중...`,
      progress: 20
    });

    postLog(port, `단일 요약 시작: inputChars=${textForSummary.text.length}, think=${mode.think}`);
    const prompt = buildDirectPrompt(fullPaper, textForSummary.text, textForSummary.sourceLabel, mode, language);
    const finalSummary = await generateWithOllama(model, prompt, signal, (event) => {
      postStreamEvent(port, {
        ...event,
        phase: `${mode.label} 요약`,
        label: `${mode.label} 요약`
      });
    }, mode);
    postLog(port, `단일 요약 완료: outputChars=${finalSummary.length}`);
    await storeCachedSummary(cacheKey, finalSummary, textForSummary.sourceLabel, mode, language);
    port.summary = finalSummary;

    postToPort(port, {
      type: "FINAL",
      output: finalSummary,
      status: `완료: ${textForSummary.sourceLabel} (${mode.label})`,
      progress: 100
    });
    return;
  }

  const chunks = chunkText(textForSummary.text, mode.chunkSize);
  const partialSummaries = [];
  const totalCalls = chunks.length + 1;
  postLog(port, `청크 요약 준비 완료: chunkSize=${mode.chunkSize}, chunks=${chunks.length}, think=${mode.think}`);

  if (fullPaper.truncated) {
    postToPort(port, {
      type: "STATUS",
      status: "논문이 길어 앞부분 중심으로 요약합니다. 참고문헌은 제외했습니다."
    });
    postLog(port, `원본 텍스트가 길어 ${mode.sourceMaxChars || mode.maxTotalChars}자까지만 읽음`, "warn");
  }

  for (let index = 0; index < chunks.length; index += 1) {
    postToPort(port, {
      type: "STATUS",
      status: `부분 요약 ${index + 1}/${chunks.length} 생성 중...`,
      progress: Math.round(((index + 0.2) / totalCalls) * 100)
    });

    const prompt = buildChunkPrompt(fullPaper, chunks[index], index + 1, chunks.length, textForSummary.sourceLabel, language);
    postLog(port, `부분 요약 ${index + 1}/${chunks.length} 시작: chunkChars=${chunks[index].length}`);
    const summary = await generateWithOllama(model, prompt, signal, (event) => {
      postStreamEvent(port, {
        ...event,
        phase: "부분 요약",
        label: `부분 요약 ${index + 1}/${chunks.length}`
      });
    }, mode);
    partialSummaries.push(summary);
    postLog(port, `부분 요약 ${index + 1}/${chunks.length} 완료: outputChars=${summary.length}`);

    postToPort(port, {
      type: "PARTIAL",
      output: partialSummaries.join("\n\n---\n\n")
    });
  }

  postToPort(port, {
    type: "STATUS",
    status: "최종 요약을 정리하는 중...",
    progress: 92
  });

  const finalPrompt = buildFinalPrompt(fullPaper, partialSummaries, textForSummary.sourceLabel, fullPaper.truncated, language);
  postLog(port, `최종 요약 시작: partialSummaries=${partialSummaries.length}`);
  const finalSummary = await generateWithOllama(model, finalPrompt, signal, (event) => {
    postStreamEvent(port, {
      ...event,
      phase: "최종 요약",
      label: "최종 요약"
    });
  }, mode);
  postLog(port, `최종 요약 완료: outputChars=${finalSummary.length}`);
  await storeCachedSummary(cacheKey, finalSummary, textForSummary.sourceLabel, mode, language);
  port.summary = finalSummary;

  postToPort(port, {
    type: "FINAL",
    output: finalSummary,
    status: `완료: ${textForSummary.sourceLabel}`,
    progress: 100
  });
}

async function answerQuestionForSession(session, paper, model, question, signal) {
  const cleanQuestion = cleanText(question || "");
  if (!cleanQuestion) {
    throw new Error("질문을 입력하세요.");
  }
  if (!model) {
    throw new Error("사용할 Ollama 모델을 선택하세요.");
  }
  const language = getLanguage(session.language || (await storageGet(["selectedLanguage"])).selectedLanguage);
  session.language = language.id;

  emitToSession(session, {
    type: "CHAT_START",
    question: cleanQuestion
  });

  if (!session.sourceText) {
    const cachedSource = await getCachedSource(session.paperId);
    if (cachedSource?.text) {
      session.sourceText = cachedSource.text;
      session.sourceLabel = cachedSource.sourceLabel || "";
      session.sourceUrl = cachedSource.sourceUrl || "";
      session.sourceTruncated = Boolean(cachedSource.truncated);
      postLog(session, `저장된 전문 캐시 사용: source=${session.sourceLabel}, chars=${session.sourceText.length}`);
    }
  }

  if (!session.sourceText) {
    const mode = getSummaryMode(session.mode);
    postLog(session, "대화용 논문 본문 컨텍스트가 없어 다시 확인합니다.", "warn");
    const fullPaper = await getPaperWithReadableText(paper || session.paper, signal, mode, (message, level) => {
      postLog(session, message, level);
    });
    const textForSummary = buildSourceText(fullPaper, mode);
    rememberPaperContext(session, fullPaper, textForSummary);
    await storeCachedSource(session.paperId, session);
  }

  const evidence = selectEvidenceSnippets(session, cleanQuestion);
  const prompt = buildChatPrompt(session, cleanQuestion, evidence);
  postLog(session, `질문 답변 시작: questionChars=${cleanQuestion.length}, evidence=${evidence.length}`);
  postLog(session, `질문 답변 모델 호출 시작: model=${model}, source=${session.sourceLabel || "unknown"}`);
  const answer = await generateWithOllama(model, prompt, signal, (event) => {
    if (event.type === "STREAM_DELTA" && event.channel === "response") {
      emitToSession(session, {
        type: "CHAT_DELTA",
        delta: event.delta || ""
      });
    }
  }, {
    ...SUMMARY_MODES.fast,
    think: false
  });

  postLog(session, `질문 답변 완료: answerChars=${answer.length}`);
  emitToSession(session, {
    type: "CHAT_FINAL",
    answer,
    evidence
  });
}

function rememberPaperContext(session, fullPaper, textForSummary) {
  session.paper = fullPaper || session.paper;
  session.sourceText = textForSummary?.text || "";
  session.sourceLabel = textForSummary?.sourceLabel || fullPaper?.sourceType || "";
  session.sourceUrl = fullPaper?.sourceUrl || fullPaper?.url || session.paper?.url || "";
  session.sourceTruncated = Boolean(fullPaper?.truncated);
}

function buildChatPrompt(session, question, evidence) {
  const language = getLanguage(session.language);
  const history = session.chatMessages
    .filter((message) => !message.streaming)
    .slice(-6)
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n\n");

  return [
    "You are a careful research assistant answering questions about one arXiv paper.",
    `${language.answerInstruction} Use only the paper summary and the supplied evidence snippets.`,
    "If the evidence is insufficient, say what is not clear instead of guessing.",
    `Always include a short '${language.evidenceHeading}' section listing the snippet IDs you used, e.g. [S2].`,
    "When useful, quote only short phrases from snippets.",
    "",
    `Paper ID: ${session.paperId}`,
    `Title: ${session.paper?.title || "Unknown"}`,
    `Source: ${session.sourceLabel || "unknown"} ${session.sourceUrl || ""}`,
    session.sourceTruncated ? "Note: available source text was truncated during summarization." : "",
    "",
    "Current summary:",
    session.output || session.summary || "No summary has been generated yet.",
    "",
    history ? `Recent conversation:\n${history}` : "",
    "",
    "Evidence snippets:",
    evidence.length ? evidence.map(formatEvidenceSnippet).join("\n\n") : "No relevant snippet was found.",
    "",
    `Question: ${question}`,
    "",
    "Answer format:",
    ...language.chatLabels.map((label, index) => `${index + 1}. ${label}`)
  ].filter(Boolean).join("\n");
}

function formatEvidenceSnippet(snippet) {
  return [
    `[${snippet.id}] ${snippet.location}`,
    snippet.text
  ].join("\n");
}

function selectEvidenceSnippets(session, question) {
  const source = session.sourceText || "";
  if (!source) {
    return [];
  }

  const paragraphs = source
    .split(/\n{2,}|(?<=\.)\s+(?=[A-Z가-힣0-9])/)
    .map((text, index) => ({ text: cleanText(text), index }))
    .filter((item) => item.text.length > 120);
  const terms = extractQueryTerms(question);
  const totalChars = source.length || 1;

  const selected = paragraphs
    .map((item) => {
      const lower = item.text.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
      return { ...item, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 8);

  if (!selected.length) {
    selected.push(...paragraphs.slice(0, 6));
  }

  let usedChars = 0;
  const snippets = [];
  for (const item of selected) {
    const text = item.text.length > 1400 ? `${item.text.slice(0, 1400)}...` : item.text;
    if (usedChars + text.length > CHAT_CONTEXT_MAX_CHARS) {
      break;
    }
    usedChars += text.length;
    const offset = source.indexOf(item.text.slice(0, 80));
    const percent = offset >= 0
      ? Math.round((offset / totalChars) * 100)
      : Math.round((item.index / Math.max(1, paragraphs.length)) * 100);
    snippets.push({
      id: `S${snippets.length + 1}`,
      location: `${session.sourceLabel || "source"} 약 ${percent}% 지점`,
      text
    });
  }
  return snippets;
}

function extractQueryTerms(question) {
  const stopwords = new Set(["what", "why", "how", "the", "and", "for", "with", "this", "that", "논문", "내용", "어떤", "무엇", "왜", "어떻게", "설명", "알려줘"]);
  const terms = String(question || "")
    .toLowerCase()
    .match(/[a-z0-9_./-]{3,}|[가-힣]{2,}/g) || [];
  return Array.from(new Set(terms.filter((term) => !stopwords.has(term)))).slice(0, 24);
}

async function getPaperWithReadableText(paper, signal, mode, onLog) {
  const readable = await fetchReadablePaperText(paper.id, signal, onLog).catch((error) => {
    onLog?.(`논문 본문 소스 확인 실패: ${error.message}`, "warn");
    return null;
  });
  if (readable?.text) {
    const trimmedText = trimReadableText(readable.text, mode.sourceMaxChars || mode.maxTotalChars);
    onLog?.(`논문 본문 소스 선택: ${readable.sourceType} (${readable.url})`);
    return {
      ...paper,
      readableText: trimmedText.text,
      sourceUrl: readable.url,
      sourceType: readable.sourceType,
      truncated: trimmedText.truncated
    };
  }

  onLog?.("전문 텍스트를 찾지 못해 arXiv 초록/메타데이터로 폴백", "warn");
  return {
    ...paper,
    readableText: "",
    sourceUrl: paper.url,
    sourceType: "arXiv abstract",
    truncated: false
  };
}

async function fetchReadablePaperText(id, signal, onLog) {
  const baseId = baseArxivId(id);
  const htmlCandidates = [
    { url: `https://arxiv.org/html/${id}`, sourceType: "arXiv HTML" },
    { url: `https://arxiv.org/html/${baseId}`, sourceType: "arXiv HTML" },
    { url: `https://ar5iv.labs.arxiv.org/html/${baseId}`, sourceType: "ar5iv HTML" }
  ];

  const seen = new Set();
  for (const candidate of htmlCandidates) {
    if (seen.has(candidate.url)) {
      continue;
    }
    seen.add(candidate.url);

    try {
      onLog?.(`본문 후보 요청: ${candidate.sourceType} ${candidate.url}`);
      const response = await fetch(candidate.url, { signal });
      if (!response.ok) {
        onLog?.(`본문 후보 건너뜀: HTTP ${response.status} ${candidate.url}`, "warn");
        continue;
      }

      const html = await response.text();
      const text = extractReadableTextFromHtml(html);
      if (text.length > 1200) {
        onLog?.(`본문 후보 사용 가능: ${candidate.sourceType}, textChars=${text.length}`);
        return { ...candidate, text };
      }
      onLog?.(`본문 후보 텍스트가 너무 짧음: ${candidate.sourceType}, textChars=${text.length}`, "warn");
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }
      onLog?.(`본문 후보 요청 실패: ${candidate.url} (${error.message})`, "warn");
    }
  }

  const sourceCandidates = [
    { url: `https://arxiv.org/e-print/${id}`, sourceType: "arXiv source" },
    { url: `https://arxiv.org/e-print/${baseId}`, sourceType: "arXiv source" }
  ];

  for (const candidate of sourceCandidates) {
    if (seen.has(candidate.url)) {
      continue;
    }
    seen.add(candidate.url);

    try {
      onLog?.(`원본 소스 후보 요청: ${candidate.sourceType} ${candidate.url}`);
      const response = await fetch(candidate.url, { signal });
      if (!response.ok) {
        onLog?.(`원본 소스 후보 건너뜀: HTTP ${response.status} ${candidate.url}`, "warn");
        continue;
      }

      const buffer = await response.arrayBuffer();
      const text = await extractReadableTextFromSourceArchive(buffer);
      if (text.length > 1200) {
        onLog?.(`원본 소스 후보 사용 가능: textChars=${text.length}`);
        return { ...candidate, text };
      }
      onLog?.(`원본 소스 텍스트가 너무 짧음: textChars=${text.length}`, "warn");
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }
      onLog?.(`원본 소스 후보 요청 실패: ${candidate.url} (${error.message})`, "warn");
    }
  }

  const pdfCandidates = [
    { url: `https://arxiv.org/pdf/${id}`, sourceType: "arXiv PDF" },
    { url: `https://arxiv.org/pdf/${baseId}`, sourceType: "arXiv PDF" }
  ];

  for (const candidate of pdfCandidates) {
    if (seen.has(candidate.url)) {
      continue;
    }
    seen.add(candidate.url);

    try {
      onLog?.(`PDF 후보 요청: ${candidate.sourceType} ${candidate.url}`);
      const response = await fetch(candidate.url, { signal });
      if (!response.ok) {
        onLog?.(`PDF 후보 건너뜀: HTTP ${response.status} ${candidate.url}`, "warn");
        continue;
      }

      const buffer = await response.arrayBuffer();
      const text = await extractReadableTextFromPdf(buffer);
      if (text.length > 1200) {
        onLog?.(`PDF 후보 사용 가능: textChars=${text.length}`);
        return { ...candidate, text };
      }
      onLog?.(`PDF 텍스트가 너무 짧음: textChars=${text.length}`, "warn");
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }
      onLog?.(`PDF 후보 요청 실패: ${candidate.url} (${error.message})`, "warn");
    }
  }

  return null;
}

async function extractReadableTextFromSourceArchive(buffer) {
  const decompressed = await maybeDecompress(buffer, "gzip").catch(() => buffer);
  const tarEntries = extractTarTextEntries(decompressed);
  if (tarEntries.length) {
    return cleanLatexText(tarEntries.join("\n\n"));
  }

  return cleanLatexText(decodeBytes(decompressed));
}

function extractTarTextEntries(buffer) {
  const bytes = new Uint8Array(buffer);
  const entries = [];
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const name = decodeBytes(bytes.slice(offset, offset + 100)).replace(/\0.*$/, "").trim();
    if (!name) {
      break;
    }
    const sizeText = decodeBytes(bytes.slice(offset + 124, offset + 136)).replace(/\0.*$/, "").trim();
    const size = parseInt(sizeText || "0", 8) || 0;
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (/\.(tex|bbl|txt|md)$/i.test(name) && dataEnd <= bytes.length) {
      entries.push(decodeBytes(bytes.slice(dataStart, dataEnd)));
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function cleanLatexText(value) {
  return cleanText(decodeHtmlEntities(String(value || "")
    .replace(/%.*$/gm, " ")
    .replace(/\\(begin|end)\{[^}]+\}/g, "\n")
    .replace(/\\(section|subsection|subsubsection|paragraph)\*?\{([^}]+)\}/g, "\n$2\n")
    .replace(/\\(title|author|caption)\{([^}]+)\}/g, "\n$2\n")
    .replace(/\\cite[tp]?\{[^}]+\}/g, " [citation] ")
    .replace(/\\ref\{[^}]+\}/g, " [ref] ")
    .replace(/\$[^$]*\$/g, " ")
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{([^{}]*)\})?/g, " $1 ")
    .replace(/[{}\\]/g, " ")
    .replace(/\s+/g, " ")));
}

async function extractReadableTextFromPdf(buffer) {
  const streams = extractPdfStreams(buffer);
  const chunks = [];
  for (const stream of streams) {
    const decoded = await maybeDecompress(stream, "deflate").catch(() => stream);
    const text = extractPdfTextOperators(decodeBytes(decoded));
    if (text) {
      chunks.push(text);
    }
  }
  return cleanText(chunks.join("\n\n"));
}

function extractPdfStreams(buffer) {
  const bytes = new Uint8Array(buffer);
  const pdfText = decodeBytes(bytes);
  const streams = [];
  let searchFrom = 0;
  while (true) {
    const streamIndex = pdfText.indexOf("stream", searchFrom);
    if (streamIndex < 0) {
      break;
    }
    let dataStart = streamIndex + "stream".length;
    if (pdfText[dataStart] === "\r" && pdfText[dataStart + 1] === "\n") {
      dataStart += 2;
    } else if (pdfText[dataStart] === "\n" || pdfText[dataStart] === "\r") {
      dataStart += 1;
    }
    const endIndex = pdfText.indexOf("endstream", dataStart);
    if (endIndex < 0) {
      break;
    }
    streams.push(bytes.slice(dataStart, endIndex).buffer);
    searchFrom = endIndex + "endstream".length;
  }
  return streams;
}

function extractPdfTextOperators(value) {
  const text = [];
  const singleText = /(\((?:\\.|[^\\()])*\)|<[\da-fA-F\s]+>)\s*Tj/g;
  let match;
  while ((match = singleText.exec(value))) {
    text.push(decodePdfString(match[1]));
  }

  const arrayText = /\[((?:.|\n)*?)\]\s*TJ/g;
  while ((match = arrayText.exec(value))) {
    const parts = match[1].match(/\((?:\\.|[^\\()])*\)|<[\da-fA-F\s]+>/g) || [];
    text.push(parts.map(decodePdfString).join(""));
  }
  return text.join(" ");
}

function decodePdfString(value) {
  if (value.startsWith("<")) {
    const hex = value.slice(1, -1).replace(/\s+/g, "");
    const chars = [];
    for (let index = 0; index + 1 < hex.length; index += 2) {
      chars.push(String.fromCharCode(parseInt(hex.slice(index, index + 2), 16)));
    }
    return chars.join("");
  }

  return value.slice(1, -1)
    .replace(/\\([nrtbf()\\])/g, (_match, char) => ({
      n: "\n",
      r: "\r",
      t: "\t",
      b: "\b",
      f: "\f",
      "(": "(",
      ")": ")",
      "\\": "\\"
    })[char] || char)
    .replace(/\\([0-7]{1,3})/g, (_match, octal) => String.fromCharCode(parseInt(octal, 8)));
}

async function maybeDecompress(buffer, format) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream unsupported");
  }
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream(format));
  return new Response(stream).arrayBuffer();
}

function decodeBytes(value) {
  return new TextDecoder("latin1").decode(value);
}

function extractReadableTextFromHtml(html) {
  return cleanText(decodeHtmlEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<math[\s\S]*?<\/math>/gi, " ")
    .replace(/<(\/)?(h[1-6]|p|section|article|div|li|blockquote|tr|br)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n"));
}

function decodeHtmlEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"'
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    try {
      if (lower.startsWith("#x")) {
        return String.fromCodePoint(parseInt(lower.slice(2), 16));
      }
      if (lower.startsWith("#")) {
        return String.fromCodePoint(parseInt(lower.slice(1), 10));
      }
    } catch (_error) {
      return match;
    }
    return named[lower] || match;
  });
}

function trimReadableText(text, maxTotalChars) {
  const withoutReferences = text.split(/\n\s*(References|Bibliography)\s*\n/i)[0] || text;
  const trimmed = withoutReferences.length > maxTotalChars
    ? withoutReferences.slice(0, maxTotalChars)
    : withoutReferences;

  return {
    text: cleanText(trimmed),
    truncated: withoutReferences.length > maxTotalChars
  };
}

function buildSourceText(paper, mode) {
  const metadata = [
    paper.title ? `Title: ${paper.title}` : "",
    paper.authors?.length ? `Authors: ${paper.authors.join(", ")}` : "",
    paper.subjects ? `Subjects: ${paper.subjects}` : "",
    paper.comments ? `Comments: ${paper.comments}` : "",
    paper.journalRef ? `Journal reference: ${paper.journalRef}` : "",
    paper.doi ? `DOI: ${paper.doi}` : "",
    paper.abstract ? `Abstract: ${paper.abstract}` : ""
  ].filter(Boolean).join("\n");

  if (paper.readableText) {
    const body = mode.focused
      ? extractFocusedPaperText(paper.readableText, mode.maxTotalChars)
      : paper.readableText;
    return {
      sourceLabel: mode.focused ? `${paper.sourceType} focused sections` : paper.sourceType,
      text: `${metadata}\n\nPaper body:\n${body}`.trim()
    };
  }

  return {
    sourceLabel: "arXiv abstract",
    text: metadata || `arXiv ID: ${paper.id}`
  };
}

function extractFocusedPaperText(text, maxChars) {
  const normalized = cleanText(text);
  const intro = extractSectionWindow(normalized, /^(?:[0-9]+(?:\.[0-9]+)*\s*)?(?:1\s*)?introduction\b/i, 8500);
  const conclusion = extractSectionWindow(normalized, /^(?:[0-9]+(?:\.[0-9]+)*\s*)?(?:conclusion|conclusions|discussion|limitations|future work)\b/i, 8500);
  const opening = normalized.slice(0, 7000);
  const sections = [
    "Opening/body excerpt:",
    opening,
    intro ? "\nIntroduction-focused excerpt:" : "",
    intro,
    conclusion ? "\nConclusion/discussion-focused excerpt:" : "",
    conclusion
  ].filter(Boolean).join("\n\n");

  return sections.length > maxChars ? sections.slice(0, maxChars) : sections;
}

function extractSectionWindow(text, headingPattern, maxChars) {
  const lines = text.split(/\n+/);
  const start = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (start < 0) {
    return "";
  }

  const sectionLines = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (index > start && isLikelyHeading(line) && sectionLines.join("\n").length > 1200) {
      break;
    }
    sectionLines.push(line);
    if (sectionLines.join("\n").length >= maxChars) {
      break;
    }
  }

  return cleanText(sectionLines.join("\n")).slice(0, maxChars);
}

function isLikelyHeading(line) {
  if (!line || line.length > 120) {
    return false;
  }

  return /^(?:[0-9]+(?:\.[0-9]+)*\s+)?[A-Z][A-Za-z0-9,;:() /-]{2,}$/.test(line)
    || /^(?:[IVX]+\.\s+)?[A-Z][A-Za-z0-9,;:() /-]{2,}$/.test(line);
}

function chunkText(text, maxChars) {
  if (text.length <= maxChars) {
    return [text];
  }

  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (paragraph.length <= maxChars) {
      current = paragraph;
      continue;
    }

    for (let start = 0; start < paragraph.length; start += maxChars) {
      chunks.push(paragraph.slice(start, start + maxChars));
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function buildChunkPrompt(paper, chunk, index, total, sourceLabel, language = getLanguage()) {
  return [
    `You are a careful research assistant summarizing an arXiv paper for a ${language.readerLabel}.`,
    "Use only the supplied text. Do not invent experiments, metrics, datasets, or claims.",
    language.summaryInstruction,
    "",
    `Paper ID: ${paper.id}`,
    `Title: ${paper.title || "Unknown"}`,
    `Source: ${sourceLabel}`,
    `Chunk: ${index}/${total}`,
    "",
    "Return a compact partial summary with these labels:",
    ...language.partialLabels.map((label) => `- ${label}`),
    "",
    "Text:",
    chunk
  ].join("\n");
}

function buildDirectPrompt(paper, sourceText, sourceLabel, mode, language = getLanguage()) {
  return [
    `You are a careful research assistant summarizing an arXiv paper for a ${language.readerLabel}.`,
    "Use only the supplied text. Do not invent experiments, metrics, datasets, or claims.",
    language.summaryInstruction,
    mode.focused ? "This is a fast summary from abstract/opening/introduction/conclusion-focused excerpts, so explicitly mention that details may require checking the full paper." : "",
    "",
    `Paper ID: ${paper.id}`,
    `Title: ${paper.title || "Unknown"}`,
    `Source used: ${sourceLabel}`,
    `Mode: ${mode.label}`,
    "",
    "Final answer format:",
    ...language.finalLabels.map((label, index) => `${index + 1}. ${label}`),
    "",
    "Text:",
    sourceText
  ].filter(Boolean).join("\n");
}

function buildFinalPrompt(paper, partialSummaries, sourceLabel, truncated, language = getLanguage()) {
  return [
    "You are a careful research assistant. Synthesize the partial summaries of one arXiv paper.",
    `${language.answerInstruction} Use only the information in the partial summaries.`,
    "If evidence is missing, say so directly. Do not overstate results.",
    "",
    `Paper ID: ${paper.id}`,
    `Title: ${paper.title || "Unknown"}`,
    `Authors: ${paper.authors?.join(", ") || "Unknown"}`,
    `Source used: ${sourceLabel}`,
    truncated ? "Note: The source text was truncated because the paper was long." : "",
    "",
    "Final answer format:",
    ...language.finalLabels.map((label, index) => `${index + 1}. ${label}`),
    "",
    "Partial summaries:",
    partialSummaries.join("\n\n---\n\n")
  ].filter(Boolean).join("\n");
}

async function generateWithOllama(model, prompt, signal, onStream, mode) {
  const requestBody = {
    model,
    prompt,
    stream: true,
    options: {
      temperature: 0.2,
      num_ctx: mode.numCtx
    }
  };

  if (typeof mode.think === "boolean") {
    requestBody.think = mode.think;
  }

  let data;
  try {
    data = await requestOllamaGenerate(requestBody, signal, onStream);
  } catch (error) {
    if (!error.code && /think/i.test(error.message || "")) {
      delete requestBody.think;
      data = await requestOllamaGenerate(requestBody, signal, onStream);
    } else {
      throw error;
    }
  }

  if (!data.response) {
    throw new Error(data.error || "Ollama가 빈 응답을 반환했습니다.");
  }

  return data.response.trim();
}

function requestOllamaGenerate(body, signal, onStream) {
  return ollamaStreamJson("/api/generate", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  }, onStream);
}

async function ollamaJson(path, init) {
  const response = await ollamaFetch(path, init);
  return response.json();
}

async function ollamaStreamJson(path, init, onStream) {
  const response = await ollamaFetch(path, init);
  if (!response.body) {
    const data = await response.json();
    return {
      response: data.response || "",
      thinking: data.thinking || ""
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let responseText = "";
  let thinkingText = "";

  onStream?.({ type: "STREAM_START" });

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const parsed = parseStreamLine(line);
      if (!parsed) {
        continue;
      }

      if (parsed.error) {
        throw new Error(parsed.error);
      }

      if (parsed.thinking) {
        thinkingText += parsed.thinking;
        onStream?.({
          type: "STREAM_DELTA",
          channel: "thinking",
          delta: parsed.thinking
        });
      }

      if (parsed.response) {
        responseText += parsed.response;
        onStream?.({
          type: "STREAM_DELTA",
          channel: "response",
          delta: parsed.response
        });
      }

      if (parsed.done) {
        onStream?.({
          type: "STREAM_DONE",
          evalCount: parsed.eval_count,
          totalDuration: parsed.total_duration
        });
      }
    }
  }

  if (buffer.trim()) {
    const parsed = parseStreamLine(buffer);
    if (parsed?.error) {
      throw new Error(parsed.error);
    }
    if (parsed?.thinking) {
      thinkingText += parsed.thinking;
      onStream?.({ type: "STREAM_DELTA", channel: "thinking", delta: parsed.thinking });
    }
    if (parsed?.response) {
      responseText += parsed.response;
      onStream?.({ type: "STREAM_DELTA", channel: "response", delta: parsed.response });
    }
  }

  return {
    response: responseText,
    thinking: thinkingText
  };
}

function parseStreamLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    return null;
  }
}

async function ollamaFetch(path, init) {
  const stored = await storageGet(["ollamaBase"]);
  const normalized = normalizeOllamaBase(ollamaBase || stored.ollamaBase);
  const base = normalized.ok ? normalized.value : DEFAULT_OLLAMA_BASE;
  ollamaBase = base;
  let sawForbidden = false;

  try {
    const response = await fetch(`${base}${path}`, init);
    if (!response.ok) {
      sawForbidden = response.status === 403;
      throw new Error(await readOllamaError(response));
    }

    return response;
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }

    if (sawForbidden) {
      const forbidden = new Error(OLLAMA_ORIGIN_HELP.message);
      forbidden.code = "OLLAMA_FORBIDDEN";
      throw forbidden;
    }

    throw new Error(`Ollama 연결 실패. 주소와 실행 여부를 확인하세요. (${base}: ${error.message})`);
  }
}

function normalizeOllamaBase(value) {
  const raw = String(value || DEFAULT_OLLAMA_BASE).trim();
  if (!raw) {
    return {
      ok: true,
      value: DEFAULT_OLLAMA_BASE
    };
  }

  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    const url = new URL(withProtocol);
    if (!["http:", "https:"].includes(url.protocol)) {
      return {
        ok: false,
        message: "Ollama 주소는 http:// 또는 https:// 로 시작해야 합니다."
      };
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return {
      ok: true,
      value: url.toString().replace(/\/$/, "")
    };
  } catch (_error) {
    return {
      ok: false,
      message: "올바른 Ollama 주소가 아닙니다. 예: http://localhost:11434"
    };
  }
}

async function readOllamaError(response) {
  const text = await response.text().catch(() => "");
  if (!text) {
    return `Ollama HTTP ${response.status}`;
  }

  try {
    const data = JSON.parse(text);
    return data.error || `Ollama HTTP ${response.status}`;
  } catch (_error) {
    return text || `Ollama HTTP ${response.status}`;
  }
}

function postStreamEvent(port, event) {
  if (event.type === "STREAM_START") {
    postLog(port, `Ollama 스트리밍 시작: ${event.label || event.phase || "응답 생성"}`);
  }
  if (event.type === "STREAM_DONE") {
    const tokenLabel = event.evalCount ? `, evalTokens=${event.evalCount}` : "";
    postLog(port, `Ollama 스트리밍 완료: ${event.label || event.phase || "응답 생성"}${tokenLabel}`);
  }
  postToPort(port, event);
}

function postPortError(port, error) {
  if (error.name === "AbortError") {
    postLog(port, "요약 작업 중단됨", "warn");
    postToPort(port, {
      type: "ERROR",
      message: "요약을 중단했습니다.",
      aborted: true
    });
    return;
  }

  postLog(port, `오류 발생: ${error.message || "요약 중 오류가 발생했습니다."}`, "error");
  postToPort(port, {
    type: "ERROR",
    code: error.code || "",
    message: error.message || "요약 중 오류가 발생했습니다.",
    help: error.code === "OLLAMA_FORBIDDEN" ? OLLAMA_ORIGIN_HELP : null
  });
}

function postChatError(session, error) {
  if (error.name === "AbortError") {
    emitToSession(session, {
      type: "CHAT_ERROR",
      message: "답변 생성을 중단했습니다."
    });
    return;
  }

  postLog(session, `질문 답변 오류: ${error.message || "답변 중 오류가 발생했습니다."}`, "error");
  emitToSession(session, {
    type: "CHAT_ERROR",
    message: error.message || "답변 중 오류가 발생했습니다."
  });
}

function postLog(port, message, level = "info") {
  postToPort(port, {
    type: "LOG",
    level,
    message,
    timestamp: new Date().toISOString()
  });
}

function getSummaryMode(modeId) {
  return SUMMARY_MODES[modeId] || SUMMARY_MODES[DEFAULT_SUMMARY_MODE];
}

function getLanguage(languageId = DEFAULT_LANGUAGE) {
  if (languageId === "en") {
    return {
      id: "en",
      label: "English",
      readerLabel: "English reader",
      summaryInstruction: "Write in English. Keep technical terms precise.",
      answerInstruction: "Answer in English.",
      partialLabels: ["Core content", "Method/model", "Results/claims", "Limitations/uncertainties"],
      finalLabels: [
        "One-paragraph summary",
        "Problem setting",
        "Core idea and method",
        "Main results/contributions",
        "Limitations and cautions",
        "Parts worth checking next"
      ],
      chatLabels: ["Answer", "Evidence locations"],
      evidenceHeading: "Evidence locations"
    };
  }

  return {
    id: "ko",
    label: "한국어",
    readerLabel: "Korean reader",
    summaryInstruction: "Write in Korean. Keep technical terms in English when translation would reduce precision.",
    answerInstruction: "Answer in Korean.",
    partialLabels: ["핵심 내용", "방법/모델", "결과/주장", "한계/불확실한 점"],
    finalLabels: [
      "한 문단 요약",
      "문제 설정",
      "핵심 아이디어와 방법",
      "주요 결과/기여",
      "한계와 읽을 때 주의할 점",
      "더 확인하면 좋은 부분"
    ],
    chatLabels: ["답변", "근거 위치"],
    evidenceHeading: "근거 위치"
  };
}

function summaryCacheKey(paperId, model, modeId, languageId = DEFAULT_LANGUAGE) {
  return `summaryCache:${sanitizeKeyPart(paperId)}:${sanitizeKeyPart(modeId)}:${sanitizeKeyPart(languageId)}:${hashString(model)}`;
}

function sourceCacheKey(paperId) {
  return `sourceCache:${sanitizeKeyPart(paperId)}`;
}

function sanitizeKeyPart(value) {
  return String(value || "")
    .replace(/[^a-z0-9._-]+/gi, "_")
    .slice(0, 80);
}

function hashString(value) {
  let hash = 5381;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) + text.charCodeAt(index);
    hash >>>= 0;
  }
  return hash.toString(36);
}

async function getCachedSummary(key) {
  const items = await storageGet([key]);
  const cached = items[key];
  if (!cached || cached.version !== SUMMARY_CACHE_VERSION) {
    return null;
  }
  return cached;
}

function storeCachedSummary(key, output, sourceLabel, mode, language) {
  return storageSet({
    [key]: {
      version: SUMMARY_CACHE_VERSION,
      output,
      sourceLabel,
      mode: mode.id,
      language: language.id,
      savedAt: new Date().toISOString()
    }
  });
}

async function getCachedSource(paperId) {
  const key = sourceCacheKey(paperId);
  const items = await storageGet([key]);
  return items[key] || null;
}

function storeCachedSource(paperId, session) {
  if (!session.sourceText || session.sourceLabel === "arXiv abstract") {
    return Promise.resolve();
  }

  return storageSet({
    [sourceCacheKey(paperId)]: {
      version: 1,
      text: session.sourceText,
      sourceLabel: session.sourceLabel,
      sourceUrl: session.sourceUrl,
      truncated: session.sourceTruncated,
      chars: session.sourceText.length,
      savedAt: new Date().toISOString()
    }
  });
}

function ensurePaperSession(paperId, paper) {
  const key = paperId || "unknown";
  let session = paperSessions.get(key);
  if (!session) {
    session = {
      kind: "paper-session",
      paperId: key,
      paper: paper || null,
      isBusy: false,
      status: "",
      statusIsError: false,
      progress: 0,
      phase: "대기",
      streamLabel: "모델 응답 대기 중",
      streamOutput: "",
      streamThinking: "",
      output: "",
      logs: [],
      originHelp: null,
      abortController: null,
      chatAbortController: null,
      chatBusy: false,
      chatMessages: [],
      sourceText: "",
      sourceLabel: "",
      sourceUrl: "",
      sourceTruncated: false,
      summary: "",
      model: "",
      mode: DEFAULT_SUMMARY_MODE,
      language: DEFAULT_LANGUAGE
    };
    paperSessions.set(key, session);
  }

  if (paper) {
    session.paper = paper;
  }
  return session;
}

function targetForPort(port) {
  const paperId = portStates.get(port)?.paperId;
  return paperId ? paperSessions.get(paperId) || port : port;
}

function emitToSession(session, message) {
  recordSessionMessage(session, message);
  for (const [port, state] of portStates.entries()) {
    if (state.paperId === session.paperId) {
      postToPort(port, message);
    }
  }
}

function recordSessionMessage(session, message) {
  if (message.type === "SESSION_RESET") {
    session.isBusy = true;
    session.status = message.status || "";
    session.statusIsError = false;
    session.progress = message.progress || 0;
    session.phase = message.phase || "요약 준비";
    session.streamLabel = message.streamLabel || "작업 시작";
    session.streamOutput = "";
    session.streamThinking = "";
    session.output = "";
    session.logs = [];
    session.originHelp = null;
    session.model = message.model || session.model;
    session.mode = message.mode || session.mode;
    session.language = message.language || session.language;
    return;
  }

  if (message.type === "LOG") {
    session.logs.push({
      level: message.level || "info",
      message: message.message || "",
      timestamp: message.timestamp || new Date().toISOString()
    });
    if (session.logs.length > 400) {
      session.logs = session.logs.slice(-400);
    }
    return;
  }

  if (message.type === "LOG_RESET") {
    session.logs = [];
    return;
  }

  if (message.type === "STATUS") {
    session.status = message.status || session.status;
    session.statusIsError = false;
    if (typeof message.progress === "number") {
      session.progress = message.progress;
    }
    if (message.status) {
      session.phase = message.status;
    }
    return;
  }

  if (message.type === "STREAM_START") {
    session.isBusy = true;
    session.phase = message.phase || "모델 실행";
    session.streamLabel = message.label || "Ollama 응답 수신 중";
    session.streamOutput = "";
    session.streamThinking = "";
    return;
  }

  if (message.type === "STREAM_DELTA") {
    if (message.channel === "thinking") {
      session.streamThinking += message.delta || "";
    } else {
      session.streamOutput += message.delta || "";
    }
    return;
  }

  if (message.type === "STREAM_DONE") {
    if (message.evalCount) {
      session.streamLabel = `${session.streamLabel} · ${message.evalCount} tokens`;
    }
    return;
  }

  if (message.type === "PARTIAL") {
    session.output = message.output || "";
    return;
  }

  if (message.type === "FINAL") {
    session.output = message.output || "";
    session.summary = message.output || session.summary;
    session.status = message.status || "완료";
    session.statusIsError = false;
    session.progress = typeof message.progress === "number" ? message.progress : 100;
    session.isBusy = false;
    if (!session.streamOutput && /캐시/.test(message.status || "")) {
      session.streamOutput = "캐시된 요약 결과를 사용했습니다.";
      session.streamLabel = "캐시 사용";
    }
    return;
  }

  if (message.type === "CHAT_START") {
    session.chatBusy = true;
    session.chatMessages.push({
      role: "user",
      content: message.question || ""
    }, {
      role: "assistant",
      content: "",
      streaming: true
    });
    session.chatMessages = session.chatMessages.slice(-20);
    return;
  }

  if (message.type === "CHAT_DELTA") {
    const current = session.chatMessages[session.chatMessages.length - 1];
    if (current?.role === "assistant") {
      current.content += message.delta || "";
    }
    return;
  }

  if (message.type === "CHAT_FINAL") {
    const current = session.chatMessages[session.chatMessages.length - 1];
    if (current?.role === "assistant") {
      current.content = message.answer || current.content;
      current.evidence = message.evidence || [];
      delete current.streaming;
    }
    session.chatBusy = false;
    return;
  }

  if (message.type === "CHAT_ERROR") {
    session.chatBusy = false;
    const current = session.chatMessages[session.chatMessages.length - 1];
    if (current?.role === "assistant" && current.streaming) {
      current.content = message.message || "질문 답변 중 오류가 발생했습니다.";
      current.error = true;
      delete current.streaming;
    } else {
      session.chatMessages.push({
        role: "assistant",
        content: message.message || "질문 답변 중 오류가 발생했습니다.",
        error: true
      });
    }
    session.chatMessages = session.chatMessages.slice(-20);
    return;
  }

  if (message.type === "CHAT_RESET") {
    session.chatMessages = [];
    session.chatBusy = false;
    return;
  }

  if (message.type === "CHAT_DONE") {
    session.chatBusy = false;
    const current = session.chatMessages[session.chatMessages.length - 1];
    if (current?.role === "assistant") {
      delete current.streaming;
    }
    return;
  }

  if (message.type === "ERROR") {
    session.status = message.message || "요약 중 오류가 발생했습니다.";
    session.statusIsError = !message.aborted;
    session.isBusy = false;
    session.originHelp = message.help || null;
    return;
  }

  if (message.type === "DONE") {
    session.isBusy = false;
    session.phase = "대기";
  }
}

function sendSessionSnapshot(port, session) {
  postToPort(port, {
    type: "SESSION_STATE",
    state: {
      isBusy: session.isBusy,
      status: session.status,
      statusIsError: session.statusIsError,
      progress: session.progress,
      phase: session.phase,
      streamLabel: session.streamLabel,
      streamOutput: session.streamOutput,
      streamThinking: session.streamThinking,
      output: session.output,
      logs: session.logs,
      chatBusy: session.chatBusy,
      chatMessages: session.chatMessages,
      originHelp: session.originHelp,
      model: session.model,
      mode: session.mode,
      language: session.language
    }
  });
}

function broadcastToAllPorts(message) {
  for (const port of portStates.keys()) {
    postToPort(port, message);
  }
}

function postToPort(port, message) {
  if (port?.kind === "paper-session") {
    emitToSession(port, message);
    return;
  }

  try {
    port.postMessage(message);
  } catch (_error) {
    // The page may have navigated away while a local model was still running.
  }
}

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

function storageSet(items) {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, resolve);
  });
}

function storageRemove(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, resolve);
  });
}

function logStorageKey(paperId) {
  return `processLog:${paperId}`;
}

function baseArxivId(id) {
  return id.replace(/v[0-9]+$/i, "");
}

function cleanText(value) {
  return (value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
