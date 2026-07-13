(() => {
  if (window.__hoverSummaryLoaded) return;
  window.__hoverSummaryLoaded = true;

  const state = {
    mode: "idle",
    points: [],
    pathLength: 0,
    lastPoint: null,
    overlay: null,
    svgPath: null,
    panel: null,
    hoverSuppressed: false,
    pendingBounds: null
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "START_LASSO") startLasso();
    if (message.type === "CAPTURE_PREVIEW" && state.mode === "processing") {
      openPanel(state.pendingBounds);
      renderPreview(message.croppedImage);
    }
  });

  document.addEventListener("mousemove", handleHoverCircle, true);
  document.addEventListener("keyup", (event) => {
    if (event.key === "Alt" && state.mode === "hover") resetDrawing();
  }, true);
  window.addEventListener("blur", () => {
    if (state.mode === "hover") resetDrawing();
  });

  function handleHoverCircle(event) {
    if (state.mode === "lasso" || state.mode === "processing") return;
    if (!event.altKey) {
      state.hoverSuppressed = false;
      if (state.mode === "hover") resetDrawing();
      return;
    }
    if (state.hoverSuppressed) return;

    if (state.mode === "idle") {
      state.mode = "hover";
      beginDrawing(event.clientX, event.clientY, false);
      toast("Keep holding Alt and circle the area");
      return;
    }

    addPoint(event.clientX, event.clientY);
    if (isClosedLoop()) finishSelection();
  }

  function startLasso() {
    resetDrawing();
    state.mode = "lasso";
    createOverlay(true);
    toast("Drag a loop around what you want explained");
    state.overlay.addEventListener("pointerdown", onPointerDown);
    state.overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") resetDrawing();
    });
    state.overlay.tabIndex = 0;
    state.overlay.focus();
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    beginDrawing(event.clientX, event.clientY, true);
    state.overlay.setPointerCapture(event.pointerId);
    const move = (moveEvent) => addPoint(moveEvent.clientX, moveEvent.clientY);
    const up = () => {
      state.overlay.removeEventListener("pointermove", move);
      if (selectionBounds()?.width >= 40 && selectionBounds()?.height >= 40) finishSelection();
      else {
        toast("Make the selection a little larger");
        resetDrawing();
      }
    };
    state.overlay.addEventListener("pointermove", move);
    state.overlay.addEventListener("pointerup", up, { once: true });
  }

  function beginDrawing(x, y, existingOverlay) {
    state.points = [];
    state.pathLength = 0;
    state.lastPoint = null;
    if (!existingOverlay) createOverlay(false);
    addPoint(x, y);
  }

  function createOverlay(dimPage) {
    state.overlay?.remove();
    const overlay = document.createElement("div");
    overlay.id = "hs-capture-overlay";
    if (dimPage) overlay.classList.add("hs-dimmed");
    overlay.innerHTML = `
      <svg aria-hidden="true" viewBox="0 0 ${window.innerWidth} ${window.innerHeight}" preserveAspectRatio="none">
        <path class="hs-lasso-glow"></path>
        <path class="hs-lasso-line"></path>
      </svg>
      <div class="hs-capture-hint">${dimPage ? "Draw around an area · Esc to cancel" : "Alt + circle · release Alt to cancel"}</div>`;
    document.documentElement.appendChild(overlay);
    state.overlay = overlay;
    state.svgPath = overlay.querySelector(".hs-lasso-line");
  }

  function addPoint(x, y) {
    const point = { x, y };
    if (state.lastPoint) {
      const distance = Math.hypot(x - state.lastPoint.x, y - state.lastPoint.y);
      if (distance < 3) return;
      state.pathLength += distance;
    }
    state.points.push(point);
    state.lastPoint = point;
    const path = state.points.map((p, index) => `${index ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
    state.overlay.querySelectorAll("path").forEach((item) => item.setAttribute("d", path));
  }

  function isClosedLoop() {
    if (state.points.length < 24 || state.pathLength < 260) return false;
    const first = state.points[0];
    const last = state.points[state.points.length - 1];
    const bounds = selectionBounds();
    const closureThreshold = Math.max(28, Math.min(bounds.width, bounds.height) * 0.28);
    return bounds.width >= 70 && bounds.height >= 50 &&
      Math.hypot(last.x - first.x, last.y - first.y) < closureThreshold;
  }

  function selectionBounds() {
    if (!state.points.length) return null;
    const xs = state.points.map((point) => point.x);
    const ys = state.points.map((point) => point.y);
    const padding = 8;
    const x = Math.max(0, Math.min(...xs) - padding);
    const y = Math.max(0, Math.min(...ys) - padding);
    const right = Math.min(window.innerWidth, Math.max(...xs) + padding);
    const bottom = Math.min(window.innerHeight, Math.max(...ys) + padding);
    return { x, y, width: right - x, height: bottom - y };
  }

  async function finishSelection() {
    const bounds = selectionBounds();
    if (!bounds || state.mode === "processing") return;
    state.mode = "processing";
    state.hoverSuppressed = true;
    state.pendingBounds = bounds;
    state.overlay?.remove();
    state.overlay = null;
    toast("Captured — making this simpler…");

    const response = await chrome.runtime.sendMessage({
      type: "CAPTURE_REGION",
      rect: {
        ...bounds,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      }
    }).catch((error) => ({ ok: false, error: error.message }));

    if (!state.panel?.isConnected) {
      openPanel(bounds);
      if (response?.croppedImage) renderPreview(response.croppedImage);
    }
    if (response?.ok) renderSummary(response.summary, response.croppedImage);
    else renderError(response?.error || "Could not summarize this area.");
    state.mode = "idle";
    state.points = [];
  }

  function resetDrawing() {
    state.overlay?.remove();
    state.overlay = null;
    state.svgPath = null;
    state.points = [];
    state.lastPoint = null;
    state.pathLength = 0;
    if (state.mode !== "processing") state.mode = "idle";
  }

  function openPanel(bounds) {
    state.panel?.remove();
    const panel = document.createElement("aside");
    panel.id = "hs-summary-panel";
    panel.setAttribute("aria-live", "polite");
    panel.innerHTML = `
      <div class="hs-panel-header">
        <div class="hs-brand"><span class="hs-brand-mark">H</span><span>Hover Summary</span></div>
        <button class="hs-close" aria-label="Close summary">×</button>
      </div>
      <div class="hs-panel-body">
        <div class="hs-selection-preview" style="aspect-ratio:${Math.max(1, bounds.width)}/${Math.max(1, bounds.height)}">
          <div class="hs-preview-placeholder"></div>
        </div>
        <div class="hs-status"><span class="hs-spinner"></span> Making this simpler…</div>
        <div class="hs-skeleton"><i></i><i></i><i></i><i></i></div>
      </div>`;
    document.documentElement.appendChild(panel);
    panel.querySelector(".hs-close").addEventListener("click", () => panel.remove());
    state.panel = panel;
  }

  function renderSummary(summary, image) {
    if (!state.panel?.isConnected) return;
    renderPreview(image);

    const body = state.panel.querySelector(".hs-panel-body");
    body.querySelector(".hs-status")?.remove();
    body.querySelector(".hs-skeleton")?.remove();
    const result = document.createElement("div");
    result.className = "hs-result";
    appendSafeSummary(result, summary);
    body.appendChild(result);
  }

  function renderPreview(image) {
    if (!state.panel?.isConnected || !image) return;
    const preview = state.panel.querySelector(".hs-selection-preview");
    preview.innerHTML = "";
    const img = document.createElement("img");
    img.src = image;
    img.alt = "Selected area";
    preview.appendChild(img);
  }

  function appendSafeSummary(container, text) {
    const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    let list = null;
    for (const line of lines) {
      const bullet = line.match(/^[-*•]\s+(.*)/);
      if (bullet) {
        if (!list) {
          list = document.createElement("ul");
          container.appendChild(list);
        }
        const item = document.createElement("li");
        item.textContent = bullet[1].replace(/\*\*/g, "");
        list.appendChild(item);
      } else {
        list = null;
        const paragraph = document.createElement("p");
        paragraph.textContent = line.replace(/^#{1,3}\s*/, "").replace(/\*\*/g, "");
        container.appendChild(paragraph);
      }
    }
  }

  function renderError(message) {
    if (!state.panel?.isConnected) return;
    const body = state.panel.querySelector(".hs-panel-body");
    body.querySelector(".hs-status")?.remove();
    body.querySelector(".hs-skeleton")?.remove();
    const error = document.createElement("div");
    error.className = "hs-error";
    const title = document.createElement("strong");
    title.textContent = "That didn’t work";
    const detail = document.createElement("p");
    detail.textContent = message;
    error.append(title, detail);
    if (/settings|key/i.test(message)) {
      const button = document.createElement("button");
      button.textContent = "Open settings";
      button.addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" }));
      error.appendChild(button);
    }
    body.appendChild(error);
  }

  function toast(message) {
    document.getElementById("hs-toast")?.remove();
    const element = document.createElement("div");
    element.id = "hs-toast";
    element.textContent = message;
    document.documentElement.appendChild(element);
    setTimeout(() => element.remove(), 2200);
  }
})();
