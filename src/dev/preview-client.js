import { installPreview } from '../client/preview.js';

installPreview({
  async load({ page, id }) {
    const response = await fetch(`/__bake/preview?href=${encodeURIComponent(page + (id ? `#${id}` : ''))}`);
    if (response.status === 404) return null;
    return response.json();
  },
});
