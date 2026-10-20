import { HOME_COLUMNS, TOC_STYLES } from '../choices.js';

export const SETTINGS = {
  toc: { values: TOC_STYLES, initial: (article) => article.toc },
  theme: { values: ['system', 'light', 'dark'], initial: () => 'system' },
  font: { values: ['sans', 'wenkai'], initial: () => 'sans' },
  size: { values: ['small', 'medium', 'large', 'larger'], initial: () => 'medium' },
  weight: { values: ['light', 'regular', 'bold'], initial: () => 'regular' },
  spacing: { values: ['tight', 'normal', 'loose'], initial: () => 'normal' },
  buttons: { values: ['autohide', 'always'], initial: () => 'autohide' },
};

export const SITE_SETTINGS = ['theme', 'font'];

export const READING_SETTINGS = [...SITE_SETTINGS, 'size', 'weight', 'spacing'];

export function storageKey(name) {
  return `bk-${name}`;
}

export function settingAttributes(names, article) {
  return Object.fromEntries(names.map((name) => [`data-${name}`, SETTINGS[name].initial(article)]));
}

const MODULE_SCRIPT_SCHEMES = ['http:', 'https:'];

export function prepaintScript(pageSteps = '') {
  const choices = JSON.stringify(Object.fromEntries(Object.entries(SETTINGS).map(([name, setting]) => [name, setting.values])));
  const settingSteps = `try{var s=${choices},d=document.documentElement.dataset;for(var k in s){var v=localStorage.getItem('${storageKey('')}'+k);if(d[k]!==undefined&&s[k].indexOf(v)>=0)d[k]=v}}catch(e){}`;
  const schemeSteps = `var t=document.documentElement.dataset.theme;if(t!==undefined)document.documentElement.dataset.scheme=t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;`;
  return `if(${JSON.stringify(MODULE_SCRIPT_SCHEMES)}.indexOf(location.protocol)>=0){document.documentElement.dataset.script='on';${settingSteps}${schemeSteps}${pageSteps}}`;
}

export function homePrepaintSteps(groups) {
  const choices = JSON.stringify({ group: groups, columns: HOME_COLUMNS.map(String) });
  return `try{var h=${choices},e=document.documentElement.dataset;for(var n in h){var c=localStorage.getItem('${storageKey('')}'+n);var i=h[n].indexOf(c);if(i>=0){e[n]=c;document.documentElement.style.setProperty('--'+n+'-index',i)}}}catch(x){}`;
}
