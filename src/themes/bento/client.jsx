import 'bake/theme/styles/tokens.css';
import 'bake/theme/styles/page.css';
import 'bake/theme/styles/blocks.css';
import 'bake/theme/styles/sidenotes.css';
import 'bake/theme/styles/settings.css';
import 'bake/theme/styles/home.css';
import 'bake/theme/styles/not-found.css';
import 'bake/theme/styles/print.css';
import './styles/bento.css';
import { resolveWidths, startArticle, startHome, startLayout, startLeaveFade, startNotFound, startSettings } from 'bake/theme/client';
import { startNotes } from './scripts/notes.js';
import { startCardScroll } from './scripts/card-scroll.js';
import { placeCards, releaseCards } from './scripts/spans.js';

const home = document.querySelector('.bk-home');
const notFound = document.querySelector('.bk-not-found');
startSettings();
startLeaveFade();
if (home !== null) startHome(home);
if (notFound !== null) startNotFound(notFound);

export default function start(document) {
  const article = document.querySelector('.bk-article');
  if (article === null) return () => {};
  const stops = [startLayout(article, [resolveWidths, placeCards]), startArticle(article), startNotes(article), startCardScroll(article), releaseCards];
  return () => stops.forEach((stop) => stop());
}
