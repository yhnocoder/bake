export function createSite(pages) {
  const byUrl = new Map();
  for (const page of pages) {
    if (page.url !== null && !byUrl.has(page.url)) byUrl.set(page.url, page);
  }
  const bySource = new Map(pages.map((page) => [page.article, page]));
  return {
    find(address, source) {
      const page = byUrl.get(address.path);
      if (page === undefined) return { problem: `does not exist${movedHint(address, byUrl)}` };
      if (page.draft && bySource.get(source)?.draft !== true) return { problem: 'is a draft, which is not published' };
      if (address.anchor !== undefined && (page.article === null || !page.article.hasTarget(address.anchor))) return { problem: 'does not exist' };
      return { page };
    },
  };
}

function movedHint(address, byUrl) {
  const slug = address.path.split('/')[2];
  const moved = [...byUrl.keys()].filter((url) => url.split('/')[2] === slug);
  if (moved.length === 0) return '';
  if (moved.length === 1) return `; the article with slug "${slug}" is at ${moved[0]}`;
  return `; the articles with slug "${slug}" are at ${moved.slice(0, -1).join(', ')} and ${moved.at(-1)}`;
}
