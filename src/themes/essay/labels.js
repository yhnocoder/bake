const CHINESE = {
  toc: '目录',
  notes: '前文笔记',
  openToc: '打开目录',
  close: '关闭',
  reading: '正在读',
  settings: '设置',
  tocStyle: '目录',
  tocStyles: { notes: '前文笔记', tabs: '书签索引', dots: '圆点胶囊', ticks: '刻度线' },
  theme: '主题',
  themes: { system: '跟随系统', light: '浅', dark: '深' },
  font: '正文',
  fonts: { sans: '黑体', wenkai: '霞鹜文楷' },
  buttons: '按钮',
  hideButtons: '向下滚动时隐藏按钮',
  references: '参考文献',
  words: (count) => `约 ${roundWords(count).toLocaleString('zh-CN')} 字`,
  draft: '草稿',
  copyLink: '复制本节链接',
  linkCopied: '已复制本节链接',
  sidenote: (number) => `旁注 ${number}`,
  openOriginal: '点击跳转到原文',
  embedSource: { before: '出自《', after: '》' },
};

const ENGLISH = {
  toc: 'Contents',
  notes: 'Notes',
  openToc: 'Open the contents',
  close: 'Close',
  reading: 'Reading',
  settings: 'Settings',
  tocStyle: 'Contents',
  tocStyles: { notes: 'Notes', tabs: 'Tabs', dots: 'Dots', ticks: 'Ticks' },
  theme: 'Theme',
  themes: { system: 'System', light: 'Light', dark: 'Dark' },
  font: 'Text',
  fonts: { sans: 'Sans', wenkai: 'LXGW WenKai' },
  buttons: 'Buttons',
  hideButtons: 'Hide the buttons while scrolling down',
  references: 'References',
  words: (count) => `${roundWords(count).toLocaleString('en')} ${count === 1 ? 'word' : 'words'}`,
  draft: 'Draft',
  copyLink: 'Copy the link to this section',
  linkCopied: 'Link copied',
  sidenote: (number) => `Sidenote ${number}`,
  openOriginal: 'Click to open the original',
  embedSource: { before: 'From “', after: '”' },
};

export function labelsFor(language) {
  return language.toLowerCase().startsWith('zh') ? CHINESE : ENGLISH;
}

function roundWords(count) {
  return count >= 1000 ? Math.round(count / 100) * 100 : count;
}
