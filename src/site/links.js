function decode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function splitHref(href) {
  const hash = href.indexOf('#');
  const path = (hash === -1 ? href : href.slice(0, hash)).split('?')[0];
  const fragment = hash === -1 ? '' : decode(href.slice(hash + 1));
  return { path, fragment };
}

export function brokenLinks(entry, links, targets) {
  const messages = [];
  for (const { href, line, column } of links) {
    const { path, fragment } = splitHref(href);
    const ids = targets.get(path === '' ? entry.url : path);
    const at = { path: entry.path, line, column };
    if (!ids) messages.push({ ...at, text: `Link points to a missing page ${href}` });
    else if (fragment !== '' && !ids.includes(fragment)) messages.push({ ...at, text: `Link points to a missing id ${href}` });
  }
  return messages;
}
