# bake

bake 是一个面向技术博客的静态网站生成器，自带所见即所得的编辑器。

- 文章用 Markdown 书写。公式、折叠、提示框、旁注、站内引用等内容都有对应的 Markdown 写法。
- `bake dev` 打开的页面可以直接编辑。编辑器里看到的排版与发布后的页面相同，修改保存回 Markdown 文件。
- 交互图写成 custom element 组件，编辑器根据组件声明的属性生成属性面板。
- `bake build` 输出静态网站。公式在构建时渲染成 SVG，站内链接在构建时检查，悬停站内链接时显示目标内容的预览。

```bash
bake new matrix-calculus/jacobian   # 新建 content/matrix-calculus/jacobian.md
bake dev                            # 启动开发服务器，在页面上编辑文章
bake build                          # 生成静态网站到 dist/
```

设计文档从 `docs/design/index.html` 开始读。
