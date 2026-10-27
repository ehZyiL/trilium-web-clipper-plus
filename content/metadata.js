(function (global) {
	'use strict';

	function text(value) {
		return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
	}

	function firstMeta(documentRef, selectors) {
		for (const selector of selectors) {
			const element = documentRef.querySelector(selector);
			const value = text(element?.getAttribute('content') || element?.getAttribute('datetime') || element?.textContent);
			if (value) return value;
		}
		return '';
	}

	function collectJsonLd(value, result) {
		if (!value) return;
		if (Array.isArray(value)) {
			value.forEach(item => collectJsonLd(item, result));
			return;
		}
		if (typeof value !== 'object') return;
		if (value['@graph']) collectJsonLd(value['@graph'], result);

		const type = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
		const normalizedTypes = type.filter(Boolean).map(item => String(item).toLowerCase());
		if (!result.author && value.author) {
			const author = Array.isArray(value.author) ? value.author[0] : value.author;
			result.author = text(typeof author === 'string' ? author : author?.name);
		}
		if (!result.publishedDate && (value.datePublished || value.uploadDate)) {
			result.publishedDate = value.datePublished || value.uploadDate;
		}
		if (!result.modifiedDate && (value.dateModified || value.dateUpdated)) {
			result.modifiedDate = value.dateModified || value.dateUpdated;
		}
		if (!result.title && (normalizedTypes.includes('article') || normalizedTypes.includes('newsarticle') || normalizedTypes.includes('blogposting'))) {
			result.title = text(value.headline || value.name);
		}
	}

	function getPageMetadata(documentRef) {
		const result = {
			title: text(documentRef.title),
			author: firstMeta(documentRef, [
				"meta[name='author']",
				"meta[property='article:author']",
				"[rel='author']"
			]),
			publishedDate: firstMeta(documentRef, [
				"meta[property='article:published_time']",
				"meta[name='datePublished']",
				"time[datetime]"
			]),
			modifiedDate: firstMeta(documentRef, [
				"meta[property='article:modified_time']",
				"meta[name='dateModified']"
			])
		};

		const jsonLdNodes = documentRef.querySelectorAll("script[type='application/ld+json']");
		for (const node of jsonLdNodes) {
			try {
				collectJsonLd(JSON.parse(node.textContent || ''), result);
			} catch (error) {
				console.debug('Ignoring invalid JSON-LD metadata:', error);
			}
		}

		result.title = firstMeta(documentRef, [
			"meta[property='og:title']",
			"meta[name='twitter:title']"
		]) || result.title;
		return result;
	}

	global.TriliumPageMetadata = { getPageMetadata };
})(typeof globalThis !== 'undefined' ? globalThis : window);
