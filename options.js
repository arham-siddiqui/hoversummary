const form = document.getElementById("form");
const model = document.getElementById("model");
const saved = document.getElementById("saved");

chrome.storage.sync.get(["model"]).then((settings) => {
  const storedModel = settings.model;
  model.value = [...model.options].some((option) => option.value === storedModel)
    ? storedModel
    : "qwen3-vl:4b-instruct";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await chrome.storage.sync.set({ model: model.value });
  saved.className = "success";
  saved.textContent = "Model saved";
  setTimeout(() => { saved.textContent = ""; }, 1800);
});

document.getElementById("test").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Checking…";
  saved.className = "";
  saved.textContent = "";
  const response = await chrome.runtime.sendMessage({ type: "TEST_OLLAMA", model: model.value })
    .catch((error) => ({ ok: false, error: error.message }));
  button.disabled = false;
  button.textContent = "Test connection";
  saved.className = response?.ok ? "success" : "failure";
  saved.textContent = response?.ok ? `${response.model} is ready` : response?.error || "Could not connect to Ollama.";
});
