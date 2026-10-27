let currentTab = null;
let hasSelection = false;
let connectionReady = false;
let busy = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

async function sendMessage(message) {
    try {
        return await browser.runtime.sendMessage(message);
    }
    catch (error) {
        console.error('Calling browser runtime failed:', error);
        showStatus(t('calling_runtime_failed'), 'error');
        return null;
    }
}

function setText(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value || '';
}

function showStatus(message, type = 'info') {
    const status = $('#popup-status');
    if (!status) return;
    status.textContent = message || '';
    status.className = `status-message ${type}${message ? '' : ' hidden'}`;
}

function setBusy(value) {
    busy = value;
    $$('.needs-connection').forEach((button) => {
        button.disabled = value || !connectionReady;
    });
    $('#busy-indicator')?.classList.toggle('hidden', !value);
}

function setConnectionState(connected, label, detail = '') {
    connectionReady = connected;
    const dot = $('#connection-dot');
    dot?.classList.remove('checking');
    dot?.classList.toggle('connected', connected);
    dot?.classList.toggle('disconnected', !connected);
    setText('#connection-label', label);
    setText('#connection-detail', detail);
    $$('.needs-connection').forEach((button) => {
        button.disabled = busy || !connected;
        if (!connected) button.title = t('action_needs_connection');
        else button.removeAttribute('title');
    });
}

function updateCaptureHint() {
    const hint = $('#capture-hint');
    if (!hint) return;
    if (hasSelection) {
        hint.textContent = `${t('selection_detected')} · ${hasSelection.length || hasSelection} ${t('characters')}`;
    }
    else {
        hint.textContent = t('no_selection_full_page');
    }
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value || '';
    return div.innerHTML;
}

function createNoteLink(noteId, label) {
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = label;
    link.addEventListener('click', async (event) => {
        event.preventDefault();
        await sendMessage({name: 'openNoteInTrilium', noteId});
    });
    return link;
}

function renderVisitedState(searchNote) {
    const container = $('#already-visited');
    if (!container) return;
    container.replaceChildren();
    if (searchNote?.status !== 'found') {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');
    container.append(document.createTextNode(`${t('already_visited')} `));
    container.append(createNoteLink(searchNote.noteId, t('open_in_trilium')));
}

async function loadHistory() {
    const list = $('#history-list');
    if (!list) return;
    const stored = await browser.storage.local.get({clipHistory: []});
    const history = Array.isArray(stored.clipHistory) ? stored.clipHistory : [];
    list.replaceChildren();
    if (!history.length) {
        const empty = document.createElement('div');
        empty.className = 'history-empty';
        empty.textContent = t('no_recent_clips');
        list.append(empty);
        return;
    }
    history.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'history-item';
        const title = document.createElement('span');
        title.className = 'history-title';
        title.textContent = item.title || item.pageUrl || t('unknown');
        const open = createNoteLink(item.noteId, t('open_in_trilium'));
        row.append(title, open);
        list.append(row);
    });
}

function renderConnectionStatus(triliumSearch) {
    if (!triliumSearch) return;
    const status = triliumSearch.status;
    if (status === 'searching') {
        $('#connection-dot')?.classList.add('checking');
        setText('#connection-label', t('checking'));
        setText('#connection-detail', '');
        return;
    }
    if (status === 'found-desktop') {
        setConnectionState(true, t('connected_port', {port: triliumSearch.port}), 'Trilium Desktop');
    }
    else if (status === 'found-server') {
        setConnectionState(true, t('connected_server'), triliumSearch.url || '');
    }
    else if (status === 'version-mismatch') {
        const whatToUpgrade = triliumSearch.extensionMajor > triliumSearch.triliumMajor ? t('trilium_notes') : t('this_extension');
        setConnectionState(true, t('version_mismatch', {whatToUpgrade}), '');
    }
    else {
        setConnectionState(false, t('not_found'), t('action_needs_connection'));
    }
}

