export function startNotFound(main) {
  const root = main.dataset.root;
  const pathname = decodedPath(location.pathname);
  const requested = pathname.startsWith(root) ? pathname.slice(root.length) : pathname.slice(1);
  const segments = requested.split('/').filter((segment) => segment !== '' && segment !== 'index.html');
  const path = main.querySelector('.bk-not-found-path');
  path.querySelector('code').textContent = pathname;
  path.hidden = false;
  const last = segments.at(-1);
  const matches = [...main.querySelectorAll('.bk-not-found-matches li')].filter((item) => {
    const [month, slug] = item.dataset.url.split('/');
    return slug === last && segments.join('/') !== `${month}/${slug}`;
  });
  for (const item of matches) item.hidden = false;
  main.querySelector('.bk-not-found-matches').hidden = matches.length === 0;
}

function decodedPath(pathname) {
  try {
    return decodeURI(pathname);
  } catch {
    return pathname;
  }
}
