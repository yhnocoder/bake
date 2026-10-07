import { serveExample } from './example-server.js';

const server = await serveExample();
for (const message of server.messages) console.error(message);
for (const [name, url] of Object.entries(server.pages)) console.log(`${name}: ${server.origin}${url}`);
