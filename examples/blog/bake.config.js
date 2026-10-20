export default {
  title: 'Bake Example',
  description: '用 Bake 写成的示例博客，列出 Bake 支持的全部写法，也是 Bake 的集成测试数据。',
  url: 'https://example.github.io',
  language: 'zh-CN',
  theme: 'essay',
  toc: 'notes',
  themes: { bento: { columns: 4 } },
  home: { columns: 3, groupBy: 'category' },
  categories: [
    { id: 'writing', name: '写法', color: '#985b57', desc: 'Bake 支持的 Markdown 写法和它们生成的页面。' },
    { id: 'math', name: '数学', color: '#2a78d6', desc: '链式法则、雅可比矩阵与反向传播。' },
    { id: 'pages', name: 'HTML 页面', color: '#1baf7a', desc: '不经过 Markdown、原样发布的页面。' },
  ],
};
