import { join, posix } from 'node:path';
import { COMPONENTS_DIR } from '../components/read.js';
import { listFiles } from './files.js';

export const POSTS_DIR = 'content/posts';

export function findArticles(root) {
  const files = listFiles(join(root, POSTS_DIR), (name) => !name.startsWith('.'));
  const dirs = files.filter((file) => posix.basename(file) === 'index.md').map((file) => posix.dirname(file));
  return dirs.map((dir) => {
    const prefix = dir === '.' ? '' : `${dir}/`;
    const nested = dirs.filter((other) => other !== dir && (prefix === '' || other.startsWith(prefix))).map((other) => `${other}/`);
    return {
      file: posix.join(POSTS_DIR, prefix, 'index.md'),
      dir: posix.join(POSTS_DIR, dir),
      files: files
        .filter((file) => file.startsWith(prefix) && file !== `${prefix}index.md` && !file.startsWith(`${prefix}${COMPONENTS_DIR}/`) && !nested.some((other) => file.startsWith(other)))
        .map((file) => file.slice(prefix.length)),
    };
  });
}
