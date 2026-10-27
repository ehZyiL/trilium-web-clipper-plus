(function (global) {
	'use strict';

	const allowedTags = new Set([
		'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup',
		'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure',
		'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'kbd', 'li', 'article', 'main',
		'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'small', 'span', 'strong',
		'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
		'tr', 'u', 'ul', 'var'
	]);
	const removeTags = new Set(['applet', 'audio', 'canvas', 'embed', 'form', 'iframe', 'input', 'link', 'meta', 'object', 'script', 'select', 'style', 'svg', 'textarea', 'video']);
	const allowedAttributes = new Set(['alt', 'cite', 'colspan', 'datetime', 'height', 'href', 'rowspan', 'scope', 'src', 'title', 'width']);

	function resolveUrl(value, baseUrl) {
		if (!value) return '';
		const trimmed = value.trim();
		if (/^data:image\//i.test(trimmed)) return trimmed;
		try {
			return new URL(trimmed, baseUrl || document.baseURI).href;
		} catch (error) {
			return '';
		}
	}

	function safeUrl(value, baseUrl) {
		const resolved = resolveUrl(value, baseUrl);
		if (/^data:image\//i.test(resolved)) return resolved;
		if (/^https?:\/\//i.test(resolved)) return resolved;
		return '';
	}

	function preferredImageSource(element, baseUrl) {
		const candidates = [
			element.getAttribute('data-src'),
			element.getAttribute('data-original'),
			element.getAttribute('data-lazy-src'),
			element.currentSrc,
			element.getAttribute('src')
		].filter(Boolean);
		const srcset = element.getAttribute('srcset') || element.getAttribute('data-srcset');
		if (srcset) {
			const best = srcset.split(',')
				.map(item => item.trim().split(/\s+/)[0])
				.filter(Boolean)
				.pop();
			if (best) candidates.unshift(best);
		}
		return candidates.map(item => safeUrl(item, baseUrl)).find(Boolean) || '';
	}

	function keepCodeClass(element) {
		if (!['pre', 'code'].includes(element.tagName.toLowerCase())) return '';
		const value = element.getAttribute('class') || '';
		const match = value.match(/(?:^|\s)(language-[a-z0-9_-]+|lang-[a-z0-9_-]+)(?=\s|$)/i);
		return match ? match[1] : '';
	}

	function cleanElement(element, baseUrl) {
		const tagName = element.tagName.toLowerCase();
		const imageSource = tagName === 'img' ? preferredImageSource(element, baseUrl) : '';
		if (removeTags.has(tagName)) {
			element.remove();
			return;
		}
		if (!allowedTags.has(tagName)) {
			const parent = element.parentNode;
			if (!parent) return;
			const children = Array.from(element.children);
			while (element.firstChild) parent.insertBefore(element.firstChild, element);
			element.remove();
			for (const child of children) cleanElement(child, baseUrl);
			return;
		}

		for (const attribute of Array.from(element.attributes)) {
			const name = attribute.name.toLowerCase();
			if (name.startsWith('on') || name.startsWith('data-') || name === 'style' || name === 'id' || name === 'name' || name === 'srcset') {
				element.removeAttribute(attribute.name);
				continue;
			}
			if (name === 'class') {
				const codeClass = keepCodeClass(element);
				if (codeClass) element.setAttribute('class', codeClass);
				else element.removeAttribute(attribute.name);
				continue;
			}
			if (!allowedAttributes.has(name)) {
				element.removeAttribute(attribute.name);
			}
		}

		if (tagName === 'a' && element.hasAttribute('href')) {
			const href = safeUrl(element.getAttribute('href'), baseUrl);
			if (href) element.setAttribute('href', href);
			else element.removeAttribute('href');
		}
		if (tagName === 'img') {
			if (!imageSource) {
				element.remove();
				return;
			}
			element.setAttribute('src', imageSource);
		}
		if (tagName === 'details') element.setAttribute('open', '');

		for (const child of Array.from(element.children)) cleanElement(child, baseUrl);
	}

	function normalize(root, options = {}) {
		if (!root) return null;
		const clone = root.cloneNode(true);
		const container = root.ownerDocument.createElement('div');
		container.appendChild(clone);
		for (const child of Array.from(container.children)) cleanElement(child, options.baseUrl || root.ownerDocument.baseURI);
		return container;
	}

	global.TriliumHtmlNormalizer = { normalize, preferredImageSource };
})(typeof globalThis !== 'undefined' ? globalThis : window);
