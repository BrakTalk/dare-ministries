# Packaged HEIC decoder

This directory contains the Linux x86_64, decode-only runtime used by the Netlify background function. It pins libheif 1.23.1 with the libde265 1.1.1 HEVC decoder. No HEIC encoder, alternative codec, or dynamic plugin loader is built.

`manifest.json` records source commits and artifact hashes. `npm run verify:heic-artifacts` checks the committed files. Rebuild on an x86_64 Docker host with `npm run build:heic-decoder`; review and update the manifest hashes before replacing an artifact.

The executable and both libraries use relative ELF runpaths, so they do not depend on a preinstalled libheif or libde265. `netlify.toml` explicitly includes this directory in function bundles.

libheif and libde265 are distributed under LGPL-3.0-or-later; their full upstream notices are included in `licenses/`. The project wrapper source is in `native/heic-decoder/` under this repository's ISC license. The shared libraries remain separate, replaceable files.
