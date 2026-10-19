export const SETTINGS = {
  toc: { values: ['notes', 'tabs', 'dots', 'ticks'], initial: (article) => article.toc },
  theme: { values: ['system', 'light', 'dark'], initial: () => 'system' },
  font: { values: ['sans', 'wenkai'], initial: () => 'sans' },
  buttons: { values: ['autohide', 'always'], initial: () => 'autohide' },
};

export function storageKey(name) {
  return `bk-${name}`;
}

export function settingAttributes(article) {
  return Object.fromEntries(Object.entries(SETTINGS).map(([name, setting]) => [`data-${name}`, setting.initial(article)]));
}

export const prepaintScript = `document.documentElement.dataset.script='on';try{var s=${JSON.stringify(
  Object.fromEntries(Object.entries(SETTINGS).map(([name, setting]) => [name, setting.values])),
)},d=document.documentElement.dataset;for(var k in s){var v=localStorage.getItem('${storageKey('')}'+k);if(s[k].indexOf(v)>=0)d[k]=v}}catch(e){}`;
