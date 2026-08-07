# Deploy on Vercel

This package is intended to replace the previous repository contents.

1. Keep only the `.git` directory if you want to preserve repository history.
2. Delete the old project files and copy all files from this package into the repository root.
3. Commit and push:

```bash
git add -A
git commit -m "Fix map startup and rebuild OptiMasir 2.2.2"
git push
```

4. In Vercel, redeploy the latest commit. The project uses:
   - Build Command: `npm run build`
   - Output Directory: `dist`

5. Recommended environment variable:

```text
SITE_URL=https://optimasir.vercel.app
```

6. After deployment, open the site once with a hard refresh. Versioned `app.js?v=2.2.2` also prevents the previous JavaScript from remaining cached.

The browser runtime uses only self-hosted Leaflet/Vazirmatn assets generated during the build. OpenStreetMap tiles and OSRM routing remain external services.
