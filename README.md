# OllaXiv

**언어:** 한국어 | [English](README.en.md)

<p align="center">
  <img src="assets/OllaXiv.png" alt="OllaXiv 마스코트와 로고" width="720">
</p>

OllaXiv는 arXiv 논문을 Ollama로 읽기 위한 Chrome 확장 프로그램입니다. 현재 보고 있는 arXiv 논문을 요약하고, 생성된 요약과 논문 본문을 바탕으로 이어서 질문할 수 있습니다. 기본 사용 방식은 로컬 우선이며, 사용자가 직접 관리하는 원격 Ollama 주소도 사용할 수 있습니다.

이 서비스는 논문을 더 빠르게 이해하고 싶은 사람을 위해 만들었습니다. 논문 텍스트를 외부 호스팅 LLM 서비스로 보내지 않고, 로컬 Ollama 모델 또는 사용자가 지정한 Ollama 호환 서버로 처리합니다.

## 주요 기능

- 현재 arXiv 논문 페이지 안에서 바로 요약합니다.
- 요약 이후 논문에 대해 계속 질문할 수 있습니다.
- `[S1]` 같은 근거 조각을 함께 보여줘 답변이 어떤 부분을 바탕으로 했는지 확인할 수 있습니다.
- 한국어와 영어 UI/응답을 지원합니다.
- 로컬 Ollama와 원격 Ollama URL을 모두 지원합니다.
- 설정, 진행 로그, 전문 텍스트 캐시, 요약 캐시를 Chrome 로컬 저장소에 저장합니다.
- 모델 확인, 본문 추출, 요약, 논문 Q&A 진행 상황을 로그로 보여줍니다.

## 자산

공식 마스코트, 로고, 아이콘 파일은 `assets/`에 포함되어 있습니다.

- 큰 로고: `assets/OllaXiv.png`
- 큰 정사각형 로고: `assets/OllaXiv-square.png`
- Chrome 아이콘: `assets/icon-16.png`, `assets/icon-32.png`, `assets/icon-48.png`, `assets/icon-128.png`
- 실제 사용 이미지: `assets/ollaxiv_use1.png`, `assets/ollaxiv_use2.png`

<p align="center">
  <img src="assets/OllaXiv-square.png" alt="OllaXiv 정사각형 로고" width="260">
</p>

## 설치

### 방법 1. Chrome Web Store

Chrome Web Store에서 OllaXiv를 설치합니다.

