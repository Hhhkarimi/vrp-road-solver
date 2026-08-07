const OSRM_BASE = 'https://router.project-osrm.org'
const ROUTE_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be123c', '#4f46e5']
const IRAN_BOUNDS = [[24.5, 44.0], [40.0, 63.5]]

const state = {
  mode: 'customer',
  depot: null,
  customers: [],
  routes: [],
  routeLayers: [],
  pointLayers: [],
}

const $ = (id) => document.getElementById(id)
const fmt = (value, digits = 1) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits }).format(value)
const setStatus = (message) => { $('status').textContent = message }

const map = L.map('map', { zoomControl: true })
map.fitBounds(IRAN_BOUNDS, { padding: [12, 12], animate: false })
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map)

map.on('click', (event) => {
  const { lat, lng } = event.latlng
  $('lat').value = lat.toFixed(6)
  $('lng').value = lng.toFixed(6)

  if (state.mode === 'depot') {
    // Keep the exact clicked coordinate in both the form and the app state.
    // This prevents «ثبت دپو» from overwriting the clicked point with stale inputs.
    state.depot = { id: 'depot', name: $('pointName').value.trim() || 'دپو', lat, lng }
    clearResult()
    renderPoints()
    setStatus('دپو دقیقاً در محل کلیک ثبت شد. مختصات نیز در فیلدها قرار گرفت.')
  } else {
    setStatus('مختصات مشتری از روی نقشه انتخاب شد؛ تقاضا را وارد کنید و «افزودن مشتری» را بزنید.')
  }
})

function setMode(mode) {
  state.mode = mode
  const isCustomer = mode === 'customer'
  $('modeCustomer').classList.toggle('active', isCustomer)
  $('modeDepot').classList.toggle('active', !isCustomer)
  $('demandWrap').classList.toggle('hidden', !isCustomer)
  $('customerActions').classList.toggle('hidden', !isCustomer)
  $('depotActions').classList.toggle('hidden', isCustomer)
  $('modeBadge').textContent = isCustomer ? 'انتخاب مشتری' : 'انتخاب دپو'
  $('pointName').placeholder = isCustomer ? 'مثلاً مشتری ۱' : 'مثلاً انبار مرکزی'
}

function parseCoordinate(id, min, max) {
  const raw = $(id).value.trim()
  if (raw === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min || value > max) return null
  return value
}

function addCustomer() {
  const lat = parseCoordinate('lat', -90, 90)
  const lng = parseCoordinate('lng', -180, 180)
  const demand = Number($('demand').value)
  if (lat === null || lng === null) return setStatus('مختصات مشتری معتبر نیست.')
  if (!Number.isFinite(demand) || demand <= 0) return setStatus('تقاضای مشتری باید بزرگ‌تر از صفر باشد.')
  state.customers.push({
    id: crypto.randomUUID(),
    name: $('pointName').value.trim() || `مشتری ${state.customers.length + 1}`,
    lat, lng, demand,
  })
  $('pointName').value = ''
  $('lat').value = ''
  $('lng').value = ''
  $('demand').value = '1'
  clearResult()
  renderPoints()
  // Do not auto-fit here; preserve the user's current zoom and map position.
  setStatus('مشتری اضافه شد.')
}

function setDepotFromInputs() {
  const lat = parseCoordinate('lat', -90, 90)
  const lng = parseCoordinate('lng', -180, 180)
  if (lat === null || lng === null) return setStatus('مختصات دپو معتبر نیست.')
  state.depot = { id: 'depot', name: $('pointName').value.trim() || 'دپو', lat, lng }
  $('pointName').value = ''
  $('lat').value = ''
  $('lng').value = ''
  clearResult()
  renderPoints()
  // Registering a depot must not unexpectedly change the current viewport.
  if (!map.getBounds().contains([lat, lng])) map.panTo([lat, lng], { animate: false })
  setStatus('دپو تنظیم شد.')
}

