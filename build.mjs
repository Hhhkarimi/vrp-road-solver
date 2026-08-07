import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'

await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })
await cp('public', 'dist', { recursive: true })

// Vendor runtime map/font assets into the deployment output so the browser does
// not depend on a third-party CDN just to initialize the UI.
await mkdir('dist/vendor/leaflet', { recursive: true })
await cp('node_modules/leaflet/dist/leaflet.js', 'dist/vendor/leaflet/leaflet.js')
await cp('node_modules/leaflet/dist/leaflet.css', 'dist/vendor/leaflet/leaflet.css')
await cp('node_modules/leaflet/dist/images', 'dist/vendor/leaflet/images', { recursive: true })
await mkdir('dist/vendor/vazirmatn', { recursive: true })
await cp('node_modules/@fontsource-variable/vazirmatn/index.css', 'dist/vendor/vazirmatn/index.css')
await cp('node_modules/@fontsource-variable/vazirmatn/files', 'dist/vendor/vazirmatn/files', { recursive: true })

const siteUrl = (process.env.SITE_URL || '').trim().replace(/\/$/, '')
if (siteUrl) {
  const indexPath = 'dist/index.html'
  let html = await readFile(indexPath, 'utf8')
  html = html.replace('<!-- SEO_CANONICAL -->', `<link rel="canonical" href="${siteUrl}/" />\n  <meta property="og:url" content="${siteUrl}/" />`)
  await writeFile(indexPath, html)
  await writeFile('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${siteUrl}/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url></urlset>\n`)
  await writeFile('dist/robots.txt', `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`)
} else {
  const indexPath = 'dist/index.html'
  const html = (await readFile(indexPath, 'utf8')).replace('<!-- SEO_CANONICAL -->', '')
  await writeFile(indexPath, html)
}
console.log(`OptiMasir static site built${siteUrl ? ` for ${siteUrl}` : ' (SITE_URL not set; canonical/sitemap omitted)'}.`)
