export const SETTINGS = {
  toc: { pages: ['article'], values: ['notes', 'tabs', 'dots', 'ticks'], initial: (article) => article.toc },
  theme: { pages: ['article', 'home', 'not-found'], values: ['system', 'light', 'dark'], initial: () => 'system' },
  font: { pages: ['article', 'home', 'not-found'], values: ['sans', 'wenkai'], initial: () => 'sans' },
  buttons: { pages: ['article'], values: ['autohide', 'always'], initial: () => 'autohide' },
};

export const HOME_COLUMNS = ['3', '4', '5'];

export function storageKey(name) {
  return `bk-${name}`;
}

export function settingAttributes(page, article) {
  return Object.fromEntries(
    Object.entries(SETTINGS)
      .filter(([, setting]) => setting.pages.includes(page))
      .map(([name, setting]) => [`data-${name}`, setting.initial(article)]),
  );
}

const MODULE_SCRIPT_SCHEMES = ['http:', 'https:'];

export function prepaintScript(pageSteps = '') {
  const choices = JSON.stringify(Object.fromEntries(Object.entries(SETTINGS).map(([name, setting]) => [name, setting.values])));
  const settingSteps = `try{var s=${choices},d=document.documentElement.dataset;for(var k in s){var v=localStorage.getItem('${storageKey('')}'+k);if(d[k]!==undefined&&s[k].indexOf(v)>=0)d[k]=v}}catch(e){}`;
  const schemeSteps = `var t=document.documentElement.dataset.theme;if(t!==undefined)document.documentElement.dataset.scheme=t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;`;
  return `if(${JSON.stringify(MODULE_SCRIPT_SCHEMES)}.indexOf(location.protocol)>=0){document.documentElement.dataset.script='on';${settingSteps}${schemeSteps}${pageSteps}}`;
}

export function homePrepaintSteps(groups) {
  const choices = JSON.stringify({ group: groups, columns: HOME_COLUMNS });
  return `try{var h=${choices},e=document.documentElement.dataset;for(var n in h){var c=localStorage.getItem('${storageKey('')}'+n);var i=h[n].indexOf(c);if(i>=0){e[n]=c;document.documentElement.style.setProperty('--'+n+'-index',i)}}}catch(x){}`;
}