async function loadCurrentTab() {
    const tabs = await browser.tabs.query({active: true, currentWindow: true});
    currentTab = tabs[0] || null;
    setText('#page-title', currentTab?.title || t('unknown'));
    try {
        setText('#page-domain', currentTab?.url ? new URL(currentTab.url).hostname : t('unknown'));
    }
    catch {
        setText('#page-domain', t('unknown'));
    }

    if (!currentTab?.id) return;
    try {
        const info = await browser.tabs.sendMessage(currentTab.id, {name: 'get-selection-info'});
        hasSelection = info?.hasSelection ? info.length : false;
    }
    catch {
        hasSelection = false;
    }
    updateCaptureHint();
}

async function refreshConnection() {
    setText('#connection-label', t('checking'));
    $('#connection-dot')?.classList.add('checking');
    await sendMessage({name: 'trigger-trilium-search'});
}

async function performAction(message, successKey) {
    if (busy || !connectionReady) return;
    setBusy(true);
    showStatus(t('working'), 'loading');
    if (currentTab?.id !== undefined) {
        message.tabId = currentTab.id;
        message.pageUrl = currentTab.url || '';
    }
    const response = await sendMessage(message);
    setBusy(false);
    if (response?.success) {
        showStatus(t(successKey), 'success');
        setTimeout(() => window.close(), 700);
    }
    else if (response) {
        showStatus(response.error || t('failed_to_save', {error: t('unknown')}), 'error');
    }
}

function escapeNoteContent(string) {
    return `<p>${escapeHtml(string).replace(/\n/g, '</p><p>')}</p>`;
}

async function saveLinkWithNote() {
    const value = $('#save-link-with-note-textarea')?.value.trim() || '';
    let title = '';
    let content = '';
    if (value && $('#keep-title-checkbox')?.checked) {
        content = value;
    }
    else if (value) {
        const match = /^(.*?)([.?!]\s|\n)/.exec(value);
        title = match ? match[0].trim() : value;
        content = match ? value.slice(title.length).trim() : '';
    }
    const response = await sendMessage({name: 'save-link-with-note', title, content: escapeNoteContent(content)});
    if (response?.success) {
        showStatus(t('link_saved'), 'success');
        $('#save-link-with-note-wrapper')?.classList.add('hidden');
        setTimeout(() => window.close(), 700);
    }
}

browser.runtime.onMessage.addListener((request) => {
    if (request.name === 'trilium-search-status') {
        renderConnectionStatus(request.triliumSearch);
        if (connectionReady) sendMessage({name: 'trigger-trilium-search-note-url', tabId: currentTab?.id, pageUrl: currentTab?.url});
    }
    else if (request.name === 'trilium-previously-visited') {
        renderVisitedState(request.searchNote);
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    await initI18n();
    $('#show-options-button')?.addEventListener('click', () => browser.runtime.openOptionsPage());
    $('#show-help-button')?.addEventListener('click', () => window.open('https://github.com/zadam/trilium/wiki/Web-clipper', '_blank'));
    $('#check-connection-button')?.addEventListener('click', refreshConnection);
    $('#save-whole-page-button')?.addEventListener('click', () => performAction({name: hasSelection ? 'save-selection' : 'save-whole-page'}, hasSelection ? 'selection_saved' : 'page_saved'));
    $('#save-selection-button')?.addEventListener('click', () => performAction({name: 'save-selection'}, 'selection_saved'));
    $('#save-cropped-screenshot-button')?.addEventListener('click', () => performAction({name: 'save-cropped-screenshot'}, 'screenshot_saved'));
    $('#save-whole-screenshot-button')?.addEventListener('click', () => performAction({name: 'save-whole-screenshot'}, 'screenshot_saved'));
    $('#save-tabs-button')?.addEventListener('click', () => performAction({name: 'save-tabs'}, 'tabs_saved'));
    $('#save-link-with-note-button')?.addEventListener('click', () => {
        $('#save-link-with-note-wrapper')?.classList.remove('hidden');
        $('#save-link-with-note-textarea')?.focus();
    });
    $('#save-button')?.addEventListener('click', saveLinkWithNote);
    $('#cancel-button')?.addEventListener('click', () => $('#save-link-with-note-wrapper')?.classList.add('hidden'));

    await loadCurrentTab();
    await refreshConnection();
    sendMessage({name: 'send-trilium-search-status'});
    await loadHistory();
});
