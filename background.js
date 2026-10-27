// Import dependencies for service worker
importScripts('lib/browser-polyfill.js', 'utils.js', 'trilium_server_facade.js', 'i18n/i18n.js');

// Ensure triliumServerFacade is available globally
function getTriliumServerFacade() {
    // @ts-ignore
    return globalThis.triliumServerFacade || window?.triliumServerFacade;
}

// Initialize i18n for service worker
let i18nInitialized = false;
async function ensureI18nInitialized() {
    if (!i18nInitialized) {
        await initI18n();
        i18nInitialized = true;
    }
}

// Keyboard shortcuts
chrome.commands.onCommand.addListener(async function (command) {
    if (command == "saveSelection") {
		await enqueueClip(() => saveSelection(), null);
    } else if (command == "saveWholePage") {
		await enqueueClip(() => saveWholePage(), null);
    } else if (command == "saveCroppedScreenshot") {
        const activeTab = await getActiveTab();

        await saveCroppedScreenshot(activeTab.url);
    } else {
        console.log("Unrecognized command", command);
    }
});

async function cropImage(newArea, dataUrl) {
	// Use offscreen document for DOM operations in service worker
	try {
		await chrome.offscreen.createDocument({
			url: 'offscreen.html',
			reasons: ['DOM_SCRAPING'],
			justification: 'Image cropping operations'
		});
	} catch (error) {
		// Document may already exist
		if (!error.message.includes('Only a single offscreen')) {
			throw error;
		}
	}

	return new Promise((resolve, reject) => {
		const messageId = Math.random().toString(36);

		const messageHandler = (message) => {
			if (message.id === messageId) {
				chrome.runtime.onMessage.removeListener(messageHandler);
				if (message.error) {
					reject(new Error(message.error));
				} else {
					resolve(message.result);
				}
			}
		};

		chrome.runtime.onMessage.addListener(messageHandler);

		chrome.runtime.sendMessage({
			type: 'CROP_IMAGE',
			id: messageId,
			newArea: newArea,
			dataUrl: dataUrl
		});
	});
}

async function takeCroppedScreenshot(cropRect, tabId = null) {
	const targetTab = tabId !== null && tabId !== undefined ? await browser.tabs.get(tabId) : await getActiveTab();
	const zoom = await browser.tabs.getZoom(targetTab.id);

	// Get device pixel ratio from content script since service workers don't have access to window
	const devicePixelRatio = await browser.tabs.sendMessage(targetTab.id, {name: 'get-device-pixel-ratio'});
	const totalZoom = zoom * (devicePixelRatio || 1);

	const newArea = Object.assign({}, cropRect);
	newArea.x *= totalZoom;
	newArea.y *= totalZoom;
	newArea.width *= totalZoom;
	newArea.height *= totalZoom;

	const dataUrl = await browser.tabs.captureVisibleTab(targetTab.windowId, { format: 'png' });

	return await cropImage(newArea, dataUrl);
}

async function takeWholeScreenshot(tabId = null) {
	// this saves only visible portion of the page
	// workaround to save the whole page is to scroll & stitch
	// example in https://github.com/mrcoles/full-page-screen-capture-chrome-extension
	// see page.js and popup.js
	const targetTab = tabId !== null && tabId !== undefined ? await browser.tabs.get(tabId) : await getActiveTab();
	return await browser.tabs.captureVisibleTab(targetTab.windowId, { format: 'png' });
}

// Function to set development icon
async function setDevIcon() {
	if (isDevEnv()) {
		try {
			await browser.action.setIcon({
				path: {
					"16": "icons/logo3-dev_16x16.png",
					"48": "icons/logo3-dev_48x48.png",
					"128": "icons/logo3-dev_128x128.png"
				}
			});
			console.log("Development icon set successfully");
		} catch (error) {
			console.error("Failed to set development icon:", error);
		}
	}
}