function useMyLocation() {
  if (!navigator.geolocation) return setStatus('مرورگر شما موقعیت مکانی را پشتیبانی نمی‌کند.')
  setStatus('در حال دریافت موقعیت فعلی…')
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.depot = { id: 'depot', name: 'دپو / موقعیت من', lat: pos.coords.latitude, lng: pos.coords.longitude }
      clearResult()
      renderPoints()
      fitData()
      setStatus('موقعیت فعلی به‌عنوان دپو ثبت شد.')
    },
    () => setStatus('دسترسی به موقعیت مکانی داده نشد یا دریافت موقعیت ناموفق بود.'),
    { enableHighAccuracy: true, timeout: 10000 },
  )
}

function renderPoints() {
  state.pointLayers.forEach((layer) => layer.remove())
  state.pointLayers = []

  if (state.depot) {
    const icon = L.divIcon({ html: '<div class="depot-pin">D</div>', iconSize: [34, 34], iconAnchor: [17, 17] })
    const marker = L.marker([state.depot.lat, state.depot.lng], { icon })
      .bindPopup(`<b>${escapeHtml(state.depot.name)}</b><br>دپو`)
      .addTo(map)
    state.pointLayers.push(marker)
  }

  state.customers.forEach((customer, index) => {
    const icon = L.divIcon({ html: `<div class="customer-pin">${index + 1}</div>`, iconSize: [27, 27], iconAnchor: [13, 13] })
    const marker = L.marker([customer.lat, customer.lng], { icon }).addTo(map)
    marker.bindPopup(`<b>${escapeHtml(customer.name)}</b><br>تقاضا: ${fmt(customer.demand)}<br><button class="popup-delete" data-delete="${customer.id}">حذف مشتری</button>`)
    marker.on('popupopen', () => {
      const btn = document.querySelector(`[data-delete="${customer.id}"]`)
      btn?.addEventListener('click', () => removeCustomer(customer.id), { once: true })
    })
    state.pointLayers.push(marker)
  })
  updateStats()
  renderRegisteredPoints()
}

function removeCustomer(id) {
  const customer = state.customers.find((item) => item.id === id)
  if (!customer) return
  state.customers = state.customers.filter((item) => item.id !== id)
  clearResult()
  map.closePopup()
  renderPoints()
  // Keep the viewport unchanged while editing customer points.
  setStatus(`مشتری «${customer.name}» حذف شد.`)
}

function removeDepot() {
  if (!state.depot) return setStatus('دپویی برای حذف وجود ندارد.')
  const depotName = state.depot.name
  state.depot = null
  clearResult()
  map.closePopup()
  renderPoints()
  setStatus(`دپو «${depotName}» حذف شد. مشتری‌ها حفظ شدند.`)
}

function renderRegisteredPoints() {
  const container = $('registeredPoints')
  const totalPoints = state.customers.length + (state.depot ? 1 : 0)
  $('pointsSummary').textContent = totalPoints ? `${fmt(totalPoints, 0)} نقطه` : 'بدون نقطه'

  const rows = []
  if (state.depot) {
    rows.push(`
      <div class="point-row depot-row">
        <div class="point-row-main">
          <span class="point-kind depot-kind">D</span>
          <div>
            <b>${escapeHtml(state.depot.name)}</b>
            <small>${state.depot.lat.toFixed(5)}, ${state.depot.lng.toFixed(5)}</small>
          </div>
        </div>
        <button class="point-delete" type="button" data-remove-depot>حذف</button>
      </div>`)
  }

  state.customers.forEach((customer, index) => {
    rows.push(`
      <div class="point-row">
        <div class="point-row-main">
          <span class="point-kind">${index + 1}</span>
          <div>
            <b>${escapeHtml(customer.name)}</b>
            <small>تقاضا: ${fmt(customer.demand)} · ${customer.lat.toFixed(5)}, ${customer.lng.toFixed(5)}</small>
          </div>
        </div>
        <button class="point-delete" type="button" data-remove-customer="${customer.id}">حذف</button>
      </div>`)
  })

  container.innerHTML = rows.length ? rows.join('') : '<div class="points-empty">هنوز دپو یا مشتری ثبت نشده است.</div>'

  container.querySelector('[data-remove-depot]')?.addEventListener('click', removeDepot)
  container.querySelectorAll('[data-remove-customer]').forEach((button) => {
    button.addEventListener('click', () => removeCustomer(button.dataset.removeCustomer))
  })
  $('removeDepot').disabled = !state.depot
}

