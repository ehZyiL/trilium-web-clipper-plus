# 剪藏 Fixture 基线

这些样例用于记录剪藏重构前后的输出差异。验证分为两层：

- 快照：保存完整输出，便于比较结构变化。
- 断言：检查标题、正文、代码、表格、图片和链接等关键字段。

更新快照前必须先确认显式断言仍然通过，不能只通过修改快照来掩盖内容退化。

当前基线：

- `simple-article.html`：普通正文、代码块、列表、表格和图片。
- `selection.html`：包含可复制选区的正文页面。
- `p2-sites/`：微信、掘金、知乎、少数派、Medium、Substack、GitHub 和 Linux.do Discourse topic 的站点 reader 样例；其余参考站点由 `p2-pipeline.test.mjs` 使用 DOM 覆盖用例验证。
- `p2-extractor-comparison.json`：同一批样例使用当前管线、Readability 和 Defuddle 的对比结果；由 `npm run compare:extractors:write` 生成。
