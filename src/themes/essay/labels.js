const CHINESE = {
  toc: '目录',
  notes: '前文笔记',
  settings: '设置',
  theme: '主题',
  themes: { system: '跟随系统', light: '浅', dark: '深' },
  font: '正文',
  fonts: { sans: '黑体', wenkai: '霞鹜文楷' },
  references: '参考文献',
  words: (count) => `约 ${roundWords(count).toLocaleString('zh-CN')} 字`,
  draft: '草稿',
  copyLink: '复制本节链接',
  linkCopied: '已复制本节链接',
  sidenote: (number) => `旁注 ${number}`,
  componentNeedsScript: '交互图需要 JavaScript 才能显示',
  componentFailed: '交互图未能加载',
  group: '分组',
  groups: { category: '分类', month: '月份' },
  columns: '列数',
  categories: '分类',
  tags: '标签',
  allTags: '全部',
  posts: (count) => `${count} 篇`,
  noPosts: '还没有文章',
  openOriginal: '点击跳转到原文',
  embedSource: { before: '出自《', after: '》' },
};

const ENGLISH = {
  toc: 'Contents',
  notes: 'Notes',
  settings: 'Settings',
  theme: 'Theme',
  themes: { system: 'System', light: 'Light', dark: 'Dark' },
  font: 'Text',
  fonts: { sans: 'Sans', wenkai: 'LXGW WenKai' },
  references: 'References',
  words: (count) => `${roundWords(count).toLocaleString('en')} ${count === 1 ? 'word' : 'words'}`,
  draft: 'Draft',
  copyLink: 'Copy the link to this section',
  linkCopied: 'Link copied',
  sidenote: (number) => `Sidenote ${number}`,
  componentNeedsScript: 'This interactive figure needs JavaScript',
  componentFailed: 'This interactive figure could not be loaded',
  group: 'Group',
  groups: { category: 'Category', month: 'Month' },
  columns: 'Columns',
  categories: 'Categories',
  tags: 'Tags',
  allTags: 'All',
  posts: (count) => `${count} ${count === 1 ? 'post' : 'posts'}`,
  noPosts: 'No posts yet',
  openOriginal: 'Click to open the original',
  embedSource: { before: 'From “', after: '”' },
};

export function labelsFor(language) {
  return language.toLowerCase().startsWith('zh') ? CHINESE : ENGLISH;
}

function roundWords(count) {
  return count >= 1000 ? Math.round(count / 100) * 100 : count;
}
