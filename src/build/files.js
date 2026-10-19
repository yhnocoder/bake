import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function listFiles(dir) {
  const stat = statSync(dir, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) return [];
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? listFiles(path).map((file) => `${name}/${file}`) : [name];
    })
    .sort();
}