// Create context menus with i18n support
async function createContextMenus() {
	try {
		await ensureI18nInitialized();

		// Remove all existing context menus first to prevent duplicates
		await browser.contextMenus.removeAll();

		browser.contextMenus.create({
			id: "trilium-save-selection",
			title: t("save_selection_context"),
			contexts: ["selection"]
		});

		browser.contextMenus.create({
			id: "trilium-clip-screenshot",
			title: t("clip_screenshot_context"),
			contexts: ["page"]
		});

		browser.contextMenus.create({
			id: "trilium-save-cropped-screenshot",
			title: t("crop_screenshot_context"),
			contexts: ["page"]
		});

		browser.contextMenus.create({
			id: "trilium-save-whole-screenshot",
			title: t("save_whole_screenshot_context"),
			contexts: ["page"]
		});

		browser.contextMenus.create({
			id: "trilium-save-page",
			title: t("save_page_context"),
			contexts: ["page"]
		});

		browser.contextMenus.create({
			id: "trilium-save-link",
			title: t("save_link_context"),
			contexts: ["link"]
		});

		browser.contextMenus.create({
			id: "trilium-save-image",
			title: t("save_image_context"),
			contexts: ["image"]
		});

		console.log("Context menus created successfully");
	} catch (error) {
		console.error("Error creating context menus:", error);
	}
}

browser.runtime.onInstalled.addListener(async () => {
	await setDevIcon();

	// Create context menus on installation/update
	await createContextMenus();
});

// Also create context menus when service worker starts up
browser.runtime.onStartup.addListener(async () => {
	await setDevIcon();
	await createContextMenus();
});

// Create context menus and set dev icon immediately when script loads (for development reloads)
createContextMenus();
setDevIcon();

async function getActiveTab() {
	const tabs = await browser.tabs.query({
		active: true,
		currentWindow: true
	});

	return tabs[0];
}

async function getWindowTabs() {
	const tabs = await browser.tabs.query({
		currentWindow: true
	});

	return tabs;
}

async function sendMessageToTab(tabId, message) {
	if (tabId === null || tabId === undefined) {
		throw new Error("No target tab.");
	}

	return await browser.tabs.sendMessage(tabId, message);
}

async function sendMessageToActiveTab(message) {
	const activeTab = await getActiveTab();
	return sendMessageToTab(activeTab?.id, message);
}

function toast(message, noteId = null, tabIds = null, tabId = null) {
	const targetMessage = {
		name: 'toast',
		message: message,
		noteId: noteId,
		tabIds: tabIds
	};

	const delivery = tabId !== null && tabId !== undefined
		? sendMessageToTab(tabId, targetMessage)
		: sendMessageToActiveTab(targetMessage);
	return delivery.catch(error => {
		console.warn('Could not deliver clip feedback:', error);
		return null;
	});
}

async function recordClipHistory(payload, response, clipType) {
	if (!response?.noteId) return;
	try {
		const stored = await browser.storage.local.get({clipHistory: []});
		const history = Array.isArray(stored.clipHistory) ? stored.clipHistory : [];
		history.unshift({
			noteId: response.noteId,
			title: payload?.title || '',
			pageUrl: payload?.pageUrl || '',
			clipType,
			savedAt: new Date().toISOString()
		});
		await browser.storage.local.set({clipHistory: history.slice(0, 5)});
	}
	catch (error) {
		console.warn('Could not record clip history:', error);
	}
}

function blob2base64(blob) {
	return new Promise(resolve => {
		const reader = new FileReader();
		reader.onloadend = function() {
			resolve(reader.result);
		};
		reader.readAsDataURL(blob);
	});
}

async function fetchImage(url) {
	const resp = await fetch(url);
	if (!resp.ok) {
		throw new Error(`Image request failed with ${resp.status}`);
	}

	const contentType = (resp.headers.get('content-type') || '').toLowerCase();
	if (!contentType.startsWith('image/')) {
		throw new Error(`Unexpected image content type: ${contentType || 'unknown'}`);
	}

	const blob = await resp.blob();

	return await blob2base64(blob);
}

