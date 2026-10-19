import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DIST_DIR = 'dist';
const STAGING_DIR = '.dist-staging';
const PREVIOUS_DIR = '.dist-previous';

export async function writeDist(root, outputs) {
  const staging = join(root, STAGING_DIR);
  const previous = join(root, PREVIOUS_DIR);
  const dist = join(root, DIST_DIR);
  removeFolder(staging);
  removeFolder(previous);
  try {
    mkdirSync(staging);
    for (const output of outputs) {
      const target = join(staging, output.path);
      mkdirSync(dirname(target), { recursive: true });
      if (output.from === undefined) writeFileSync(target, await output.render());
      else copyFileSync(output.from, target);
    }
    if (existsSync(dist)) renameSync(dist, previous);
    renameSync(staging, dist);
  } catch (error) {
    if (existsSync(previous) && !existsSync(dist)) renameSync(previous, dist);
    throw error;
  } finally {
    removeFolder(staging);
    removeFolder(previous);
  }
}

function removeFolder(folder) {
  rmSync(folder, { recursive: true, force: true });
}
