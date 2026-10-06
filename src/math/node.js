import { mathjax } from '@mathjax/src/js/mathjax.js';

mathjax.asyncLoad = (name) => import(name);
