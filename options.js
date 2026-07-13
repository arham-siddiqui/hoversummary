const form = document.getElementById("form");
const apiKey = document.getElementById("apiKey");
const model = document.getElementById("model");
const saved = document.getElementById("saved");

Promise.all([
  chrome.storage.local.get(["apiKey"]),
  chrome.storage.sync.get(["model"])
]).then(([localSettings, syncedSettings]) => {
  apiKey.value = localSettings.apiKey || "";
  model.value = syncedSettings.model || "gpt-5.6-luna";
});

document.getElementById("reveal").addEventListener("click", (event) => {
  const showing = apiKey.type === "text";
  apiKey.type = showing ? "password" : "text";
  event.currentTarget.textContent = showing ? "Show" : "Hide";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await Promise.all([
    chrome.storage.local.set({ apiKey: apiKey.value.trim() }),
    chrome.storage.sync.set({ model: model.value })
  ]);
  saved.textContent = "Saved";
  setTimeout(() => { saved.textContent = ""; }, 1800);
});
