import { site } from 'bake/runtime';

export default class PageList extends HTMLElement {
  connectedCallback() {
    this.redraw = () => this.draw();
    document.addEventListener('bake:site', this.redraw);
    this.draw();
  }

  disconnectedCallback() {
    document.removeEventListener('bake:site', this.redraw);
  }

  draw() {
    const list = document.createElement('ul');
    list.className = 'page-list';
    for (const page of site.pages.filter((page) => page.url !== '/')) {
      const link = document.createElement('a');
      link.href = import.meta.env.BASE_URL + page.url.slice(1);
      link.textContent = page.title;
      const item = document.createElement('li');
      item.append(link);
      list.append(item);
    }
    this.querySelector(':scope > ul')?.remove();
    this.prepend(list);
  }
}
