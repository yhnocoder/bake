export const SETTINGS = {
  toc: { values: ['notes', 'tabs', 'dots', 'ticks'], initial: (article) => article.toc },
  theme: { values: ['system', 'light', 'dark'], initial: () => 'system' },
  font: { values: ['sans', 'wenkai'], initial: () => 'sans' },
  buttons: { values: ['autohide', 'always'], initial: () => 'autohide' },
};

export const SITE_SETTINGS = ['theme', 'font'];

export const HOME_COLUMNS = ['3', '4', '5'];

export function storageKey(name) {
  return `bk-${name}`;
}

export function settingAttributes(names, article) {
  return Object.fromEntries(names.map((name) => [`data-${name}`, SETTINGS[name].initial(article)]));
}

export const prepaintScript = `document.documentElement.dataset.script='on';try{var s=${JSON.stringify(
  Object.fromEntries(Object.entries(SETTINGS).map(([name, setting]) => [name, setting.values])),
)},d=document.documentElement.dataset;for(var k in s){var v=localStorage.getItem('${storageKey('')}'+k);if(d[k]!==undefined&&s[k].indexOf(v)>=0)d[k]=v}}catch(e){}`;

export function homePrepaintScript(groups) {
  const choices = JSON.stringify({ group: groups, columns: HOME_COLUMNS });
  return `try{var h=${choices},e=document.documentElement.dataset;for(var n in h){var c=localStorage.getItem('${storageKey('')}'+n);var i=h[n].indexOf(c);if(i>=0){e[n]=c;document.documentElement.style.setProperty('--'+n+'-index',i)}}}catch(x){}`;
}
