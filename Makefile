.PHONY: check example screenshots

BASE ?= origin/main

check:
	scripts/test.sh

node_modules: package.json package-lock.json
	npm ci

example: node_modules
	cd examples/blog && node ../../src/cli.js build
	python3 -m http.server --directory examples/blog/dist --bind 127.0.0.1 8000

screenshots: node_modules
	scripts/screenshots.sh $(BASE)
