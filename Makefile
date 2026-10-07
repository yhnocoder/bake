.PHONY: example preview

example:
	cd examples/minimal && node ../../src/cli.js build --out ../../out/minimal
	python3 -m http.server --directory out/minimal --bind 127.0.0.1 8000

preview:
	node scripts/preview.mjs
