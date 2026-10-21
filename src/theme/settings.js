import { HOME_COLUMNS } from '../choices.js';

export const READING_SETTINGS = Object.freeze({
  theme: { values: ['system', 'light', 'dark'], default: 'system' },
  font: { values: ['sans', 'wenkai'], default: 'sans' },
  size: { values: ['small', 'medium', 'large', 'larger'], default: 'medium' },
  weight: { values: ['light', 'regular', 'bold'], default: 'regular' },
  spacing: { values: ['tight', 'normal', 'loose'], default: 'normal' },
});

export const SITE_SETTINGS = Object.freeze({ theme: READING_SETTINGS.theme, font: READING_SETTINGS.font });

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
  const settingSteps = `try{var s=${choices},d=document.documentElement.dataset;for(var k in s){var v=localStorage.getItem('${storageKey('')}'+k);if(s[k].indexOf(v)>=0)d[k]=v}}catch(e){}`;
  const schemeSteps = `var t=document.documentElement.dataset.theme;document.documentElement.dataset.scheme=t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;`;
  return `if(${JSON.stringify(MODULE_SCRIPT_SCHEMES)}.indexOf(location.protocol)>=0){document.documentElement.dataset.script='on';${settingSteps}${schemeSteps}${pageSteps}}`;
}

export function lightWenkaiSteps(href) {
  if (href === undefined) return '';
  return `var w=document.documentElement.dataset;if(w.font==='wenkai'&&w.weight==='light'){var l=document.createElement('link');l.rel='stylesheet';l.href=${JSON.stringify(href)};document.head.appendChild(l)}`;
}

export function homePrepaintSteps(groups) {
  const choices = JSON.stringify({ group: groups, columns: HOME_COLUMNS.map(String) });
  return `try{var h=${choices},e=document.documentElement.dataset;for(var n in h){var c=localStorage.getItem('${storageKey('')}'+n);var i=h[n].indexOf(c);if(i>=0){e[n]=c;document.documentElement.style.setProperty('--'+n+'-index',i)}}}catch(x){}`;
}
