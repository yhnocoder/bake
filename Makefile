.PHONY: check browser example dev screenshots perf

BASE ?= origin/main

check:
	scripts/test.sh

node_modules: package.json package-lock.json
	npm ci

browser: node_modules
	npx playwright install chromium
	npm run test:browser

example: node_modules
	cd examples/blog && node ../../src/cli.js build
	python3 -m http.server --directory examples/blog/dist --bind 127.0.0.1 8000

dev: node_modules
	cd examples/blog && node ../../src/cli.js dev

screenshots: node_modules
	scripts/screenshots.sh $(BASE)

perf: node_modules
	cd examples/blog && node ../../src/cli.js build
	mkdir -p test-out/perf
	node scripts/measure-pages.js examples/blog/dist --out test-out/perf/report.json
	node scripts/check-budgets.js test-out/perf/report.json
