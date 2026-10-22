import { bundleComponents } from '../components/bundle.js';

export async function compileComponents(site, published, errors) {
  const names = [...new Set(published.flatMap((article) => article.content?.components ?? []))].sort();
  if (names.length === 0) return null;
  const { settings } = site;
  const result = await site.memo.get('components bundle', { components: names.map((name) => settings.components.get(name)), preamble: settings.preamble }, async (files) => {
    const bundleErrors = [];
    const bundle = await bundleComponents(files, files.value((context) => context.components), files.value((context) => context.preamble), bundleErrors, { prefetch: site.prefetch });
    return { bundle, errors: bundleErrors };
  });
  errors.push(...result.errors);
  return result.bundle;
}
