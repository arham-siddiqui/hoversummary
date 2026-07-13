# Hover Summary

Circle text, images, charts, or diagrams on a webpage and get a plain-language explanation in a panel on the right.

## Install the MVP

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open the extension's **Settings**, paste an OpenAI API key, and save.
5. Refresh any webpage that was already open.

## Use it

- Hold **Alt** and move the pointer in a complete loop around an area. The capture starts when the loop closes.
- Or click the extension icon and choose **Select an area**, then drag a lasso.
- Or press **Alt+Shift+S**.

The current MVP works on regular webpages in Chrome. Chrome internal pages, the Chrome Web Store, and some protected viewers do not permit content scripts.

## Architecture

- `content.js` detects the circle/lasso, draws the interaction UI, and renders the summary panel.
- `background.js` captures the visible tab, crops to the selected bounds, and sends only that crop to the OpenAI Responses API.
- `options.html` stores the API key in local extension storage and syncs only the model preference.

## Production notes

Do not ship a public extension that asks users to embed a shared developer API key. Put the OpenAI request behind an authenticated backend, keep the server key there, add per-user limits, and publish clear privacy/data-retention terms. A browser extension can only capture browser content; capturing arbitrary desktop apps requires a companion native app with operating-system screen-recording permission.
