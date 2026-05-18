# OllaXiv Privacy Policy

Last updated: May 18, 2026

OllaXiv is a Chrome extension that helps users summarize and discuss arXiv papers with a local or user-configured Ollama server.

This policy explains what data OllaXiv reads, stores, and sends in order to provide its single purpose.

## Single Purpose

OllaXiv has one purpose: to help users summarize and ask questions about arXiv papers using their own Ollama endpoint.

The extension:

- detects the current arXiv paper page,
- extracts paper metadata and readable paper text,
- sends the paper text and user questions to the Ollama API endpoint configured by the user,
- displays summaries, answers, evidence snippets, progress logs, and local cache controls.

## Data OllaXiv Reads

OllaXiv may read the following website content when the user is on an arXiv paper page:

- arXiv paper ID,
- paper title,
- author names,
- abstract,
- visible arXiv metadata,
- available paper body text from arXiv or ar5iv,
- arXiv source or PDF-derived text when HTML text is unavailable.

OllaXiv does not read unrelated website content for its summarization workflow.

## Data Stored Locally

OllaXiv stores extension data in Chrome local storage. This may include:

- selected Ollama model,
- selected summary mode,
- selected language,
- configured Ollama URL,
- page UI enabled/disabled setting,
- progress logs,
- extracted source text cache,
- summary cache.

These items are stored locally in the user's browser. Users can inspect and delete stored logs, source caches, summary caches, or all local extension data from the OllaXiv popup.

## Data Sent Outside the Browser

OllaXiv sends data only as needed to provide summarization and paper question-answering.

The extension may send requests to:

- `arxiv.org` to fetch paper pages, source files, or PDFs,
- `ar5iv.labs.arxiv.org` to fetch readable HTML versions of papers,
- the Ollama API endpoint configured by the user, such as `http://localhost:11434` or another user-provided HTTP/HTTPS Ollama URL.

The data sent to the Ollama endpoint may include:

- paper metadata,
- paper text or excerpts,
- generated partial summaries,
- the user's paper-related questions,
- selected evidence snippets.

OllaXiv does not send this data to any OllaXiv-operated server. OllaXiv does not operate a backend service for collecting user data.

## Remote Ollama Endpoints

By default, OllaXiv uses:

```text
http://localhost:11434
```

Users may configure a different Ollama endpoint. If a user chooses a remote Ollama endpoint, paper text and questions are sent to that endpoint. Users are responsible for choosing an endpoint they trust.

## Data OllaXiv Does Not Collect

OllaXiv does not collect:

- personally identifiable information,
- health information,
- financial or payment information,
- authentication credentials,
- personal communications,
- location data,
- browsing history for unrelated websites.

OllaXiv does not sell user data.

OllaXiv does not use user data for advertising.

OllaXiv does not use user data for creditworthiness, lending, or eligibility decisions.

## Website Content

OllaXiv uses website content only to summarize and answer questions about arXiv papers. This includes paper metadata, abstract text, and available paper body text. This content is used only for the extension's stated purpose.

## Permissions

OllaXiv requests the following Chrome permissions:

- `activeTab`: to detect and read metadata from the currently active arXiv paper tab when the user opens the popup.
- `tabs`: to check whether the active tab URL is an arXiv paper page.
- `storage`: to save local settings, progress logs, source text cache, and summary cache.
- host permissions for `arxiv.org` and `ar5iv.labs.arxiv.org`: to fetch paper content.
- host permissions for local and user-configured Ollama endpoints: to communicate with Ollama for summarization and question-answering.

## Remote Code

OllaXiv does not load or execute remotely hosted JavaScript or executable code.

OllaXiv sends HTTP requests to arXiv, ar5iv, and the user-configured Ollama endpoint. Responses from Ollama are treated as text data and rendered by the extension.

## Changes to This Policy

This privacy policy may be updated if OllaXiv changes how it handles data. Updates will be published in this repository.

## Contact

For questions about this privacy policy, please open an issue in the OllaXiv GitHub repository:

```text
https://github.com/z8086486/OllaXiv
```
