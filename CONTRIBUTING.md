# Contributing

Thanks for helping improve Paper Desk.

## Development setup

```bash
git clone https://github.com/fexas/dsh-paper-desk.git
cd dsh-paper-desk
npm ci
npm run build
```

Install the checkout as a DSH profile bundle, then reload the Web page. The
browser half is rebuilt by `npm run build`; the host half is plain ESM and needs
no build.

## Before opening a pull request

- Run `npm run check` and `npm run build`.
- Keep PDF, notes and annotation data out of commits (`projects/` is ignored).
- Keep UI colours on `--dsw-alias-*` tokens; use literal colours only for
  artwork or PDF highlight overlays.
- Add no CDN, iframe application shell or second filesystem root.
- For AI changes, preserve the "paper text + notes + annotations" context model
  and keep note generation non-blocking for the PDF reader.

## Reporting bugs

Please include:

- DSH version and platform
- PDF page count and approximate size (do not attach private papers)
- Browser console errors, if any
- Whether the issue reproduces on a fresh project
