import { watchSidenotes } from './sidenotes.js';

const article = document.querySelector('article');
if (article) watchSidenotes(article);
