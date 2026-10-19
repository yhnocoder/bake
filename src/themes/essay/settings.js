export const SETTINGS = {
  theme: { values: ['system', 'light', 'dark'], initial: 'system' },
  font: { values: ['sans', 'wenkai'], initial: 'sans' },
};

export function storageKey(name) {
  return `bk-${name}`;
}

export const prepaintScript = `try{var s=${JSON.stringify(
  Object.fromEntries(Object.entries(SETTINGS).map(([name, setting]) => [name, setting.values.filter((value) => value !== setting.initial)])),
)},d=document.documentElement.dataset;for(var k in s){var v=localStorage.getItem('${storageKey('')}'+k);if(s[k].indexOf(v)>=0)d[k]=v}}catch(e){}`;