async function postProcessImage(image) {
	const originalSrc = image.src;
	if (image.src.startsWith("data:image/")) {
		image.dataUrl = image.src;
		image.src = "inline." + image.src.substr(11, 3); // this should extract file type - png/jpg
	}
	else {
		try {
			image.dataUrl = await fetchImage(image.src);
		}
		catch (e) {
			image.failed = true;
			image.src = originalSrc;
			console.log(`Cannot fetch image from ${originalSrc}`);
		}
	}
}

async function postProcessImages(resp) {
	if (resp.images) {
		for (const image of resp.images) {
			await postProcessImage(image);
			if (image.failed && resp.content && image.imageId) {
				const escapedSrc = String(image.src)
					.replaceAll('&', '&amp;')
					.replaceAll('"', '&quot;')
					.replaceAll('<', '&lt;')
					.replaceAll('>', '&gt;');
				resp.content = resp.content.split(image.imageId).join(escapedSrc);
			}
		}
	}
}

async function saveSelection(tabId = null) {
	const payload = await (tabId !== null && tabId !== undefined
		? sendMessageToTab(tabId, {name: 'trilium-save-selection'})
		: sendMessageToActiveTab({name: 'trilium-save-selection'}));

	await postProcessImages(payload);

	const resp = await getTriliumServerFacade().callService('POST', 'clippings', payload);

	if (!resp) {
		return;
	}

	await ensureI18nInitialized();
	await recordClipHistory(payload, resp, 'selection');
	toast(t("selection_saved"), resp.noteId, null, tabId);
}

async function getImagePayloadFromSrc(src, pageUrl, tabId = null) {
	const image = {
		imageId: randomString(20),
		src: src
	};

	await postProcessImage(image);

	const activeTab = tabId !== null && tabId !== undefined ? await browser.tabs.get(tabId) : await getActiveTab();

	return {
		title: activeTab.title,
		content: `<img src="${image.imageId}">`,
		images: [image],
		pageUrl: pageUrl
	};
}

async function saveCroppedScreenshot(pageUrl, tabId = null) {
	const cropRect = await (tabId !== null && tabId !== undefined
		? sendMessageToTab(tabId, {name: 'trilium-get-rectangle-for-screenshot'})
		: sendMessageToActiveTab({name: 'trilium-get-rectangle-for-screenshot'}));

	const src = await takeCroppedScreenshot(cropRect, tabId);

	const payload = await getImagePayloadFromSrc(src, pageUrl, tabId);

	const resp = await getTriliumServerFacade().callService("POST", "clippings", payload);

	if (!resp) {
		return;
	}

	await ensureI18nInitialized();
	await recordClipHistory(payload, resp, 'screenshot');
	toast(t("screenshot_saved"), resp.noteId, null, tabId);
}

async function saveWholeScreenshot(pageUrl, tabId = null) {
	const src = await takeWholeScreenshot(tabId);

	const payload = await getImagePayloadFromSrc(src, pageUrl, tabId);

	const resp = await getTriliumServerFacade().callService("POST", "clippings", payload);

	if (!resp) {
		return;
	}

	await ensureI18nInitialized();
	await recordClipHistory(payload, resp, 'screenshot');
	toast(t("screenshot_saved"), resp.noteId, null, tabId);
}

async function saveImage(srcUrl, pageUrl) {
	const payload = await getImagePayloadFromSrc(srcUrl, pageUrl);

	const resp = await getTriliumServerFacade().callService("POST", "clippings", payload);

	if (!resp) {
		return;
	}

	await ensureI18nInitialized();
	toast(t("image_saved"), resp.noteId);
}

