export const SETTINGS = {
  theme: { values: ['system', 'light', 'dark'], initial: 'system' },
  font: { values: ['sans', 'wenkai'], initial: 'sans' },
};

export const HOME_COLUMNS = ['3', '4', '5'];

export function storageKey(name) {
  return `bk-${name}`;
}

export const prepaintScript = `document.documentElement.dataset.script='on';try{var s=${JSON.stringify(
  Object.fromEntries(Object.entries(SETTINGS).map(([name, setting]) => [name, setting.values.filter((value) => value !== setting.initial)])),
)},d=document.documentElement.dataset;for(var k in s){var v=localStorage.getItem('${storageKey('')}'+k);if(s[k].indexOf(v)>=0)d[k]=v}}catch(e){}`;

export function homePrepaintScript(groups) {
  const choices = JSON.stringify({ group: groups, columns: HOME_COLUMNS });
  return `try{var h=${choices},e=document.documentElement.dataset;for(var n in h){var c=localStorage.getItem('${storageKey('')}'+n);if(h[n].indexOf(c)>=0)e[n]=c}}catch(x){}`;
}
