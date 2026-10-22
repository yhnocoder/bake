import { builtSite } from './browser.js';

// why: most test files open the example blog, and building it once here keeps the parallel workers from building it each
export default function setup() {
  builtSite(true);
}
