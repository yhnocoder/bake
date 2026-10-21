const CHINESE = {
  toc: '目录',
  notes: '前文笔记',
  openToc: '打开目录',
  close: '关闭',
  reading: '正在读',
  settings: {
    toc: { label: '目录样式', values: { notes: '前文笔记', tabs: '书签索引', dots: '圆点胶囊', ticks: '刻度线' } },
    buttons: { label: '按钮', values: { autohide: '向下滚动时隐藏按钮' } },
  },
};

const ENGLISH = {
  toc: 'Contents',
  notes: 'Notes',
  openToc: 'Open the contents',
  close: 'Close',
  reading: 'Reading',
  settings: {
    toc: { label: 'Contents style', values: { notes: 'Notes', tabs: 'Tabs', dots: 'Dots', ticks: 'Ticks' } },
    buttons: { label: 'Buttons', values: { autohide: 'Hide the buttons while scrolling down' } },
  },
};

export function essayLabels(language) {
  return language.toLowerCase().startsWith('zh') ? CHINESE : ENGLISH;
}