async function saveWholePage(tabId = null) {
	let targetTabId = tabId;
	try {
		const targetTab = tabId !== null && tabId !== undefined ? await browser.tabs.get(tabId) : await getActiveTab();
		targetTabId = targetTab?.id;
		console.log("Starting saveWholePage...");

		const payload = await sendMessageToTab(targetTabId, {name: 'trilium-save-page'});
		console.log("Received payload from content script:", payload);

		await postProcessImages(payload);
		console.log("Images post-processed");

		const resp = await getTriliumServerFacade().callService('POST', 'notes', payload);
		console.log("Response from Trilium:", resp);

		if (!resp) {
			console.log("No response from Trilium server");
			return;
		}

		await ensureI18nInitialized();
		await recordClipHistory(payload, resp, 'page');
		toast(t("page_saved"), resp.noteId, null, targetTabId);
		console.log("Page save completed successfully");
	} catch (error) {
		console.error("Error in saveWholePage:", error);
		await ensureI18nInitialized();
		toast(t("failed_to_save", {error: error.message}), null, null, targetTabId).catch(() => {});
	}
}

let clipQueue = Promise.resolve();
const queuedClipKeys = new Set();
const completedClipKeys = new Map();

function enqueueClip(task, key = null) {
	const now = Date.now();
	if (key && completedClipKeys.has(key) && now - completedClipKeys.get(key) < 30000) {
		return Promise.resolve({skipped: true, reason: "duplicate"});
	}
	if (key && queuedClipKeys.has(key)) {
		return Promise.resolve({skipped: true, reason: "duplicate"});
	}

	if (key) queuedClipKeys.add(key);
	const run = clipQueue.then(() => task());
	clipQueue = run.catch(() => {});

	return run.finally(() => {
		if (key) queuedClipKeys.delete(key);
		if (key) completedClipKeys.set(key, Date.now());
	});
}

async function saveLinkWithNote(title, content) {
	const activeTab = await getActiveTab();

	if (!title.trim()) {
		title = activeTab.title;
	}

	// Check if user wants to include URL in note content
	const {includeUrlInNote} = await browser.storage.sync.get("includeUrlInNote");

	if (includeUrlInNote && content.trim()) {
		// Add URL at the beginning of content if the setting is enabled
		const urlLine = `<p><a href="${activeTab.url}">${activeTab.url}</a></p>`;
		content = urlLine + content;
	}

	const payload = {
		title: title,
		content: content,
		clipType: 'note',
		pageUrl: activeTab.url
	};
	const resp = await getTriliumServerFacade().callService('POST', 'notes', payload);

	if (!resp) {
		return false;
	}

	await ensureI18nInitialized();
	await recordClipHistory(payload, resp, 'note');
	toast(t("link_saved"), resp.noteId);

	return true;
}

async function getTabsPayload(tabs) {
	let content = '<ul>';
	tabs.forEach(tab => {
		content += `<li><a href="${tab.url}">${tab.title}</a></li>`
	});
	content += '</ul>';

	const domainsCount = tabs.map(tab => tab.url)
		.reduce((acc, url) => {
			const hostname = new URL(url).hostname
			return acc.set(hostname, (acc.get(hostname) || 0) + 1)
		}, new Map());

	let topDomains = [...domainsCount]
		.sort((a, b) => {return b[1]-a[1]})
		.slice(0,3)
		.map(domain=>domain[0])
		.join(', ')

	if (tabs.length > 3) { topDomains += '...' }

	return {
		title: `${tabs.length} browser tabs: ${topDomains}`,
		content: content,
		clipType: 'tabs'
	};
}

async function saveTabs() {
	const tabs = await getWindowTabs();

	const payload = await getTabsPayload(tabs);

	const resp = await getTriliumServerFacade().callService('POST', 'notes', payload);

	if (!resp) {
		return;
	}

	const tabIds = tabs.map(tab=>{return tab.id});

	await ensureI18nInitialized();
	await recordClipHistory(payload, resp, 'tabs');
	toast(t("tabs_saved"), resp.noteId, tabIds);
}

