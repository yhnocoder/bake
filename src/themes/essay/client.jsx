import 'bake/theme/styles/tokens.css';
import 'bake/theme/styles/page.css';
import 'bake/theme/styles/blocks.css';
import 'bake/theme/styles/sidenotes.css';
import './styles/notes.css';
import './styles/toc.css';
import 'bake/theme/styles/settings.css';
import 'bake/theme/styles/home.css';
import 'bake/theme/styles/not-found.css';
import 'bake/theme/styles/print.css';
import { resolveWidths, startArticle, startHome, startLayout, startNotFound, startSettings } from 'bake/theme/client';
import { startButtons } from './scripts/buttons.js';
import { startNotes, tintParagraph } from './scripts/notes.js';
import { startToc } from './scripts/toc.js';

const article = document.querySelector('.bk-article');
const home = document.querySelector('.bk-home');
const notFound = document.querySelector('.bk-not-found');
startSettings();
if (home !== null) startHome(home);
if (notFound !== null) startNotFound(notFound);
if (article !== null) {
  startLayout(article, [resolveWidths]);
  startArticle(article, { onSidenote: (number, on) => tintParagraph(article, number, on) });
  startNotes(article);
  startToc(article);
  startButtons();
}
