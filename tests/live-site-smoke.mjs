import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const moduleSource = ['content/metadata.js', 'content/normalize-html.js', 'content/readers.js', 'content/capture.js']
  .map(file => fs.readFileSync(file, 'utf8'));
const readabilitySource = ['lib/JSDOMParser.js', 'lib/Readability.js']
  .map(file => fs.readFileSync(file, 'utf8'));

const pages = [
  ['juejin', 'https://juejin.cn/post/7637856870833635343', 'juejin'],
  ['sspai', 'https://sspai.com/post/117600', 'sspai'],
  ['github', 'https://github.com/tianma-if/edgeever', 'github'],
  ['v2ex', 'https://www.v2ex.com/t/1', 'v2ex'],
  ['youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube'],
  ['bilibili', 'https://www.bilibili.com/video/BV1xx411c7mD/', 'bilibili']
];

const results = [];
for (const [name, url, expectedReader] of pages) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {'user-agent': 'Mozilla/5.0'},
      signal: AbortSignal.timeout(15000)
    });
    const html = await response.text();
    const dom = new JSDOM(html, {url: response.url, runScripts: 'outside-only'});
    const context = dom.getInternalVMContext();
    for (const source of [...moduleSource, ...readabilitySource]) vm.runInContext(source, context);
    const result = dom.window.TriliumCapturePipeline.extract({
      document: dom.window.document,
      Readability: dom.window.Readability
    });
    const unsafe = Boolean(result.body.querySelector('script')) || [...result.body.querySelectorAll('[href],[src]')]
      .some(node => /^(?:javascript|vbscript):/i.test(node.getAttribute('href') || node.getAttribute('src') || ''));
    assert.equal(result.reader, expectedReader, `${name} expected ${expectedReader}, got ${result.reader}`);
    assert.ok(result.textLength > 20, `${name} extracted too little text`);
    assert.equal(unsafe, false, `${name} output contains unsafe content`);
    results.push({name, status: response.status, reader: result.reader, textLength: result.textLength, title: result.title});
  } catch (error) {
    results.push({name, error: error instanceof Error ? error.message : String(error)});
  }
}

console.log(JSON.stringify(results, null, 2));
if (results.some(result => result.error)) process.exitCode = 1;
