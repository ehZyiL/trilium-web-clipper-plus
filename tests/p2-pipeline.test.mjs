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

console.log(`P2 pipeline tests passed (${cases.length} site readers + sanitizer + metadata + fallback).`);
