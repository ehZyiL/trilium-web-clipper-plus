(function (global) {
	'use strict';

	function textLength(element) {
		return element?.textContent?.replace(/\s+/g, ' ').trim().length || 0;
	}

	function fallbackCandidate(documentRef) {
		const candidates = Array.from(documentRef.querySelectorAll('article, main, [role="main"], .post, .entry-content, .article-content'));
		return candidates
			.map(element => ({element, score: textLength(element) + (element.tagName.toLowerCase() === 'article' ? 300 : 0)}))
			.sort((left, right) => right.score - left.score)[0]?.element || documentRef.body;
	}

	function genericExtract(documentRef, readabilityCtor) {
		if (typeof readabilityCtor === 'function') {
			try {
				const copy = documentRef.cloneNode(true);
				const result = new readabilityCtor(copy, {serializer: element => element}).parse();
				if (result?.content && textLength(result.content) >= 80) {
					return {reader: 'readability', title: result.title, body: result.content};
				}
			} catch (error) {
				console.warn('Readability extraction failed; using candidate fallback:', error);
			}
		}
		return {reader: 'candidate', title: documentRef.title, body: fallbackCandidate(documentRef).cloneNode(true)};
	}

	function extract(options = {}) {
		const documentRef = options.document || document;
		const readers = global.TriliumSiteReaders?.readers || [];
		let result = null;
		for (const reader of readers) {
			if (!reader.matches(documentRef)) continue;
			result = reader.extract(documentRef);
			if (result) break;
		}
		if (!result) result = genericExtract(documentRef, options.Readability || global.Readability);

		const metadata = global.TriliumPageMetadata?.getPageMetadata(documentRef) || {};
		const title = result.title || metadata.title || documentRef.title || 'Untitled';
		const body = global.TriliumHtmlNormalizer.normalize(result.body, {
			baseUrl: documentRef.location?.href || documentRef.baseURI
		});
		return {
			title,
			body,
			reader: result.reader,
			metadata,
			textLength: textLength(body)
		};
	}

	global.TriliumCapturePipeline = { extract };
})(typeof globalThis !== 'undefined' ? globalThis : window);
