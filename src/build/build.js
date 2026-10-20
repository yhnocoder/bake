import { sortErrors } from '../report.js';
import { writeDist } from './dist.js';
import { shareImageOutputs } from './share-images.js';
import { createSite, updateSite } from './site.js';

export async function build(root) {
  const site = await updateSite(createSite(root, { shareImages: true }));
  const errors = [...site.errors];
  const shareImages = await shareImageOutputs(root, site.shareImages, site.assetSources, errors);
  if (errors.length > 0) return { errors: sortErrors(errors) };
  await writeDist(root, [...site.pages.flatMap((page) => page.outputs), site.home, ...site.siteFiles, ...site.assetFiles, ...shareImages, ...site.publicFiles]);
  return { errors: [], pages: site.pages.length };
}
