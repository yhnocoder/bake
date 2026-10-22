import { writeDist } from './dist.js';
import { createSite, updateSite } from './site.js';

export async function build(root) {
  const site = await updateSite(createSite(root, { shareImages: true }));
  if (site.errors.length > 0) return { errors: site.errors };
  await writeDist(root, [...site.pages.flatMap((page) => page.outputs), site.home, ...site.siteFiles, ...site.assetFiles, ...site.publicFiles]);
  return { errors: [], pages: site.pages.length };
}