browser.contextMenus.onClicked.addListener(async function(info, tab) {
	try {
		// Get current tab info as fallback for missing properties
		const activeTab = await getActiveTab();
		const pageUrl = info.pageUrl || activeTab?.url || '';

		if (info.menuItemId === 'trilium-save-selection') {
			await saveSelection();
		}
		else if (info.menuItemId === 'trilium-clip-screenshot') {
			await saveWholeScreenshot(pageUrl);
		}
		else if (info.menuItemId === 'trilium-save-cropped-screenshot') {
			await saveCroppedScreenshot(pageUrl);
		}
		else if (info.menuItemId === 'trilium-save-whole-screenshot') {
			await saveWholeScreenshot(pageUrl);
		}
		else if (info.menuItemId === 'trilium-save-image') {
			const srcUrl = info.srcUrl || '';
			if (!srcUrl) {
				console.error("No image source URL available");
				return;
			}
			await saveImage(srcUrl, pageUrl);
		}
		else if (info.menuItemId === 'trilium-save-link') {
			const linkUrl = info.linkUrl || '';
			if (!linkUrl) {
				console.error("No link URL available");
				return;
			}

			// Create HTML string directly instead of using DOM APIs
			const linkText = info.linkText || linkUrl;
			const linkHtml = `<a href="${linkUrl}">${linkText}</a>`;

			const resp = await getTriliumServerFacade().callService('POST', 'clippings', {
				title: activeTab?.title || 'Saved Link',
				content: linkHtml,
				pageUrl: pageUrl
			});

			if (!resp) {
				return;
			}

			await ensureI18nInitialized();
			toast(t("link_saved"), resp.noteId);
		}
		else if (info.menuItemId === 'trilium-save-page') {
			await enqueueClip(
				() => saveWholePage(tab?.id ?? activeTab?.id),
				(tab?.id ?? activeTab?.id) !== undefined ? `context-page:${tab?.id ?? activeTab.id}:${pageUrl}` : null
			);
		}
		else {
			console.log("Unrecognized menuItemId", info.menuItemId);
		}
	} catch (error) {
		console.error("Error in context menu handler:", error);
		await ensureI18nInitialized();
		toast(t("failed_to_save", {error: error.message}) || "Failed to save: " + error.message);
	}
});

