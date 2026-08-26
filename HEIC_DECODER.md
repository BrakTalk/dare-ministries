# HEIC decoder operations and security

## Runtime choice

Field Photo Inbox uses a project-owned C wrapper around **libheif 1.23.1** with the **libde265 1.1.1** HEVC decoder. These exact source commits and Linux x86_64 artifact hashes are pinned in `netlify/functions/vendor/heic-decoder/manifest.json`. The published JavaScript `heic-decode`, `heic-convert`, and `libheif-js` 1.19.8 packages are not dependencies and are not used.

The build is decode-only: libde265 encoding is disabled, libheif has no encoder backend, dynamic codec plugins are disabled, and no external conversion provider receives originals. The native executable writes bounded RGB and TIFF EXIF files inside a mode-0700 temporary directory. Only sanitized JPEG and thumbnail derivatives enter the private quarantine; the original, RGB, and extracted TIFF are deleted after each attempt.

## Build and artifact maintenance

- Target: Amazon Linux 2023, Linux x86_64, compatible with the deployed Netlify Functions architecture.
- Source pins: libheif `v1.23.1` / `2c4bbb54c2738d4a5efbbe3e5fa1d5d76bb88eb0`; libde265 `v1.1.1` / `4dd701fffac01632ffd5cabc5ef10deb56accba1`.
- Reproducible build: `npm run build:heic-decoder` uses `native/heic-decoder/Dockerfile` and copies the three runtime artifacts plus upstream license notices.
- Integrity check: `npm run verify:heic-artifacts` checks SHA-256, ELF headers, and executable permissions.
- Bundle rule: `netlify.toml` includes `netlify/functions/vendor/heic-decoder/**` in Functions. A deploy-preview-only self-test verifies that the executable and both shared libraries are loadable at runtime.

When updating either library, review upstream security advisories and release notes, rebuild all artifacts, update hashes and notices, run the Linux native tests, and repeat deploy-preview verification before enabling the rollout flag.

## Enforced controls

- Existing email gates remain first: verified webhook/recipient/sender rules; 12 attachments; 15 MB per attachment; 40 MB per email.
- ISO BMFF signatures and compatible brands are inspected before decode. Declared MIME type must agree with detected contents.
- Exactly one top-level primary HEVC still is required. HEIF sequences/video and layered brands are rejected. Auxiliary/depth images are not decoded; they only inform primary selection.
- Dimensions are checked before decode and again afterward. The 40-megapixel limit, libheif's default security limits, a 384 MB total memory cap, 192 MB allocation cap, two decode threads, strict decoding, and decoder-warning rejection remain active. Do not set `LIBHEIF_SECURITY_LIMITS=off` or use libheif's `--disable-limits` option.
- The child process uses no shell, receives no network credentials, has bounded stdout/stderr capture, and is terminated with `SIGKILL` after 10 seconds. Temporary files are always removed.
- Logs contain only generic errors and internal submission IDs. Image bytes, EXIF coordinates, signed attachment URLs, decoder output, and binary data are never logged.
- Attachments are processed sequentially and isolated so one corrupt or stalled attachment does not block later valid photos.

## Supported and unsupported variants

Supported: ordinary HEVC-backed HEIC/HEIF primary stills; HEIF rotation/mirroring; EXIF date/timezone/orientation/GPS when present; auxiliary-image containers where one primary still can be selected; and bounded 10-bit/HDR primary images converted to 8-bit for the existing JPEG pipeline.

Rejected: timed HEIF sequences and video, multiple top-level images/collections, layered HEIF brands, non-HEVC primary items, files over the intake limits, strict-decoder warnings, corrupt/truncated containers, and dimensions over 40 megapixels. Apple Adaptive HDR auxiliary gain maps are not composited; only the supported primary still is sanitized.

## Licensing considerations

libheif and libde265 are distributed under LGPL-3.0-or-later. Their upstream notices are shipped beside the replaceable shared libraries, and the wrapper source/build instructions are included in this repository. HEVC technology may be covered by patents or separate licensing programs in some jurisdictions and uses. This project documentation does not determine whether a particular deployment needs a patent license; the organization should obtain qualified legal advice for its distribution and usage facts before production rollout.

Primary references: [libheif repository and security-limit guidance](https://github.com/strukturag/libheif), [libheif 1.23.1 release](https://github.com/strukturag/libheif/releases/tag/v1.23.1), [libde265 1.1.1 release](https://github.com/strukturag/libde265/releases/tag/v1.1.1), and [Netlify function bundling configuration](https://docs.netlify.com/build/configure-builds/file-based-configuration/).
