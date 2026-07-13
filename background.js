const DEFAULT_MODEL = "gpt-5.6-luna";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(["model"], ({ model }) => {
    if (!model) chrome.storage.sync.set({ model: DEFAULT_MODEL });
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
  const summary = await askOpenAI(croppedImage);
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

async function askOpenAI(imageDataUrl) {
  const [{ apiKey }, { model = DEFAULT_MODEL }] = await Promise.all([
    chrome.storage.local.get(["apiKey"]),
    chrome.storage.sync.get(["model"])
  ]);
  if (!apiKey) throw new Error("API_KEY_MISSING");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: 500,
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Explain the selected screenshot in simple, everyday language. Capture the main idea, define any difficult terms, and preserve important numbers or caveats. If it is primarily an image, diagram, or chart, explain what it shows. Be concise: use a short overview followed by at most 3 useful bullet points. Do not mention that you are looking at a screenshot."
          },
          { type: "input_image", image_url: imageDataUrl, detail: "high" }
        ]
      }]
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI request failed (${response.status}).`;
    throw new Error(message);
  }

  const text = payload.output
    ?.filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("\n")
    .trim();

  if (!text) throw new Error("The model returned an empty summary.");
  return text;
}

function friendlyError(error) {
  if (error?.message === "API_KEY_MISSING") {
    return "Add your OpenAI API key in Hover Summary settings first.";
  }
  if (/quota|billing|credits/i.test(error?.message)) {
    return "The OpenAI account has no available API credits. Check billing, then try again.";
  }
  if (/401|api key|authentication/i.test(error?.message)) {
    return "The saved OpenAI API key was rejected. Check it in settings.";
  }
  return error?.message || "Something went wrong while creating the summary.";
}
