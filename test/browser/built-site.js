import { readFileSync } from 'node:fs';
import { deserialize } from 'node:v8';
import { builtBlog, builtExample } from '../blog.js';

const { example, files } = deserialize(readFileSync(0));
process.stdout.write(example ? await builtExample(files) : await builtBlog(files));
