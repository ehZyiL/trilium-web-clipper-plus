import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const root = path.resolve(import.meta.dirname, '..');
const moduleFiles = [
  'content/metadata.js',
  'content/normalize-html.js',
  'content/readers.js',
  'content/capture.js'
];
const moduleSource = moduleFiles.map(file => fs.readFileSync(path.join(root, file), 'utf8'));

function loadPage(file, url) {
  const html = fs.readFileSync(path.join(root, 'tests/fixtures/p2-sites', file), 'utf8');
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const context = dom.getInternalVMContext();
  for (const source of moduleSource) vm.runInContext(source, context);
  return dom;
}

function extract(dom, Readability = null) {
  return dom.window.TriliumCapturePipeline.extract({ document: dom.window.document, Readability });
}

const cases = [
  ['wechat.html', 'https://mp.weixin.qq.com/s/example', 'wechat'],
  ['juejin.html', 'https://juejin.cn/post/123', 'juejin'],
  ['zhihu.html', 'https://www.zhihu.com/question/1/answer/2', 'zhihu'],
  ['sspai.html', 'https://sspai.com/post/123', 'sspai'],
  ['medium.html', 'https://medium.com/example/article', 'medium'],
  ['substack.html', 'https://example.substack.com/p/example', 'substack'],
  ['github.html', 'https://github.com/example/repo', 'github']
];

for (const [file, url, reader] of cases) {
  const result = extract(loadPage(file, url));
  assert.equal(result.reader, reader, `${file} should use ${reader} reader`);
  assert.ok(result.body.textContent.length > 20, `${file} should keep article text`);
}

const coverageCases = [
  ['hacker-news', 'https://news.ycombinator.com/item?id=1', '<div class="toptext">Hacker News post body with enough text for coverage.</div>'],
  ['v2ex', 'https://www.v2ex.com/t/1', '<div class="topic_content">V2EX topic body with enough text for coverage.</div>'],
  ['xiaoyuzhou', 'https://www.xiaoyuzhoufm.com/episode/000000000000000000000000', '<div class="episode-detail">Xiaoyuzhou episode body with enough text for coverage.</div>'],
  ['boss', 'https://www.zhipin.com/job_detail/example.html', '<div class="job-detail">BOSS job detail body with enough text for coverage.</div>'],
  ['xueqiu', 'https://xueqiu.com/1/2', '<div class="article-content">Xueqiu article body with enough text for coverage.</div>'],
  ['jike', 'https://web.okjike.com/originalPost/000000000000000000000000', '<div data-testid="post-content">Jike post body with enough text for coverage.</div>'],
  ['douban', 'https://book.douban.com/review/1/', '<div class="review-content">Douban review body with enough text for coverage.</div>'],
  ['facebook', 'https://www.facebook.com/example/posts/1', '<div data-ad-preview="message">Facebook post body with enough text for coverage.</div>'],
  ['instagram', 'https://www.instagram.com/p/example/', '<article>Instagram post body with enough text for coverage.</article>'],
  ['linkedin', 'https://www.linkedin.com/feed/update/urn:li:activity:1/', '<div class="feed-shared-update-v2__description">LinkedIn post body with enough text for coverage.</div>'],
  ['threads', 'https://www.threads.com/@example/post/1', '<div data-pressable-container>Threads post body with enough text for coverage.</div>'],
  ['bluesky', 'https://bsky.app/profile/example/post/abcdefghijklm', '<div data-testid="postText">Bluesky post body with enough text for coverage.</div>'],
  ['substack-note', 'https://substack.com/@example/note/c-1', '<div data-testid="note-body">Substack note body with enough text for coverage.</div>'],
  ['youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', '<meta name="description" content="YouTube video description with enough text for coverage."><div></div>'],
  ['bilibili', 'https://www.bilibili.com/video/BV1xx411c7mD/', '<meta name="description" content="Bilibili video description with enough text for coverage."><div></div>']
];
for (const [reader, url, body] of coverageCases) {
  const dom = new JSDOM(`<!doctype html><html><head><title>${reader}</title></head><body>${body}</body></html>`, { url, runScripts: 'outside-only' });
  for (const source of moduleSource) vm.runInContext(source, dom.getInternalVMContext());
  const result = extract(dom);
  assert.equal(result.reader, reader, `${reader} reader should be covered`);
}

const wechat = extract(loadPage('wechat.html', 'https://mp.weixin.qq.com/s/example'));
assert.match(wechat.body.innerHTML, /https:\/\/mp\.weixin\.qq\.com\/images\/wechat\.png/);
assert.doesNotMatch(wechat.body.innerHTML, /<script|alert\(/i);

const juejin = extract(loadPage('juejin.html', 'https://juejin.cn/post/123'));
assert.doesNotMatch(juejin.body.innerHTML, /javascript:/i);
assert.match(juejin.body.innerHTML, /language-javascript/);

const metadataDom = new JSDOM(`<!doctype html><html><head><title>Fallback</title><script type="application/ld+json">${JSON.stringify({ '@type': 'Article', headline: 'JSON-LD title', author: { name: 'Author Example' }, datePublished: '2026-02-03' })}</script></head><body><main><p>${'fallback article '.repeat(20)}</p></main></body></html>`, { url: 'https://example.com/article', runScripts: 'outside-only' });
for (const source of moduleSource) vm.runInContext(source, metadataDom.getInternalVMContext());
const metadata = metadataDom.window.TriliumPageMetadata.getPageMetadata(metadataDom.window.document);
assert.equal(metadata.title, 'Fallback');
assert.equal(metadata.author, 'Author Example');
assert.equal(metadata.publishedDate, '2026-02-03');
const fallback = extract(metadataDom, class FakeReadability {
  constructor(documentRef) { this.documentRef = documentRef; }
  parse() { return { title: 'Readability fallback', content: this.documentRef.querySelector('main') }; }
});
assert.equal(fallback.reader, 'readability');
assert.match(fallback.title, /Readability fallback/);
assert.equal(fallback.quality, 'good');

const shortDom = new JSDOM('<!doctype html><html><head><title>Short</title></head><body><p>tiny</p></body></html>', { url: 'https://example.com/short', runScripts: 'outside-only' });
for (const source of moduleSource) vm.runInContext(source, shortDom.getInternalVMContext());
const shortResult = extract(shortDom);
assert.equal(shortResult.quality, 'low');
assert.equal(shortResult.warning, 'short-content');

console.log(`P2 pipeline tests passed (${cases.length} fixture readers + ${coverageCases.length} reference-site coverage readers + sanitizer + metadata + fallback).`);
