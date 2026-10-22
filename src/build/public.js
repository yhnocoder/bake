import { join, posix } from 'node:path';
import { errorAt, fileStart } from '../shared/report.js';
import { listFiles } from './files.js';
import { SHARE_IMAGE_DIR } from './share-images.js';
import { THEME_STYLES_PATH } from './theme.js';

const PUBLIC_DIR = 'public';
const RESERVED_DIRS = [posix.dirname(THEME_STYLES_PATH), SHARE_IMAGE_DIR];

export function publicOutputs(root, outputs, errors) {
  const owners = new Map(outputs.map((output) => [output.path, output.owner]));
  return listFiles(join(root, PUBLIC_DIR), (name) => name !== '.DS_Store').map((path) => {
    const message = publicConflict(path, owners);
    if (message) errors.push(errorAt(posix.join(PUBLIC_DIR, path), fileStart, message));
    return { path, from: join(root, PUBLIC_DIR, path) };
  });
}

function publicConflict(path, owners) {
  if (owners.has(path)) return `dist/${path} is also written by ${owners.get(path)}`;
  const reserved = RESERVED_DIRS.find((dir) => path.startsWith(`${dir}/`));
  if (reserved !== undefined) return `dist/${reserved}/ is reserved for the files Bake writes`;
  for (const [other, owner] of owners) {
    if (other.startsWith(`${path}/`) || path.startsWith(`${other}/`)) return `dist/${path} conflicts with dist/${other} written by ${owner}`;
  }
  return null;
}
