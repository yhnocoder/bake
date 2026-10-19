import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DIST_DIR = 'dist';

export function writeDist(root, outputs) {
  const staging = mkdtempSync(join(root, '.dist-staging-'));
  try {
    chmodSync(staging, 0o755); // why: mkdtemp creates the folder with mode 0700, dist/ keeps the mode of an ordinary folder
    for (const output of outputs) {
      const target = join(staging, output.path);
      mkdirSync(dirname(target), { recursive: true });
      if (output.from === undefined) writeFileSync(target, output.render());
      else copyFileSync(output.from, target);
    }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  const dist = join(root, DIST_DIR);
  const previous = `${staging}-previous`;
  if (existsSync(dist)) renameSync(dist, previous);
  renameSync(staging, dist);
  rmSync(previous, { recursive: true, force: true });
}
