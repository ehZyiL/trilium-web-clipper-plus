import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { parseHTML } from 'linkedom';
import { Defuddle } from 'defuddle/node';

const root = path.resolve(import.meta.dirname, '..');
const fixtureRoot = path.join(root, 'tests', 'fixtures');
const siteFixtureRoot = path.join(fixtureRoot, 'p2-sites');
const moduleFiles = ['content/metadata.js', 'content/normalize-html.js', 'content/readers.js', 'content/capture.js'];
const moduleSource = moduleFiles.map(file => fs.readFileSync(path.join(root, file), 'utf8'));
const readabilitySource = [
  fs.readFileSync(path.join(root, 'lib/JSDOMParser.js'), 'utf8'),
  fs.readFileSync(path.join(root, 'lib/Readability.js'), 'utf8')
];

const urls = {
  'simple-article.html': 'https://example.com/article',
  'wechat.html': 'https://mp.weixin.qq.com/s/example',
  'juejin.html': 'https://juejin.cn/post/123',
  'zhihu.html': 'https://www.zhihu.com/question/1/answer/2',
  'sspai.html': 'https://sspai.com/post/123',
  'medium.html': 'https://medium.com/example/article',
  'substack.html': 'https://example.substack.com/p/example',
  'github.html': 'https://github.com/example/repo',
  'linux-do.html': 'https://linux.do/t/topic/3080716'
};

function plainText(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function tags(html) {
  return [...new Set([...String(html || '').matchAll(/<([a-z0-9]+)\b/gi)].map(match => match[1].toLowerCase()))].sort();
}

function loadPipeline(html, url) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const context = dom.getInternalVMContext();
  for (const source of [...moduleSource, ...readabilitySource]) vm.runInContext(source, context);
  const result = dom.window.TriliumCapturePipeline.extract({ document: dom.window.document, Readability: dom.window.Readability });
  const rawReadability = new dom.window.Readability(dom.window.document.cloneNode(true), { serializer: element => element }).parse();
  return {
    pipeline: { reader: result.reader, title: result.title, textLength: plainText(result.body.innerHTML).length, tags: tags(result.body.innerHTML) },
    readability: { title: rawReadability?.title || '', textLength: plainText(rawReadability?.content?.innerHTML || '').length, tags: tags(rawReadability?.content?.innerHTML || '') }
  };
}

async function loadDefuddle(html, url) {
  const { document } = parseHTML(html);
  const result = await Defuddle(document, url);
  return { title: result.title || '', textLength: plainText(result.content || '').length, tags: tags(result.content || '') };
}

const files = ['simple-article.html', ...fs.readdirSync(siteFixtureRoot).filter(file => file.endsWith('.html')).sort()];
const rows = [];
for (const file of files) {
  const sourcePath = file === 'simple-article.html' ? path.join(fixtureRoot, file) : path.join(siteFixtureRoot, file);
  const html = fs.readFileSync(sourcePath, 'utf8');
  const url = urls[file];
  assert.ok(url, `Missing comparison URL for ${file}`);
  const local = loadPipeline(html, url);
  const defuddle = await loadDefuddle(html, url);
  assert.ok(local.pipeline.textLength > 0, `${file}: pipeline returned empty content`);
  assert.ok(local.readability.textLength > 0, `${file}: Readability returned empty content`);
  assert.ok(defuddle.textLength > 0, `${file}: Defuddle returned empty content`);
  assert.doesNotMatch(JSON.stringify(local.pipeline), /javascript:/i, `${file}: unsafe URL survived pipeline`);
  rows.push({ file, url, ...local, defuddle });
}

const summary = {
  fixtures: rows.length,
  pipelineReaders: [...new Set(rows.map(row => row.pipeline.reader))].sort(),
  pipelineLongerThanReadability: rows.filter(row => row.pipeline.textLength >= row.readability.textLength).length,
  pipelineLongerThanDefuddle: rows.filter(row => row.pipeline.textLength >= row.defuddle.textLength).length,
  rows
};

if (process.argv.includes('--write')) {
  const outputPath = path.join(fixtureRoot, 'p2-extractor-comparison.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Wrote ${path.relative(root, outputPath)}`);
}

console.log(JSON.stringify(summary, null, 2));