function updateStats() {
  $('customerCount').textContent = fmt(state.customers.length, 0)
  $('totalDemand').textContent = fmt(state.customers.reduce((sum, c) => sum + c.demand, 0))
}

function fitData() {
  const points = []
  if (state.depot) points.push([state.depot.lat, state.depot.lng])
  state.customers.forEach((c) => points.push([c.lat, c.lng]))
  state.routes.forEach((r) => points.push(...r.geometry))
  if (points.length === 1) map.setView(points[0], 13)
  else if (points.length > 1) map.fitBounds(points, { padding: [30, 30] })
}

const rad = (degree) => (degree * Math.PI) / 180
function haversineMeters(a, b) {
  const R = 6371000
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function fallbackMatrix(points) {
  const distances = points.map((a) => points.map((b) => haversineMeters(a, b) * 1.25))
  const durations = distances.map((row) => row.map((m) => (m / 1000 / 35) * 3600))
  return { distances, durations }
}

async function getRoadMatrix() {
  const points = [state.depot, ...state.customers]
  const fallback = fallbackMatrix(points)
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';')
  try {
    const response = await fetch(`${OSRM_BASE}/table/v1/driving/${coords}?annotations=distance,duration`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    if (data.code !== 'Ok' || !data.distances || !data.durations) throw new Error(data.message || 'پاسخ نامعتبر')
    return { distances: data.distances, durations: data.durations, source: 'osrm' }
  } catch (error) {
    return { ...fallback, source: 'fallback', warning: `OSRM برای ماتریس مسیر پاسخ نداد؛ حل موقتاً با فاصله تقریبی انجام شد. ${error.message || ''}` }
  }
}

async function getRouteGeometry(orderedCustomers) {
  const points = [state.depot, ...orderedCustomers, state.depot]
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';')
  try {
    const response = await fetch(`${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error(data.message || 'مسیر پیدا نشد')
    const route = data.routes[0]
    return {
      geometry: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      source: 'osrm',
    }
  } catch {
    const distanceMeters = points.slice(0, -1).reduce((sum, point, i) => sum + haversineMeters(point, points[i + 1]) * 1.25, 0)
    return {
      geometry: points.map((p) => [p.lat, p.lng]),
      distanceMeters,
      durationSeconds: (distanceMeters / 1000 / 35) * 3600,
      source: 'fallback',
    }
  }
}

function routeCost(route, distances) {
  if (!route.length) return 0
  let total = distances[0][route[0] + 1]
  for (let i = 0; i < route.length - 1; i++) total += distances[route[i] + 1][route[i + 1] + 1]
  return total + distances[route[route.length - 1] + 1][0]
}

function twoOpt(route, distances) {
  if (route.length < 4) return [...route]
  let best = [...route]
  let bestCost = routeCost(best, distances)
  let improved = true
  let guard = 0
  while (improved && guard++ < 25) {
    improved = false
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)]
        const cost = routeCost(candidate, distances)
        if (cost + 1e-6 < bestCost) {
          best = candidate
          bestCost = cost
          improved = true
        }
      }
    }
  }
  return best
}

function mergeVariants(a, b, distances) {
  return [
    [...a.indices, ...b.indices],
    [...a.indices, ...[...b.indices].reverse()],
    [...[...a.indices].reverse(), ...b.indices],
    [...[...a.indices].reverse(), ...[...b.indices].reverse()],
  ].map((indices) => ({ indices, cost: routeCost(indices, distances) })).sort((x, y) => x.cost - y.cost)[0]
}

function fallbackBinPack(capacity, vehicleCount, distances) {
  const order = state.customers.map((c, index) => ({ index, demand: c.demand })).sort((a, b) => b.demand - a.demand)
  const bins = Array.from({ length: vehicleCount }, () => ({ indices: [], load: 0 }))
  for (const item of order) {
    const candidates = bins.map((bin, i) => ({ i, remaining: capacity - bin.load })).filter((x) => x.remaining >= item.demand).sort((a, b) => a.remaining - b.remaining)
    if (!candidates.length) throw new Error('با این ظرفیت/تعداد خودرو، تخصیص مشتری‌ها ممکن نشد. تعداد خودرو یا ظرفیت را افزایش دهید.')
    const bin = bins[candidates[0].i]
    bin.indices.push(item.index)
    bin.load += item.demand
  }
  return bins.filter((b) => b.indices.length).map((bin) => {
    const unvisited = new Set(bin.indices)
    const ordered = []
    let current = 0
    while (unvisited.size) {
      const next = [...unvisited].sort((a, b) => distances[current][a + 1] - distances[current][b + 1])[0]
      ordered.push(next)
      unvisited.delete(next)
      current = next + 1
    }
    return { ...bin, indices: twoOpt(ordered, distances) }
  })
}

function solveCVRP(distances, capacity, vehicleCount) {
  if (!state.customers.length) throw new Error('حداقل یک مشتری اضافه کنید.')
  if (!Number.isFinite(capacity) || !Number.isFinite(vehicleCount) || capacity <= 0 || vehicleCount <= 0) throw new Error('ظرفیت و تعداد خودرو باید بزرگ‌تر از صفر باشد.')
  if (!Number.isInteger(vehicleCount)) throw new Error('تعداد خودرو باید عدد صحیح باشد.')
  if (state.customers.some((c) => c.demand <= 0)) throw new Error('تقاضای همه مشتری‌ها باید بزرگ‌تر از صفر باشد.')
  if (state.customers.some((c) => c.demand > capacity)) throw new Error('تقاضای حداقل یک مشتری از ظرفیت یک خودرو بیشتر است.')
  const totalDemand = state.customers.reduce((sum, c) => sum + c.demand, 0)
  if (totalDemand > capacity * vehicleCount) throw new Error('ظرفیت کل ناوگان برای پاسخ‌گویی به تقاضا کافی نیست.')

  const routes = state.customers.map((c, i) => ({ indices: [i], load: c.demand, active: true }))
  const routeOf = state.customers.map((_, i) => i)
  const savings = []
  for (let i = 0; i < state.customers.length; i++) {
    for (let j = i + 1; j < state.customers.length; j++) {
      savings.push({ i, j, value: distances[0][i + 1] + distances[0][j + 1] - distances[i + 1][j + 1] })
    }
  }
  savings.sort((a, b) => b.value - a.value)

  for (const saving of savings) {
    const ri = routeOf[saving.i]
    const rj = routeOf[saving.j]
    if (ri === rj) continue
    const a = routes[ri]
    const b = routes[rj]
    if (!a.active || !b.active || a.load + b.load > capacity) continue
    const aStart = a.indices[0] === saving.i
    const aEnd = a.indices.at(-1) === saving.i
    const bStart = b.indices[0] === saving.j
    const bEnd = b.indices.at(-1) === saving.j
    if (!(aStart || aEnd) || !(bStart || bEnd)) continue
    let merged
    if (aEnd && bStart) merged = [...a.indices, ...b.indices]
    else if (aStart && bEnd) merged = [...b.indices, ...a.indices]
    else if (aStart && bStart) merged = [...a.indices].reverse().concat(b.indices)
    else merged = a.indices.concat([...b.indices].reverse())
    a.indices = merged
    a.load += b.load
    b.active = false
    merged.forEach((idx) => { routeOf[idx] = ri })
  }

  let active = routes.filter((r) => r.active)
  while (active.length > vehicleCount) {
    let best = null
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i]
        const b = active[j]
        if (a.load + b.load > capacity) continue
        const merged = mergeVariants(a, b, distances)
        const extra = merged.cost - routeCost(a.indices, distances) - routeCost(b.indices, distances)
        if (!best || extra < best.extra) best = { a, b, indices: merged.indices, extra }
      }
    }
    if (!best) return fallbackBinPack(capacity, vehicleCount, distances)
    best.a.indices = best.indices
    best.a.load += best.b.load
    best.b.active = false
    active = routes.filter((r) => r.active)
  }
  return active.map((route) => ({ indices: twoOpt(route.indices, distances), load: route.load }))
}

async function solve() {
  if (!state.depot) return setStatus('ابتدا دپو را مشخص کنید.')
  if (!state.customers.length) return setStatus('حداقل یک مشتری اضافه کنید.')
  if (state.customers.length > 60) return setStatus('برای نسخهٔ عمومی، تعداد مشتری‌ها را حداکثر ۶۰ نگه دارید تا به سرویس عمومی فشار وارد نشود.')

  $('solveBtn').disabled = true
  clearResult()
  setStatus('در حال گرفتن ماتریس واقعی جاده‌ای و حل CVRP…')
  try {
    const capacity = Number($('vehicleCapacity').value)
    const vehicleCount = Number($('vehicleCount').value)
    const matrix = await getRoadMatrix()
    const solverRoutes = solveCVRP(matrix.distances, capacity, vehicleCount)
    const resultRoutes = []
    for (let i = 0; i < solverRoutes.length; i++) {
      setStatus(`در حال ساخت مسیر واقعی خودرو ${i + 1} از ${solverRoutes.length}…`)
      const sr = solverRoutes[i]
      const orderedCustomers = sr.indices.map((index) => state.customers[index])
      const road = await getRouteGeometry(orderedCustomers)
      resultRoutes.push({
        vehicleIndex: i,
        customerIds: orderedCustomers.map((c) => c.id),
        load: sr.load,
        ...road,
      })
    }
    state.routes = resultRoutes
    renderRoutes(matrix.warning)
    fitData()
    setStatus('حل انجام شد و مسیرها روی نقشه نمایش داده شدند.')
  } catch (error) {
    setStatus(error.message || 'خطایی در حل مسئله رخ داد.')
  } finally {
    $('solveBtn').disabled = false
  }
}

function renderRoutes(matrixWarning) {
  state.routeLayers.forEach((layer) => layer.remove())
  state.routeLayers = []
  $('routeGrid').innerHTML = ''

  let totalDistance = 0
  let totalDuration = 0
  let routeFallback = false
  state.routes.forEach((route) => {
    const color = ROUTE_COLORS[route.vehicleIndex % ROUTE_COLORS.length]
    const layer = L.polyline(route.geometry, { color, weight: 5, opacity: .82 }).addTo(map)
    state.routeLayers.push(layer)
    totalDistance += route.distanceMeters
    totalDuration += route.durationSeconds
    routeFallback ||= route.source === 'fallback'
    const names = route.customerIds.map((id) => state.customers.find((c) => c.id === id)?.name).filter(Boolean)
    const card = document.createElement('article')
    card.className = 'route-card'
    card.style.borderTopColor = color
    card.innerHTML = `
      <div class="route-title">🚚 خودرو ${fmt(route.vehicleIndex + 1, 0)}</div>
      <div class="route-metrics">
        <span>بار: <b>${fmt(route.load)}</b></span>
        <span>مسافت: <b>${fmt(route.distanceMeters / 1000)} km</b></span>
        <span>زمان: <b>${fmt(route.durationSeconds / 60, 0)} دقیقه</b></span>
      </div>
      <div class="sequence">دپو ← ${names.map(escapeHtml).join(' ← ')} ← دپو</div>`
    $('routeGrid').appendChild(card)
  })

  $('resultSubtitle').textContent = `${fmt(state.routes.length, 0)} مسیر خودرو ساخته شد.`
  $('totalDistance').textContent = `${fmt(totalDistance / 1000)} km`
  $('totalDuration').textContent = `${fmt(totalDuration / 3600, 2)} h`
  $('totals').classList.remove('hidden')

  const warning = matrixWarning || (routeFallback ? 'هندسهٔ حداقل یک مسیر از سرویس جاده‌ای دریافت نشد و به‌صورت تقریبی رسم شد.' : '')
  $('warning').textContent = warning
  $('warning').classList.toggle('hidden', !warning)
}

function clearResult() {
  state.routes = []
  state.routeLayers.forEach((layer) => layer.remove())
  state.routeLayers = []
  $('routeGrid').innerHTML = ''
  $('resultSubtitle').textContent = 'بعد از حل، جزئیات مسیرها اینجا نمایش داده می‌شود.'
  $('totals').classList.add('hidden')
  $('warning').classList.add('hidden')
}

function loadExample() {
  state.depot = { id: 'depot', name: 'دپو تهران', lat: 35.7219, lng: 51.3347 }
  state.customers = [
    { id: crypto.randomUUID(), name: 'ونک', lat: 35.7575, lng: 51.4090, demand: 3 },
    { id: crypto.randomUUID(), name: 'تجریش', lat: 35.8067, lng: 51.4280, demand: 2 },
    { id: crypto.randomUUID(), name: 'تهرانپارس', lat: 35.7292, lng: 51.5326, demand: 4 },
    { id: crypto.randomUUID(), name: 'آزادی', lat: 35.6997, lng: 51.3370, demand: 2 },
    { id: crypto.randomUUID(), name: 'بازار', lat: 35.6757, lng: 51.4215, demand: 3 },
    { id: crypto.randomUUID(), name: 'صادقیه', lat: 35.7212, lng: 51.3231, demand: 2 },
  ]
  $('vehicleCapacity').value = '8'
  $('vehicleCount').value = '2'
  clearResult()
  renderPoints()
  fitData()
  setStatus('داده نمونه بارگذاری شد؛ روی «حل و نمایش مسیر» بزنید.')
}

function reset() {
  state.depot = null
  state.customers = []
  clearResult()
  renderPoints()
  map.fitBounds(IRAN_BOUNDS, { padding: [12, 12], animate: false })
  setStatus('داده‌ها پاک شدند.')
}

function exportJson() {
  const payload = {
    depot: state.depot,
    customers: state.customers,
    vehicleCapacity: Number($('vehicleCapacity').value),
    vehicleCount: Number($('vehicleCount').value),
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'vrp-data.json'
  a.click()
  URL.revokeObjectURL(url)
}

function importJson(event) {
  const file = event.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result))
      if (!data.depot || !Array.isArray(data.customers)) throw new Error()
      state.depot = data.depot
      state.customers = data.customers
      if (data.vehicleCapacity) $('vehicleCapacity').value = String(data.vehicleCapacity)
      if (data.vehicleCount) $('vehicleCount').value = String(data.vehicleCount)
      clearResult()
      renderPoints()
      fitData()
      setStatus('فایل JSON وارد شد.')
    } catch {
      setStatus('ساختار فایل JSON معتبر نیست.')
    }
  }
  reader.readAsText(file)
  event.target.value = ''
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
}

$('modeCustomer').addEventListener('click', () => setMode('customer'))
$('modeDepot').addEventListener('click', () => setMode('depot'))
$('addCustomer').addEventListener('click', addCustomer)
$('setDepot').addEventListener('click', setDepotFromInputs)
$('myLocation').addEventListener('click', useMyLocation)
$('removeDepot').addEventListener('click', removeDepot)
$('solveBtn').addEventListener('click', solve)
$('sampleBtn').addEventListener('click', loadExample)
$('resetBtn').addEventListener('click', reset)
$('exportBtn').addEventListener('click', exportJson)
$('importFile').addEventListener('change', importJson)

setMode('customer')
renderPoints()
