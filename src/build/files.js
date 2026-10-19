import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function listFiles(dir, include) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => include(entry.name))
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return listFiles(path, include).map((file) => `${entry.name}/${file}`);
      if (entry.isFile()) return [entry.name];
      return entry.isSymbolicLink() && statSync(path, { throwIfNoEntry: false })?.isFile() ? [entry.name] : [];
    })
    .sort();
}
