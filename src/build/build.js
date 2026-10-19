import { sortErrors } from '../report.js';
import { writeDist } from './dist.js';
import { shareImageOutputs } from './share-images.js';
import { createSite, updateSite } from './site.js';

export async function build(root) {
  const site = await updateSite(createSite(root, { shareImages: true }));
  if (site.errors.length > 0) return { errors: site.errors };
  const errors = [];
  const themeSources = new Map(site.themeFiles.map((output) => [output.path, output.render()]));
  const shareImages = await shareImageOutputs(root, site.shareImages, themeSources, errors);
  if (errors.length > 0) return { errors: sortErrors(errors) };
  await writeDist(root, [...site.pages.flatMap((page) => page.outputs), site.home, ...site.siteFiles, ...site.themeFiles, ...shareImages, ...site.publicFiles]);
  return { errors: [], pages: site.pages.length };
}
