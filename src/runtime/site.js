async function loadSite() {
  const response = await fetch(`${import.meta.env.BASE_URL}site.json`);
  if (!response.ok) throw new Error(`Cannot load site.json: ${response.status}`);
  return response.json();
}

export const site = await loadSite();

if (import.meta.hot) {
  import.meta.hot.on('bake:site', (data) => {
    site.pages = data.pages;
    site.config = data.config;
    document.dispatchEvent(new Event('bake:site'));
  });
}
