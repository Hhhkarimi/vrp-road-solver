# Changelog

## 2.2.2 — Map startup rebuild

- Fixed fatal `makeId()` startup bug (`globalThis.makeId()` → `crypto.randomUUID()`).
- Fixed startup ordering: helpers are initialized before default vehicles/state are created.
- Bound Leaflet explicitly from `window.L`.
- Added visible runtime startup diagnostics instead of a silent blank map.
- Added cache-busting for app CSS/JS and conservative Vercel cache headers.
- Expanded browser smoke test stub to exercise depot/customer selection and registration.