// Remove any existing listeners first
if (browser.runtime.onMessage.hasListeners()) {
	browser.runtime.onMessage.removeListener();
}

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
	console.log("=== BACKGROUND MESSAGE HANDLER ===");
	console.log("Received message:", request);
	console.log("Message name:", request.name);
	console.log("Message type:", typeof request.name);

	// Handle load-script command first and separately
	if (request.name === 'load-script') {
		console.log("=== LOAD-SCRIPT HANDLER TRIGGERED ===");
		console.log("File to load:", request.file);

		(async () => {
			try {
				const targetTab = sender?.tab || await getActiveTab();
				console.log("Target tab ID:", targetTab?.id);

				const result = await browser.scripting.executeScript({
					target: { tabId: targetTab.id },
					files: [request.file]
				});
				console.log("Script executed successfully:", request.file);
				sendResponse({success: true, result: result});
			} catch (error) {
				console.error("Failed to execute script:", error);
				sendResponse({success: false, error: error.message});
			}
		})();

		return true; // Keep message channel open for async response
	}

	// Handle other async operations
	(async () => {
		try {
			if (request.name === 'openNoteInTrilium') {
				const resp = await getTriliumServerFacade().callService('POST', 'open/' + request.noteId);

				if (!resp) {
					sendResponse({success: false});
					return;
				}

				// desktop app is not available so we need to open in browser
				if (resp.result === 'open-in-browser') {
					const {triliumServerUrl} = await browser.storage.sync.get("triliumServerUrl");

					if (triliumServerUrl) {
						const noteUrl = triliumServerUrl + '/#' + request.noteId;

						console.log("Opening new tab in browser", noteUrl);

						browser.tabs.create({
							url: noteUrl
						});
					}
					else {
						console.error("triliumServerUrl not found in local storage.");
					}
				}
				sendResponse({success: true});
			}
			else if (request.name === 'closeTabs') {
				const result = await browser.tabs.remove(request.tabIds);
				sendResponse({success: true, result: result});
			}
			else if (request.name === 'save-cropped-screenshot') {
				const activeTab = await getActiveTab();
				const targetTabId = request.tabId ?? activeTab?.id;
				const result = await enqueueClip(
					() => saveCroppedScreenshot(request.pageUrl || activeTab?.url, targetTabId),
					targetTabId !== undefined ? `cropped-screenshot:${targetTabId}:${request.pageUrl || activeTab?.url || ''}` : null
				);
				sendResponse({success: true, result: result});
			}
			else if (request.name === 'save-selection') {
				const result = await enqueueClip(
					() => saveSelection(request.tabId ?? sender?.tab?.id),
					(request.tabId ?? sender?.tab?.id) !== undefined ? `selection:${request.tabId ?? sender.tab.id}:${request.pageUrl || sender?.tab?.url || ''}` : null
				);
				sendResponse(result?.skipped
					? {success: false, error: t('duplicate_clip_error')}
					: {success: true, result: result});
			}
			else if (request.name === 'save-whole-screenshot') {
				const activeTab = await getActiveTab();
				const targetTabId = request.tabId ?? activeTab?.id;
				const result = await enqueueClip(
					() => saveWholeScreenshot(request.pageUrl || activeTab?.url, targetTabId),
					targetTabId !== undefined ? `whole-screenshot:${targetTabId}:${request.pageUrl || activeTab?.url || ''}` : null
				);
				sendResponse({success: true, result: result});
			}
			else if (request.name === 'save-whole-page') {
				const result = await enqueueClip(
					() => saveWholePage(request.tabId ?? sender?.tab?.id),
					(request.tabId ?? sender?.tab?.id) !== undefined ? `manual-page:${request.tabId ?? sender.tab.id}:${request.pageUrl || sender?.tab?.url || ''}` : null
				);
				sendResponse(result?.skipped
					? {success: false, error: t('duplicate_clip_error')}
					: {success: true, result: result});
			}
			else if (request.name === 'save-link-with-note') {
				const result = await saveLinkWithNote(request.title, request.content);
				sendResponse({success: true, result: result});
			}
			else if (request.name === 'save-tabs') {
				const result = await saveTabs();
				sendResponse({success: true, result: result});
			}
			else if (request.name === 'trigger-trilium-search') {
				getTriliumServerFacade().triggerSearchForTrilium();
				sendResponse({success: true});
			}
			else if (request.name === 'send-trilium-search-status') {
				getTriliumServerFacade().sendTriliumSearchStatusToPopup();
				sendResponse({success: true});
			}
			else if (request.name === 'trigger-trilium-search-note-url') {
				const targetTab = request.tabId !== undefined
					? await browser.tabs.get(request.tabId)
					: await getActiveTab();
				getTriliumServerFacade().triggerSearchNoteByUrl(request.pageUrl || targetTab?.url || '');
				sendResponse({success: true});
			}
			else {
				console.log("=== UNKNOWN COMMAND ===");
				console.log("Request name:", request.name);
				console.log("Request name type:", typeof request.name);
				console.log("Full request:", JSON.stringify(request));
				sendResponse({success: false, error: 'Unknown command: ' + request.name});
			}
		} catch (error) {
			console.error("Error in message handler:", error);
			sendResponse({success: false, error: error.message});
		}
	})();

	return true; // Keep message channel open for async response
});

// auto clip page
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    chrome.storage.sync.get({ autoClipPatterns: '' }, async (items) => {
      const patterns = items.autoClipPatterns
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);
      
      if (patterns.length === 0) return;
      
      for (let p of patterns) {
        let regex;
        try {
          regex = new RegExp('^' + p.replace(/\*/g, '.*') + '$');
        }
        catch (error) {
          console.warn('Skipping invalid auto-clip pattern:', p, error);
          continue;
        }

        if (regex.test(tab.url)) {
          await enqueueClip(
            () => saveWholePage(tabId),
            `auto-page:${tabId}:${tab.url}`
          );
          break;
        }
      }
    });
  }
});

