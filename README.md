# Hover Summary

Circle text, images, charts, or diagrams on a webpage and get a plain-language explanation in a panel on the right.

## One-time local AI setup

This version uses Ollama on your Mac, so there are no OpenAI API charges and your captured region stays local.

1. Install [Ollama](https://ollama.com/download) and open the app.
2. In Terminal, download the recommended vision model:

   ```bash
   ollama pull qwen3-vl:4b-instruct
   ```

3. Allow Chrome extensions to connect to Ollama:

   ```bash
   launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
   ```

4. Completely quit Ollama from the menu-bar icon, then reopen it.

## Install the extension

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open the extension's **Settings** and click **Test connection**.
5. Refresh any webpage that was already open.

## Use it

- Hold **Alt** and move the pointer in a complete loop around an area. The capture starts when the loop closes.
- Or click the extension icon and choose **Select an area**, then drag a lasso.
- Or press **Alt+Shift+S**.

The current MVP works on regular webpages in Chrome. Chrome internal pages, the Chrome Web Store, and some protected viewers do not permit content scripts.

## Architecture

- `content.js` detects the circle/lasso, draws the interaction UI, and renders the summary panel.
- `background.js` captures the visible tab, crops to the selected bounds, and sends only that crop to Ollama at `127.0.0.1`.
- `options.html` checks the Ollama connection and stores the selected local model.

## Production notes

The local model is free to run but uses your computer's memory, storage, and battery. The 2B model is lighter and less accurate; the 8B model is larger and usually stronger. A browser extension can only capture browser content; capturing arbitrary desktop apps requires a companion native app with operating-system screen-recording permission.
