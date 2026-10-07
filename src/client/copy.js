function install() {
  import('./copy-markdown.js').then(({ installCopy }) => installCopy(document));
}

function scheduleInstall() {
  if ('requestIdleCallback' in window) requestIdleCallback(install);
  else setTimeout(install, 0);
}

if (document.readyState === 'complete') scheduleInstall();
else window.addEventListener('load', scheduleInstall, { once: true });
