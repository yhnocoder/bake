import { HOME_COLUMNS } from '../choices.js';

export const READING_SETTINGS = Object.freeze({
  theme: { values: ['system', 'light', 'dark'], default: 'system' },
  size: { values: ['small', 'medium', 'large', 'larger'], default: 'medium' },
  weight: { values: ['light', 'regular', 'bold'], default: 'regular' },
  spacing: { values: ['tight', 'normal', 'loose'], default: 'normal' },
});

export const SITE_SETTINGS = Object.freeze({ theme: READING_SETTINGS.theme });

export const FONT_KEY = storageKey('font-family');

export function storageKey(name) {
  return `bk-${name}`;
}

export function settingDefaults(settings, options) {
  return Object.fromEntries(Object.entries(settings).map(([name, setting]) => [name, typeof setting.default === 'string' ? setting.default : options[setting.default.option]]));
}

export function settingAttributes(defaults) {
  return Object.fromEntries(Object.entries(defaults).map(([name, value]) => [`data-${name}`, value]));
}

const MODULE_SCRIPT_SCHEMES = ['http:', 'https:'];

export function prepaintScript(settings, pageSteps = '') {
  const choices = JSON.stringify(Object.fromEntries(Object.entries(settings).map(([name, setting]) => [name, setting.values])));
  const fontSteps = `var f=localStorage.getItem('${FONT_KEY}');if(f)document.documentElement.style.setProperty('--reader-font',f+', var(--font-sans)');`;
  const settingSteps = `try{var s=${choices},d=document.documentElement.dataset;for(var k in s){var v=localStorage.getItem('${storageKey('')}'+k);if(s[k].indexOf(v)>=0)d[k]=v}${fontSteps}}catch(e){}`;
  const schemeSteps = `var t=document.documentElement.dataset.theme;document.documentElement.dataset.scheme=t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;`;
  return `if(${JSON.stringify(MODULE_SCRIPT_SCHEMES)}.indexOf(location.protocol)>=0){document.documentElement.dataset.script='on';${settingSteps}${schemeSteps}${pageSteps}}`;
}

// why: a CSS string cannot hold a bare quote or backslash, and no font name needs one
export function fontFamilies(text) {
  return text
    .split(',')
    .map((name) => name.replace(/["\\]/g, '').trim())
    .filter((name) => name !== '')
    .map((name) => `"${name}"`)
    .join(', ');
}

export function homePrepaintSteps(groups) {
  const choices = JSON.stringify({ group: groups, columns: HOME_COLUMNS.map(String) });
  return `try{var h=${choices},e=document.documentElement.dataset;for(var n in h){var c=localStorage.getItem('${storageKey('')}'+n);var i=h[n].indexOf(c);if(i>=0){e[n]=c;document.documentElement.style.setProperty('--'+n+'-index',i)}}}catch(x){}`;
}
