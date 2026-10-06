# bake

bake 是一个写技术博客的工具。输入是一个装着 Markdown 文章的目录，输出是静态网站；写作时在排好版的页面上直接编辑，修改自动写回 Markdown 文件。

```bash
bake new matrix-calculus/jacobian   # 新建 content/matrix-calculus/jacobian.md
bake dev                            # 启动开发服务器，页面右下角的「编辑」按钮打开编辑器
bake build                          # 生成静态网站到 dist/
```

设计文档从 `docs/design/index.html` 开始读。
