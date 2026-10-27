(function (global) {
	'use strict';

	function host(documentRef) {
		return String(documentRef.location?.hostname || location.hostname || '').toLowerCase();
	}

	function first(documentRef, selectors) {
		for (const selector of selectors) {
			const element = documentRef.querySelector(selector);
			if (element && element.textContent.trim().length > 20) return element;
		}
		return null;
	}

	function cloneResult(documentRef, element, id) {
		if (!element) return null;
		const clone = element.cloneNode(true);
		for (const selector of [
			'.advertisement', '.adsbygoogle', '.recommend', '.recommend-box', '.comment-list',
			'.comments', '.share', '.share-box', '.related', '.related-posts',
			'[aria-label="评论"]', '[aria-label="相关推荐"]'
		]) {
			clone.querySelectorAll(selector).forEach(node => node.remove());
		}
		return {
			reader: id,
			title: documentRef.title,
			body: clone
		};
	}

	function selectorReader(id, hosts, selectors, condition = () => true) {
		return {
			id,
			matches(documentRef) {
				const currentHost = host(documentRef);
				return hosts.some(pattern => pattern.test(currentHost)) && condition(documentRef);
			},
			extract(documentRef) {
				return cloneResult(documentRef, first(documentRef, selectors), id);
			}
		};
	}

	function mediaReader(id, hosts, descriptionSelectors) {
		return {
			id,
			matches(documentRef) {
				return hosts.some(pattern => pattern.test(host(documentRef)));
			},
			extract(documentRef) {
				const descriptionNode = descriptionSelectors.map(selector => documentRef.querySelector(selector)).find(Boolean);
				const description = descriptionNode?.getAttribute('content') || descriptionNode?.textContent || '';
				if (description.trim().length < 20) return null;
				const body = documentRef.createElement('article');
				const heading = documentRef.createElement('h1');
				heading.textContent = documentRef.title || id;
				const paragraph = documentRef.createElement('p');
				paragraph.textContent = description.replace(/\s+/g, ' ').trim();
				body.append(heading, paragraph);
				return {reader: id, title: documentRef.title || id, body};
			}
		};
	}

	const readers = [
		{
			id: 'wechat',
			matches(documentRef) {
				return /(^|\.)mp\.weixin\.qq\.com$/i.test(host(documentRef)) || Boolean(documentRef.querySelector('#js_content'));
			},
			extract(documentRef) {
				return cloneResult(documentRef, first(documentRef, ['#js_content', '.rich_media_content']), 'wechat');
			}
		},
		{
			id: 'juejin',
			matches(documentRef) {
				return /(^|\.)juejin\.cn$/i.test(host(documentRef));
			},
			extract(documentRef) {
				return cloneResult(documentRef, first(documentRef, ['article.article-content', '.article-viewer', '.markdown-body', '[class*="article-content"]']), 'juejin');
			}
		},
		{
			id: 'zhihu',
			matches(documentRef) {
				return /(^|\.)zhihu\.com$/i.test(host(documentRef));
			},
			extract(documentRef) {
				return cloneResult(documentRef, first(documentRef, ['.RichContent-inner', '.Post-RichTextContainer', '.RichText', 'article']), 'zhihu');
			}
		},
		selectorReader('sspai', [/^(?:www\.)?sspai\.com$/i], ['article.normal-article', '.article__main', '.article__content', '.article-content', 'article']),
		selectorReader('medium', [/medium\.com$/i], ['[data-testid="storyBody"]', '.postArticle-content', 'article']),
		selectorReader('substack-note', [/(?:^|\.)substack\.com$/i], ['[data-testid="note-body"]', '.note-content', '.body.markup'], documentRef => /\/note\//i.test(documentRef.location?.pathname || '')),
		selectorReader('substack', [/(?:^|\.)substack\.com$/i], ['.body.markup', '.post-content', 'article.newsletter-post'], documentRef => !/\/note\//i.test(documentRef.location?.pathname || '')),
		selectorReader('github', [/^(?:www\.)?github\.com$/i], ['article.markdown-body', '[data-testid="readme-container"]', '.markdown-body']),
		selectorReader('douban', [/^(?:book|movie|music)\.douban\.com$/i, /^(?:www\.)?douban\.com$/i], ['#link-report', '.review-content', '.note-content', '.note']),
		selectorReader('v2ex', [/^(?:www\.)?v2ex\.com$/i], ['.topic_content', '.reply_content', '#Main']),
		selectorReader('hacker-news', [/^news\.ycombinator\.com$/i], ['.toptext', '.comment-tree']),
		selectorReader('xueqiu', [/^(?:www\.)?xueqiu\.com$/i], ['.article__content', '.article-content', '.detail-content']),
		selectorReader('boss', [/^(?:www\.)?zhipin\.com$/i], ['.job-detail', '.job-sec', '.job-description']),
		selectorReader('xiaoyuzhou', [/^www\.xiaoyuzhoufm\.com$/i], ['.episode-detail', '.show-detail', '[data-testid="episode-detail"]']),
		selectorReader('jike', [/^(?:www\.)?okjike\.com$/i, /^m\.okjike\.com$/i, /^web\.okjike\.com$/i], ['[data-testid="post-content"]', '.original-post', '[data-pressable-container]']),
		selectorReader('facebook', [/^(?:www\.)?facebook\.com$/i, /^m\.facebook\.com$/i], ['[data-ad-preview="message"]', '[data-ad-comet-preview="message"]', '[role="article"]']),
		selectorReader('instagram', [/^(?:www\.)?instagram\.com$/i], ['article', 'main']),
		selectorReader('linkedin', [/^(?:www\.)?linkedin\.com$/i], ['.feed-shared-update-v2__description', '.update-components-text', '[data-urn]']),
		selectorReader('threads', [/^(?:www\.)?threads\.(?:com|net)$/i], ['[data-pressable-container]', 'article', 'main']),
		selectorReader('bluesky', [/^bsky\.app$/i], ['[data-testid="postText"]', 'main']),
		mediaReader('youtube', [/^(?:www\.)?youtube\.com$/i, /^youtu\.be$/i], ['meta[name="description"]', '#description-inline-expander', '#description']),
		mediaReader('bilibili', [/^(?:www\.)?bilibili\.com$/i, /^m\.bilibili\.com$/i], ['meta[name="description"]', '#v_desc', '.video-desc', '.desc-info'])
	];

	global.TriliumSiteReaders = { readers };
})(typeof globalThis !== 'undefined' ? globalThis : window);
