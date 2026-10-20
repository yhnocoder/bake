.PHONY: check browser example dev perf

check: node_modules
	scripts/test.sh

node_modules: package.json package-lock.json
	npm ci

browser: node_modules
	npx playwright install chromium
	npm run test:browser

example: node_modules
	cd examples/blog && node ../../src/cli.js build
	node --input-type=module -e "const { serveStatic } = await import('./scripts/static-server.js'); const { origin } = await serveStatic('examples/blog/dist'); console.log(origin.replace('127.0.0.1', 'localhost') + '/');"

dev: node_modules
	cd examples/blog && node ../../src/cli.js dev

perf: node_modules
	cd examples/blog && node ../../src/cli.js build
	mkdir -p test-out/perf
	node scripts/measure-pages.js examples/blog/dist --out test-out/perf/report.json
	node scripts/check-budgets.js test-out/perf/report.json
