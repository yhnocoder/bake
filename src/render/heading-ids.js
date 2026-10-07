import GithubSlugger from 'github-slugger';

export function createHeadingIds(explicitIds) {
  const slugger = new GithubSlugger();
  return (text) => {
    const normalized = text.replace(/\s+/g, ' ').trim();
    let id;
    do id = slugger.slug(normalized);
    while (explicitIds.has(id));
    return id;
  };
}
