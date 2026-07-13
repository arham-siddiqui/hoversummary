const selectButton = document.getElementById("select");
const status = document.getElementById("status");

selectButton.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "START_LASSO" })
    .then(() => window.close())
    .catch(() => {
      status.textContent = "This page blocks extensions. Try a normal webpage.";
    });
});

document.getElementById("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