[Chrome Web Store - OllaXiv](https://chromewebstore.google.com/detail/hjaaenpglimkmieebbbhlaiaolfdpgle?utm_source=item-share-cb)

### 방법 2. 이 리포지토리에서 설치

1. 이 리포지토리를 다운로드합니다.

```bash
git clone https://github.com/z8086486/OllaXiv.git
cd OllaXiv
```

2. Chrome에서 아래 주소를 엽니다.

```text
chrome://extensions
```

3. 오른쪽 위 `개발자 모드`를 켭니다.
4. `압축해제된 확장 프로그램을 로드`를 누릅니다.
5. 다운로드한 `OllaXiv` 폴더를 선택합니다.

설치가 끝나면 Chrome 확장 툴바에 OllaXiv 아이콘이 표시됩니다.

## 필수 Ollama 설정

OllaXiv는 Chrome 확장 origin에서 Ollama에 요청을 보냅니다. Ollama 실행 방식에 따라 `OLLAMA_ORIGINS`를 설정하지 않으면 HTTP 403으로 요청이 거부될 수 있습니다.

macOS에서 Ollama 앱으로 실행 중이라면 터미널에서 아래 명령을 실행합니다.

```bash
launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
```

그 다음 Ollama를 완전히 종료하고 다시 실행하세요.

터미널에서 직접 Ollama를 실행한다면 기존 Ollama 프로세스를 종료한 뒤 아래처럼 실행합니다.

```bash
OLLAMA_ORIGINS="chrome-extension://*" ollama serve
```

사용할 Ollama 모델도 최소 하나 설치되어 있어야 합니다.

```bash
ollama pull qwen3.5:4b
```

이미 설치된 다른 모델을 사용해도 됩니다.

## 사용 방법

1. arXiv 논문 페이지를 엽니다.

```text
https://arxiv.org/abs/2401.00000
```

2. OllaXiv 팝업을 열고 아래 설정을 확인합니다.
   - Ollama 주소
   - 모델
   - 요약 모드
   - 사용 언어
   - 페이지 UI 표시 여부

3. arXiv 페이지 안의 OllaXiv 패널을 펼칩니다.
4. `논문 요약`을 누릅니다.
5. 페이지 안에서 생성된 요약을 확인합니다.
6. 논문 채팅 입력창에서 후속 질문을 입력합니다.

팝업은 설정, 상태, 진행 로그, 로컬 저장소 관리를 위한 공간입니다. arXiv 페이지 안의 패널은 요약 결과와 논문 Q&A를 보는 공간입니다.

### 팝업 설정과 페이지 패널

팝업에서는 페이지 UI 켜기/끄기, Ollama 주소, 모델, 요약 모드, 언어, 진행 로그, 로컬 저장소를 관리합니다.

<p align="center">
  <img src="assets/ollaxiv_use1.png" alt="OllaXiv 팝업 설정과 arXiv 페이지 패널" width="860">
</p>

페이지 UI가 켜져 있으면 현재 arXiv 논문 페이지 안에 OllaXiv가 표시됩니다. 처음에는 작은 패널로 표시되고, 펼치면 요약과 논문 Q&A 작업 공간이 나타납니다.

### arXiv 페이지 안의 요약 결과

요약이 끝나면 결과가 논문 초록 아래에 표시됩니다. arXiv와 어울리는 형태를 유지하면서 OllaXiv 요약과 채팅 영역을 추가합니다.

<p align="center">
  <img src="assets/ollaxiv_use2.png" alt="arXiv 논문 페이지 안에 표시된 OllaXiv 요약 결과" width="860">
</p>

## 요약 모드

- `빠름`: 초록, 앞부분, 서론, 결론 계열 섹션 중심으로 빠르게 요약합니다.
- `표준`: thinking 없이 큰 청크 단위로 요약합니다. 기본 균형 모드입니다.
- `자세히`: 더 작은 청크를 사용하고, 모델이 지원하면 Ollama thinking을 켭니다. 더 느리지만 자세합니다.

## 논문 텍스트 수집 방식

OllaXiv는 아래 순서로 논문 본문을 찾습니다.

1. arXiv HTML
2. ar5iv HTML
3. arXiv e-print 소스와 TeX 추출
4. arXiv PDF 텍스트 추출
5. arXiv 초록과 메타데이터 fallback

긴 논문은 선택한 요약 모드의 입력 길이에 맞춰 일부가 잘릴 수 있습니다.

## 로컬 저장소

OllaXiv는 Chrome 로컬 저장소에 아래 데이터를 저장합니다.

- `selectedModel`
- `selectedMode`
- `selectedLanguage`
- `ollamaBase`
- `pagePanelEnabled`
- `processLog:*`
- `sourceCache:*`
- `summaryCache:*`

팝업의 로컬 저장소 섹션에서 항목을 확인하고 개별 삭제할 수 있습니다.

## 원격 Ollama URL

기본 Ollama 주소는 아래와 같습니다.

```text
http://localhost:11434
```

다른 호스트에서 Ollama를 실행한다면 팝업에서 주소를 바꿀 수 있습니다. `로컬` 또는 `Reset to local`을 누르면 기본 주소로 돌아갑니다.

## 문제 해결

### Ollama HTTP 403

위의 `OLLAMA_ORIGINS` 설정을 적용한 뒤 Ollama를 다시 실행하고, Chrome의 `chrome://extensions`에서 확장을 새로고침하세요.

### 모델을 찾지 못하는 경우

Ollama가 실행 중인지 확인합니다.

```bash
ollama list
```

목록이 비어 있다면 모델을 설치합니다.

```bash
ollama pull qwen3.5:4b
```

### 페이지 패널이 보이지 않는 경우

팝업을 열고 `페이지 UI 표시`가 켜져 있는지 확인한 뒤 arXiv 탭을 새로고침하세요.

## License

MIT
