# iasds.github.io

Personal homepage built with Hugo and a custom `iasds` theme, deployed to GitHub Pages.

## Structure

```
content/
├── i2p/       # I2P research section
├── qubes/     # Qubes OS research section
├── other/     # Other projects
└── store/     # Standalone page (no section)
```

- Each section has an `_index.md` (homepage card content) plus extra `.md` files for detail pages, auto-listed under the card.

## Local Development

```bash
hugo server -D --disableFastRender
```

- Always use `--disableFastRender`: theme static-file changes are not picked up without it.
- After changing theme files, `rm -rf public` and restart the server.

## Adding a New Post

Checklist for new articles:

1. **Frontmatter** — all four fields: `title`, `date`, `description`, `tags`.
2. **Images**:
   - Put images in the post's bundle directory, **same level as `index.md`** (subdirectories are ignored and break `srcset`).
   - Use relative paths `![description](file.webp)` — never absolute `/img/` paths.
   - Must be **WebP** (no PNG/AVIF), width ≤ 1920px, with descriptive alt text.
3. **Content**:
   - Language-tagged code blocks (```bash).
   - Math with `$..$` / `$$..$$` — KaTeX auto-loads on demand.
   - Content starts at `h2` (the template renders the title as `h1`).
4. **Verify locally**: `hugo --minify` with zero ERRORs.

## Deployment

Push to `main` triggers the GitHub Actions workflow, which builds the site and deploys to GitHub Pages. Verify at https://iasds.github.io/.

## Theme Notes

- The theme is a custom one at `themes/iasds`.
- The dual-font system was removed: the whole site now uses the subsetted Season VF (`static/fonts/SeasonCollectionVF-subset.woff2`). The original font backup lives at `~/backup/iasds-fonts/`.
- A Service Worker (`static/sw.js`) caches static assets; after a release, old resources may be served from the browser cache for up to ~10 minutes.
- Image pipeline: the render hook automatically resizes to 800/1600px and produces both AVIF and WebP with `srcset` — no manual processing needed.

## Local Files

`AGENTS.md` exists only locally (excluded via `.gitignore`, never committed). It documents the agent collaboration conventions for this repository — commit rules, the post-submission checklist, and maintenance notes.
