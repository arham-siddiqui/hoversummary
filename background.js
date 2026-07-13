const DEFAULT_MODEL = "qwen3-vl:4b-instruct";
const OLLAMA_URL = "http://127.0.0.1:11434";
const SUPPORTED_MODELS = new Set([
  "qwen3-vl:2b-instruct",
  "qwen3-vl:4b-instruct",
  "qwen3-vl:8b-instruct"
]);

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(["model"], ({ model }) => {
    if (!SUPPORTED_MODELS.has(model)) chrome.storage.sync.set({ model: DEFAULT_MODEL });
  });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "start-selection") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "START_LASSO" }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "TEST_OLLAMA") {
    testOllama(message.model || DEFAULT_MODEL)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "BEGIN_LASSO") {
    chrome.tabs.sendMessage(sender.tab?.id ?? message.tabId, { type: "START_LASSO" })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "CAPTURE_REGION") {
    captureAndSummarize(message.rect, sender)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }
});

async function captureAndSummarize(rect, sender) {
  if (sender.tab?.windowId == null) throw new Error("No active browser tab was found.");

  const screenshot = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" });
  const croppedImage = await cropScreenshot(screenshot, rect);
  if (sender.tab.id) {
    chrome.tabs.sendMessage(sender.tab.id, { type: "CAPTURE_PREVIEW", croppedImage }).catch(() => {});
  }
  const summary = await askOllama(croppedImage);
  return { croppedImage, summary };
}

async function cropScreenshot(dataUrl, rect) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const scaleX = bitmap.width / rect.viewportWidth;
  const scaleY = bitmap.height / rect.viewportHeight;
  const sx = Math.max(0, Math.round(rect.x * scaleX));
  const sy = Math.max(0, Math.round(rect.y * scaleY));
  const sw = Math.min(bitmap.width - sx, Math.max(1, Math.round(rect.width * scaleX)));
  const sh = Math.min(bitmap.height - sy, Math.max(1, Math.round(rect.height * scaleY)));

  const maxDimension = 1600;
  const downscale = Math.min(1, maxDimension / Math.max(sw, sh));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(sw * downscale)),
    Math.max(1, Math.round(sh * downscale))
  );
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const croppedBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  return blobToDataUrl(croppedBlob);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function askOllama(imageDataUrl) {
  const { model: savedModel } = await chrome.storage.sync.get(["model"]);
  const model = SUPPORTED_MODELS.has(savedModel) ? savedModel : DEFAULT_MODEL;
  const base64Image = imageDataUrl.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      keep_alive: "10m",
      messages: [{
        role: "user",
        content: "Explain the selected screenshot in simple, everyday language. Capture the main idea, define any difficult terms, and preserve important numbers or caveats. If it is primarily an image, diagram, or chart, explain what it shows. Be concise: use a short overview followed by at most 3 useful bullet points. Do not mention that you are looking at a screenshot. Return only the final explanation, without reasoning or analysis.",
        images: [base64Image]
      }],
      options: {
        temperature: 0.2,
        num_predict: 500
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error || `Ollama request failed (${response.status}).`;
    throw new Error(message);
  }

  const text = payload?.message?.content?.trim();

  if (!text) throw new Error("Ollama returned an empty summary.");
  return text;
}

async function testOllama(model) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Ollama connection failed (${response.status}).`);
    const payload = await response.json();
    const names = (payload.models || []).map((item) => item.name);
    const installed = names.includes(model) || names.includes(`${model}:latest`);
    if (!installed) throw new Error(`MODEL_MISSING:${model}`);
    return { model };
  } finally {
    clearTimeout(timeout);
  }
}

function friendlyError(error) {
  if (error?.message?.startsWith("MODEL_MISSING:")) {
    const model = error.message.split(":").slice(1).join(":");
    return `The ${model} model is not installed. Run: ollama pull ${model}`;
  }
  if (error?.name === "AbortError") {
    return "Ollama did not respond. Make sure the Ollama app is running.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(error?.message)) {
    return "Cannot reach Ollama. Open the Ollama app and allow Chrome extension access as described in Settings.";
  }
  if (/model.*not found|pull model/i.test(error?.message)) {
    return `The selected model is not installed. Run: ollama pull ${DEFAULT_MODEL}`;
  }
  return error?.message || "Something went wrong while creating the summary.";
}
