import { sortErrors } from '../report.js';
import { writeDist } from './dist.js';
import { shareImageOutputs } from './share-images.js';
import { createSite, updateSite } from './site.js';

export async function build(root) {
  const site = await updateSite(createSite(root, { shareImages: true }));
  const failed = new Set(site.errors.map((error) => error.file));
  const errors = [...site.errors];
  const assets = new Map(site.assetFiles.map((output) => [output.path, output.render()]));
  const images = site.shareImages.filter((image) => !failed.has(image.owner));
  const shareImages = await shareImageOutputs(root, images, assets, errors);
  if (errors.length > 0) return { errors: sortErrors(errors) };
  await writeDist(root, [...site.pages.flatMap((page) => page.outputs), site.home, ...site.siteFiles, ...site.assetFiles, ...shareImages, ...site.publicFiles]);
  return { errors: [], pages: site.pages.length };
}
