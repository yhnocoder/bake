.PHONY: example preview

example:
	node scripts/accept/render-page.mjs examples/minimal content/features.md out/minimal/features.html

preview:
	node scripts/preview.mjs
