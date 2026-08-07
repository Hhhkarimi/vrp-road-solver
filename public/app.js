const OSRM_BASE = 'https://router.project-osrm.org'
const ROUTE_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be123c', '#4f46e5']
const IRAN_BOUNDS = [[24.5, 44.0], [40.0, 63.5]]
const MAX_PUBLIC_POINTS = 50
const EXACT_MAX_CUSTOMERS = 12

const state = {
  mode: 'customer',
  depot: null,
  customers: [],
  vehicles: [
    { id: crypto.randomUUID(), name: 'وانت ۱', type: 'وانت', capacity: 8, enabled: true },
    { id: crypto.randomUUID(), name: 'کامیون ۱', type: 'کامیون سبک', capacity: 14, enabled: true },
  ],
  editingCustomerId: null,
  editingVehicleId: null,
  routes: [],
  routeLayers: [],
  pointLayers: [],
  selectionLayer: null,
  lastSolveMeta: null,
}

const $ = id => document.getElementById(id)
const fmt = (value, digits = 1) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits }).format(value)
const setStatus = message => { $('status').textContent = message }
const clampText = (value, max = 80) => String(value ?? '').trim().slice(0, max)

const map = L.map('map', { zoomControl: true })
map.fitBounds(IRAN_BOUNDS, { padding: [12, 12], animate: false })
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
}).addTo(map)

function clearSelectionPin() {
  if (state.selectionLayer) state.selectionLayer.remove()
  state.selectionLayer = null
  $('selectionHint').textContent = ' · برای انتخاب روی نقشه کلیک کنید'
}

function showSelectionPin(lat, lng) {
  clearSelectionPin()
  const modeClass = state.mode === 'depot' ? 'depot-selection' : 'customer-selection'
  const icon = L.divIcon({
    className: 'leaflet-div-icon selection-div-icon',
    html: `<div class="selection-pin-wrap"><span class="selection-pin ${modeClass}"></span><span class="selection-pulse"></span></div>`,
    iconSize: [38, 46],
    iconAnchor: [19, 43],
  })
  state.selectionLayer = L.marker([lat, lng], { icon, zIndexOffset: 1200, interactive: false }).addTo(map)
  $('selectionHint').textContent = state.mode === 'depot' ? ' · دپوی انتخاب‌شده؛ هنوز ثبت نشده' : ' · مشتری انتخاب‌شده؛ هنوز ثبت نشده'
}

function syncSelectionPinFromInputs() {
  const lat = parseCoordinate('lat', -90, 90)
  const lng = parseCoordinate('lng', -180, 180)
  if (lat === null || lng === null) return clearSelectionPin()
  showSelectionPin(lat, lng)
}

map.on('click', event => {
  const { lat, lng } = event.latlng
  $('lat').value = lat.toFixed(6)
  $('lng').value = lng.toFixed(6)
  showSelectionPin(lat, lng)
  setStatus(state.mode === 'depot'
    ? 'مختصات دپو انتخاب شد و پین موقت روی نقشه قرار گرفت؛ برای ثبت، دکمه «ثبت دپو» را بزنید.'
    : 'مختصات مشتری انتخاب شد و پین موقت محل را نشان می‌دهد؛ اطلاعات را کامل و ذخیره کنید.')
})

function setMode(mode, preserveForm = false) {
  state.mode = mode
  const customer = mode === 'customer'
  $('modeCustomer').classList.toggle('active', customer)
  $('modeDepot').classList.toggle('active', !customer)
  $('customerFields').classList.toggle('hidden', !customer)
  $('myLocation').classList.toggle('hidden', customer)
  $('modeBadge').textContent = customer ? 'انتخاب مشتری' : 'انتخاب دپو'
  $('pointName').placeholder = customer ? 'مثلاً مشتری ۱' : 'مثلاً انبار مرکزی'
  if (!preserveForm) { cancelPointEdit(false); clearSelectionPin() }
  updatePointSaveLabel()
}

function parseCoordinate(id, min, max) {
  const raw = $(id).value.trim()
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= min && value <= max ? value : null
}

function currentUnit() {
  if ($('capacityUnit').value === 'custom') return clampText($('customUnit').value, 24) || 'واحد دلخواه'
  return $('capacityUnit').value
}

function savePoint() {
  const lat = parseCoordinate('lat', -90, 90)
  const lng = parseCoordinate('lng', -180, 180)
  if (lat === null || lng === null) return setStatus('مختصات معتبر وارد کنید.')
  const name = clampText($('pointName').value) || (state.mode === 'depot' ? 'دپو' : `مشتری ${state.customers.length + 1}`)

  if (state.mode === 'depot') {
    state.depot = { id: 'depot', name, lat, lng }
    clearPointForm()
    clearSelectionPin()
    clearResult()
    renderPoints()
    setStatus(`دپو «${name}» دقیقاً با مختصات ثبت‌شده ذخیره شد.`)
    return
  }

  const demand = Number($('demand').value)
  const priority = Number($('priority').value)
  if (!Number.isFinite(demand) || demand <= 0) return setStatus('تقاضای مشتری باید بزرگ‌تر از صفر باشد.')
  if (!Number.isInteger(priority) || priority < 1 || priority > 5) return setStatus('اولویت مشتری معتبر نیست.')

  if (state.editingCustomerId) {
    const customer = state.customers.find(c => c.id === state.editingCustomerId)
    if (!customer) return cancelPointEdit()
    Object.assign(customer, { name, lat, lng, demand, priority })
    setStatus(`اطلاعات «${name}» ویرایش شد.`)
  } else {
    state.customers.push({ id: crypto.randomUUID(), name, lat, lng, demand, priority })
    setStatus(`مشتری «${name}» اضافه شد.`)
  }
  cancelPointEdit(false)
  clearPointForm()
  clearSelectionPin()
  clearResult()
  renderPoints()
}

function clearPointForm() {
  $('pointName').value = ''
  $('lat').value = ''
  $('lng').value = ''
  $('demand').value = '1'
  $('priority').value = '3'
}

function editCustomer(id) {
  const c = state.customers.find(x => x.id === id)
  if (!c) return
  setMode('customer', true)
  state.editingCustomerId = id
  $('pointName').value = c.name
  $('lat').value = c.lat.toFixed(6)
  $('lng').value = c.lng.toFixed(6)
  $('demand').value = String(c.demand)
  $('priority').value = String(c.priority ?? 3)
  showSelectionPin(c.lat, c.lng)
  $('cancelEdit').classList.remove('hidden')
  updatePointSaveLabel()
  setStatus(`در حال ویرایش «${c.name}». تغییرات را ذخیره کنید.`)
}

function editDepot() {
  if (!state.depot) return
  setMode('depot', true)
  $('pointName').value = state.depot.name
  $('lat').value = state.depot.lat.toFixed(6)
  $('lng').value = state.depot.lng.toFixed(6)
  showSelectionPin(state.depot.lat, state.depot.lng)
  $('cancelEdit').classList.remove('hidden')
  updatePointSaveLabel()
  setStatus('در حال ویرایش دپو. می‌توانید مختصات جدید را روی نقشه انتخاب کنید.')
}

function cancelPointEdit(clear = true) {
  state.editingCustomerId = null
  $('cancelEdit').classList.add('hidden')
  if (clear) { clearPointForm(); clearSelectionPin() }
  updatePointSaveLabel()
}

function updatePointSaveLabel() {
  if (state.mode === 'depot') $('savePoint').textContent = state.depot ? '✓ ذخیره دپو' : '▣ ثبت دپو'
  else $('savePoint').textContent = state.editingCustomerId ? '✓ ذخیره ویرایش مشتری' : '＋ افزودن مشتری'
}

function useMyLocation() {
  if (!navigator.geolocation) return setStatus('مرورگر شما موقعیت مکانی را پشتیبانی نمی‌کند.')
  setStatus('در حال دریافت موقعیت فعلی…')
  navigator.geolocation.getCurrentPosition(pos => {
    $('lat').value = pos.coords.latitude.toFixed(6)
    $('lng').value = pos.coords.longitude.toFixed(6)
    map.panTo([pos.coords.latitude, pos.coords.longitude], { animate: false })
    showSelectionPin(pos.coords.latitude, pos.coords.longitude)
    setStatus('موقعیت فعلی در فرم دپو قرار گرفت؛ برای ثبت، دکمه ذخیره را بزنید.')
  }, () => setStatus('دسترسی به موقعیت مکانی داده نشد یا دریافت موقعیت ناموفق بود.'), { enableHighAccuracy: true, timeout: 10000 })
}

function removeCustomer(id) {
  const customer = state.customers.find(c => c.id === id)
  if (!customer) return
  state.customers = state.customers.filter(c => c.id !== id)
  if (state.editingCustomerId === id) cancelPointEdit()
  clearResult()
  map.closePopup()
  renderPoints()
  setStatus(`مشتری «${customer.name}» حذف شد.`)
}

function removeDepot() {
  if (!state.depot) return
  const name = state.depot.name
  state.depot = null
  clearResult()
  map.closePopup()
  renderPoints()
  updatePointSaveLabel()
  setStatus(`دپو «${name}» حذف شد؛ مشتری‌ها باقی ماندند.`)
}

function renderPoints() {
  state.pointLayers.forEach(layer => layer.remove())
  state.pointLayers = []
  if (state.depot) {
    const icon = L.divIcon({ html: '<div class="depot-pin">D</div>', iconSize: [34, 34], iconAnchor: [17, 17] })
    const marker = L.marker([state.depot.lat, state.depot.lng], { icon }).addTo(map)
    marker.bindPopup(`<b>${escapeHtml(state.depot.name)}</b><br>دپو`)
    state.pointLayers.push(marker)
  }
  state.customers.forEach((customer, index) => {
    const icon = L.divIcon({ html: `<div class="customer-pin">${index + 1}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] })
    const marker = L.marker([customer.lat, customer.lng], { icon }).addTo(map)
    marker.bindPopup(`<b>${escapeHtml(customer.name)}</b><br>تقاضا: ${fmt(customer.demand)} ${escapeHtml(currentUnit())}<br>اولویت: ${fmt(customer.priority ?? 3, 0)}`)
    state.pointLayers.push(marker)
  })
  updateStats()
  renderRegisteredPoints()
}

function renderRegisteredPoints() {
  const container = $('registeredPoints')
  const total = state.customers.length + (state.depot ? 1 : 0)
  $('pointsSummary').textContent = total ? `${fmt(total, 0)} نقطه` : 'بدون نقطه'
  const rows = []
  if (state.depot) rows.push(`
    <div class="point-row depot-row"><div class="point-row-main"><span class="point-kind depot-kind">D</span><div><b>${escapeHtml(state.depot.name)}</b><small>${state.depot.lat.toFixed(5)}, ${state.depot.lng.toFixed(5)}</small></div></div><div class="row-actions"><button data-edit-depot>ویرایش</button><button class="danger-mini" data-remove-depot>حذف</button></div></div>`)
  state.customers.forEach((c, index) => rows.push(`
    <div class="point-row"><div class="point-row-main"><span class="point-kind">${index + 1}</span><div><b>${escapeHtml(c.name)}</b><small>${fmt(c.demand)} ${escapeHtml(currentUnit())} · اولویت ${fmt(c.priority ?? 3, 0)} · ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}</small></div></div><div class="row-actions"><button data-edit-customer="${c.id}">ویرایش</button><button class="danger-mini" data-remove-customer="${c.id}">حذف</button></div></div>`))
  container.innerHTML = rows.length ? rows.join('') : '<div class="points-empty">هنوز دپو یا مشتری ثبت نشده است.</div>'
  container.querySelector('[data-edit-depot]')?.addEventListener('click', editDepot)
  container.querySelector('[data-remove-depot]')?.addEventListener('click', removeDepot)
  container.querySelectorAll('[data-edit-customer]').forEach(btn => btn.addEventListener('click', () => editCustomer(btn.dataset.editCustomer)))
  container.querySelectorAll('[data-remove-customer]').forEach(btn => btn.addEventListener('click', () => removeCustomer(btn.dataset.removeCustomer)))
}

function updateStats() {
  $('customerCount').textContent = fmt(state.customers.length, 0)
  $('totalDemand').textContent = `${fmt(state.customers.reduce((s, c) => s + c.demand, 0))} ${currentUnit()}`
  $('totalCapacity').textContent = `${fmt(state.vehicles.filter(v => v.enabled).reduce((s, v) => s + v.capacity, 0))} ${currentUnit()}`
  $('demandUnitLabel').textContent = currentUnit()
  $('vehicleUnitLabel').textContent = currentUnit()
}

function fitData(includeRoutes = true) {
  const points = []
  if (state.depot) points.push([state.depot.lat, state.depot.lng])
  state.customers.forEach(c => points.push([c.lat, c.lng]))
  if (includeRoutes) state.routes.forEach(r => points.push(...r.geometry))
  if (points.length === 1) map.setView(points[0], 13, { animate: false })
  else if (points.length > 1) map.fitBounds(points, { padding: [30, 30], animate: false })
}

function saveVehicle() {
  const name = clampText($('vehicleName').value, 60) || `خودرو ${state.vehicles.length + 1}`
  const type = clampText($('vehicleType').value, 40) || 'خودرو'
  const capacity = Number($('vehicleCapacity').value)
  if (!Number.isFinite(capacity) || capacity <= 0) return setStatus('ظرفیت خودرو باید بزرگ‌تر از صفر باشد.')
  if (state.editingVehicleId) {
    const vehicle = state.vehicles.find(v => v.id === state.editingVehicleId)
    if (!vehicle) return cancelVehicleEdit()
    Object.assign(vehicle, { name, type, capacity })
    setStatus(`خودرو «${name}» ویرایش شد.`)
  } else {
    state.vehicles.push({ id: crypto.randomUUID(), name, type, capacity, enabled: true })
    setStatus(`خودرو «${name}» اضافه شد.`)
  }
  clearVehicleForm()
  cancelVehicleEdit(false)
  clearResult()
  renderVehicles()
  updateStats()
}

function clearVehicleForm() {
  $('vehicleName').value = ''
  $('vehicleType').value = ''
  $('vehicleCapacity').value = '10'
}

function editVehicle(id) {
  const v = state.vehicles.find(x => x.id === id)
  if (!v) return
  state.editingVehicleId = id
  $('vehicleName').value = v.name
  $('vehicleType').value = v.type
  $('vehicleCapacity').value = String(v.capacity)
  $('saveVehicle').textContent = '✓ ذخیره ویرایش خودرو'
  $('cancelVehicleEdit').classList.remove('hidden')
}

function cancelVehicleEdit(clear = true) {
  state.editingVehicleId = null
  $('saveVehicle').textContent = '＋ افزودن خودرو'
  $('cancelVehicleEdit').classList.add('hidden')
  if (clear) clearVehicleForm()
}

function toggleVehicle(id, enabled) {
  const v = state.vehicles.find(x => x.id === id)
  if (!v) return
  v.enabled = enabled
  clearResult()
  renderVehicles()
  updateStats()
}

function removeVehicle(id) {
  const v = state.vehicles.find(x => x.id === id)
  if (!v) return
  state.vehicles = state.vehicles.filter(x => x.id !== id)
  if (state.editingVehicleId === id) cancelVehicleEdit()
  clearResult()
  renderVehicles()
  updateStats()
  setStatus(`خودرو «${v.name}» حذف شد.`)
}

function renderVehicles() {
  const container = $('vehicleList')
  if (!state.vehicles.length) {
    container.innerHTML = '<div class="points-empty">هنوز خودرویی تعریف نشده است.</div>'
    return
  }
  container.innerHTML = state.vehicles.map(v => `
    <div class="vehicle-row ${v.enabled ? '' : 'disabled-row'}">
      <label class="vehicle-toggle"><input type="checkbox" data-toggle-vehicle="${v.id}" ${v.enabled ? 'checked' : ''}/><span></span></label>
      <div class="vehicle-info"><b>${escapeHtml(v.name)}</b><small>${escapeHtml(v.type)} · ظرفیت ${fmt(v.capacity)} ${escapeHtml(currentUnit())}</small></div>
      <div class="row-actions"><button data-edit-vehicle="${v.id}">ویرایش</button><button class="danger-mini" data-remove-vehicle="${v.id}">حذف</button></div>
    </div>`).join('')
  container.querySelectorAll('[data-toggle-vehicle]').forEach(el => el.addEventListener('change', () => toggleVehicle(el.dataset.toggleVehicle, el.checked)))
  container.querySelectorAll('[data-edit-vehicle]').forEach(el => el.addEventListener('click', () => editVehicle(el.dataset.editVehicle)))
  container.querySelectorAll('[data-remove-vehicle]').forEach(el => el.addEventListener('click', () => removeVehicle(el.dataset.removeVehicle)))
}

const rad = degree => degree * Math.PI / 180
function haversineMeters(a, b) {
  const R = 6371000
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function fallbackMatrix(points) {
  const distances = points.map(a => points.map(b => haversineMeters(a, b) * 1.25))
  const durations = distances.map(row => row.map(m => (m / 1000 / 35) * 3600))
  return { distances, durations }
}

const TRAFFIC_SCENARIOS = {
  base: { label: 'زمان پایه OSRM', alpha: 0 },
  light: { label: 'ترافیک مصنوعی سبک', alpha: 0.18 },
  moderate: { label: 'ترافیک مصنوعی متوسط', alpha: 0.38 },
  heavy: { label: 'ترافیک مصنوعی سنگین', alpha: 0.68 },
}

function syntheticTrafficDurations(baseDurations, points, scenarioKey) {
  const scenario = TRAFFIC_SCENARIOS[scenarioKey] || TRAFFIC_SCENARIOS.base
  if (!scenario.alpha) return baseDurations.map(row => [...row])
  const center = {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
  }
  const midpointDistances = []
  for (let i = 0; i < points.length; i++) {
    midpointDistances[i] = []
    for (let j = 0; j < points.length; j++) {
      const midpoint = { lat: (points[i].lat + points[j].lat) / 2, lng: (points[i].lng + points[j].lng) / 2 }
      midpointDistances[i][j] = haversineMeters(midpoint, center)
    }
  }
  const maxDistance = Math.max(1, ...midpointDistances.flat())
  return baseDurations.map((row, i) => row.map((seconds, j) => {
    if (i === j) return 0
    // Reproducible research scenario: OD pairs crossing the center of the study area
    // receive a larger delay. This is synthetic and not observed traffic data.
    const centrality = 1 - Math.min(1, midpointDistances[i][j] / maxDistance)
    const factor = 1 + scenario.alpha * (0.35 + 0.65 * centrality)
    return seconds * factor
  }))
}

function getObjectiveConfig(matrix) {
  const objective = $('objectiveMode').value
  if (objective === 'distance') {
    return { objective, costs: matrix.distances, scenario: 'none', label: 'فاصله جاده‌ای', unit: 'distance' }
  }
  const scenario = $('trafficScenario').value
  const points = [state.depot, ...state.customers]
  return {
    objective,
    costs: syntheticTrafficDurations(matrix.durations, points, scenario),
    scenario,
    label: scenario === 'base' && matrix.source !== 'osrm' ? 'زمان تقریبی fallback' : (TRAFFIC_SCENARIOS[scenario]?.label || 'زمان پایه OSRM'),
    unit: 'time',
  }
}

function formatObjective(value, objective) {
  return objective === 'time' ? `${fmt(value / 60, 1)} دقیقه` : `${fmt(value / 1000)} km`
}

function updateObjectiveUi() {
  const isTime = $('objectiveMode').value === 'time'
  $('trafficScenarioWrap').classList.toggle('hidden', !isTime)
  clearResult()
  setStatus(isTime
    ? 'تابع هدف زمان انتخاب شد. زمان پایه OSRM ترافیک واقعی نیست؛ در صورت انتخاب سناریو، ضرایب مصنوعی پژوهشی اعمال می‌شوند.'
    : 'تابع هدف فاصله جاده‌ای انتخاب شد.')
}

async function getRoadMatrix() {
  const points = [state.depot, ...state.customers]
  const fallback = fallbackMatrix(points)
  const coords = points.map(p => `${p.lng},${p.lat}`).join(';')
  try {
    const response = await fetch(`${OSRM_BASE}/table/v1/driving/${coords}?annotations=distance,duration`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    const invalid = data.code !== 'Ok' || !data.distances || !data.durations || data.distances.some(row => row.some(v => !Number.isFinite(v))) || data.durations.some(row => row.some(v => !Number.isFinite(v)))
    if (invalid) throw new Error(data.message || 'ماتریس ناقص')
    return { distances: data.distances, durations: data.durations, source: 'osrm' }
  } catch (error) {
    return { ...fallback, source: 'fallback', warning: `ماتریس OSRM در دسترس نبود؛ حل با تقریب فاصله هوایی × ۱٫۲۵ انجام شد. در این وضعیت حتی «حل دقیق» فقط نسبت به همین ماتریس تقریبی دقیق است. (${error.message || 'خطا'})` }
  }
}

async function getRouteGeometry(orderedCustomers) {
  const points = [state.depot, ...orderedCustomers, state.depot]
  const coords = points.map(p => `${p.lng},${p.lat}`).join(';')
  try {
    const response = await fetch(`${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error(data.message || 'مسیر پیدا نشد')
    const route = data.routes[0]
    return { geometry: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]), distanceMeters: route.distance, durationSeconds: route.duration, source: 'osrm' }
  } catch {
    const distanceMeters = points.slice(0, -1).reduce((s, p, i) => s + haversineMeters(p, points[i + 1]) * 1.25, 0)
    return { geometry: points.map(p => [p.lat, p.lng]), distanceMeters, durationSeconds: (distanceMeters / 1000 / 35) * 3600, source: 'fallback' }
  }
}

function runWorker(mode, objectiveConfig, vehicles, deadlineMs) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./solver-worker.js', { type: 'module' })
    const kill = setTimeout(() => {
      worker.terminate()
      reject(new Error('__TIMEOUT__'))
    }, deadlineMs + 1200)
    worker.onmessage = event => {
      clearTimeout(kill)
      worker.terminate()
      if (event.data?.ok) resolve(event.data.result)
      else reject(new Error(event.data?.error || 'خطای Solver'))
    }
    worker.onerror = () => {
      clearTimeout(kill)
      worker.terminate()
      reject(new Error('اجرای Web Worker حل مسئله ناموفق بود.'))
    }
    worker.postMessage({ command: 'solve', payload: {
      mode,
      costs: objectiveConfig.costs,
      objective: objectiveConfig.objective,
      customers: state.customers.map(c => ({ demand: c.demand, priority: c.priority ?? 3 })),
      vehicles: vehicles.map(v => ({ id: v.id, capacity: v.capacity })),
      deadlineMs,
    } })
  })
}

async function chooseSolver(objectiveConfig, vehicles) {
  const requested = $('solverMode').value
  if (requested === 'heuristic') return runWorker('heuristic', objectiveConfig, vehicles, 3500)
  if (requested === 'exact') {
    if (state.customers.length > EXACT_MAX_CUSTOMERS) throw new Error(`حل دقیق این نسخه حداکثر برای ${EXACT_MAX_CUSTOMERS} مشتری فعال شده است. حالت خودکار یا ابتکاری را انتخاب کنید.`)
    return runWorker('exact', objectiveConfig, vehicles, 12000)
  }
  if (state.customers.length <= EXACT_MAX_CUSTOMERS) {
    try {
      setStatus(`در حال تلاش برای حل دقیق و اثبات بهینگی ${objectiveConfig.objective === 'time' ? 'زمانی' : 'فاصله‌ای'}…`)
      return await runWorker('exact', objectiveConfig, vehicles, 4500)
    } catch (error) {
      if (!['__TIMEOUT__', '__TOO_LARGE__'].includes(error.message)) throw error
      setStatus('حل دقیق از حد محاسباتی حالت خودکار عبور کرد؛ در حال حل ابتکاری…')
    }
  }
  return runWorker('heuristic', objectiveConfig, vehicles, 3500)
}

async function solve() {
  if (!state.depot) return setStatus('ابتدا دپو را مشخص کنید.')
  if (!state.customers.length) return setStatus('حداقل یک مشتری اضافه کنید.')
  const vehicles = state.vehicles.filter(v => v.enabled)
  if (!vehicles.length) return setStatus('حداقل یک خودروی فعال تعریف کنید.')
  if (state.customers.length + 1 > MAX_PUBLIC_POINTS) return setStatus(`برای سرویس عمومی OSRM، حداکثر ${MAX_PUBLIC_POINTS - 1} مشتری در این نسخه مجاز است.`)
  const totalDemand = state.customers.reduce((s, c) => s + c.demand, 0)
  const totalCapacity = vehicles.reduce((s, v) => s + v.capacity, 0)
  if (totalDemand > totalCapacity + 1e-9) return setStatus('ظرفیت کل خودروهای فعال کمتر از تقاضای کل است.')

  $('solveBtn').disabled = true
  clearResult()
  try {
    setStatus('در حال دریافت ماتریس فاصله و زمان پایه جاده‌ای…')
    const matrix = await getRoadMatrix()
    const objectiveConfig = getObjectiveConfig(matrix)
    const solverResult = await chooseSolver(objectiveConfig, vehicles)
    const resultRoutes = []
    for (let i = 0; i < solverResult.routes.length; i++) {
      const sr = solverResult.routes[i]
      const vehicle = vehicles.find(v => v.id === sr.vehicleId)
      const orderedCustomers = sr.indices.map(index => state.customers[index])
      setStatus(`در حال دریافت هندسه مسیر ${i + 1} از ${solverResult.routes.length}…`)
      const road = await getRouteGeometry(orderedCustomers)
      resultRoutes.push({ ...road, vehicleId: sr.vehicleId, vehicle, customerIds: orderedCustomers.map(c => c.id), load: sr.load, objectiveValue: sr.objectiveValue })
    }
    state.routes = resultRoutes
    state.lastSolveMeta = { ...solverResult, matrixSource: matrix.source, objective: objectiveConfig.objective, objectiveLabel: objectiveConfig.label, trafficScenario: objectiveConfig.scenario }
    renderRoutes(matrix.warning)
    fitData(true)
    setStatus(solverResult.method === 'exact'
      ? `حل دقیق انجام شد؛ بهینگی نسبت به ماتریس ${objectiveConfig.objective === 'time' ? 'زمان' : 'فاصله'} استفاده‌شده تضمین شده است.`
      : 'حل ابتکاری انجام شد؛ جواب شدنی است اما تضمین بهینگی ندارد.')
  } catch (error) {
    const message = error.message === '__TIMEOUT__' ? 'حل در محدودیت زمانی مرورگر کامل نشد؛ حالت خودکار یا ابتکاری را انتخاب کنید.' : error.message
    setStatus(message || 'خطایی در حل مسئله رخ داد.')
  } finally {
    $('solveBtn').disabled = false
  }
}

function renderRoutes(matrixWarning) {
  state.routeLayers.forEach(layer => layer.remove())
  state.routeLayers = []
  $('routeGrid').innerHTML = ''
  let totalRoadDistance = 0
  let totalDuration = 0
  let routeFallback = false

  state.routes.forEach((route, i) => {
    const color = ROUTE_COLORS[i % ROUTE_COLORS.length]
    const layer = L.polyline(route.geometry, { color, weight: 5, opacity: .84 }).addTo(map)
    state.routeLayers.push(layer)
    totalRoadDistance += route.distanceMeters
    totalDuration += route.durationSeconds
    routeFallback ||= route.source === 'fallback'
    const customers = route.customerIds.map(id => state.customers.find(c => c.id === id)).filter(Boolean)
    const card = document.createElement('article')
    card.className = 'route-card'
    card.style.borderTopColor = color
    card.innerHTML = `
      <div class="route-title">🚚 ${escapeHtml(route.vehicle?.name || `خودرو ${i + 1}`)} <small>${escapeHtml(route.vehicle?.type || '')}</small></div>
      <div class="route-metrics"><span>بار: <b>${fmt(route.load)} ${escapeHtml(currentUnit())}</b></span><span>ظرفیت: <b>${fmt(route.vehicle?.capacity || 0)} ${escapeHtml(currentUnit())}</b></span><span>هزینه تابع هدف: <b>${formatObjective(route.objectiveValue, state.lastSolveMeta?.objective)}</b></span><span>مسیر رسم‌شده: <b>${fmt(route.distanceMeters / 1000)} km</b></span><span>زمان پایه OSRM: <b>${fmt(route.durationSeconds / 60, 0)} دقیقه</b></span></div>
      <div class="sequence">دپو ← ${customers.map(c => `${escapeHtml(c.name)} <small>(اولویت ${fmt(c.priority ?? 3, 0)})</small>`).join(' ← ')} ← دپو</div>`
    $('routeGrid').appendChild(card)
  })

  const meta = state.lastSolveMeta
  const exact = meta?.method === 'exact'
  $('solutionBadge').className = `solution-badge ${exact ? 'exact' : 'heuristic'}`
  $('solutionBadge').innerHTML = exact
    ? `<b>حل دقیق</b><span>بهینگی ${meta.objective === 'time' ? 'زمانی' : 'فاصله‌ای'} نسبت به ماتریس ${meta.matrixSource === 'osrm' ? 'OSRM' : 'تقریبی'}${meta.objective === 'time' && meta.trafficScenario !== 'base' ? ' + سناریوی مصنوعی' : ''} تضمین شده · ${fmt(meta.elapsedMs / 1000, 2)} ثانیه</span>`
    : `<b>حل ابتکاری</b><span>بدون تضمین بهینگی · ${fmt(meta?.elapsedMs / 1000 || 0, 2)} ثانیه · برای مسائل بزرگ‌تر/سریع</span>`
  $('solutionBadge').classList.remove('hidden')
  $('resultSubtitle').textContent = `${fmt(state.routes.length, 0)} مسیر برای ${fmt(state.customers.length, 0)} مشتری ساخته شد. تابع هدف: ${meta?.objective === 'time' ? meta.objectiveLabel : 'فاصله جاده‌ای'}.`
  $('objectiveTotalLabel').textContent = meta?.objective === 'time' ? `تابع هدف · ${meta.objectiveLabel}` : 'تابع هدف · فاصله'
  $('objectiveTotal').textContent = formatObjective(meta?.objectiveValue ?? 0, meta?.objective)
  $('totalDistance').textContent = `${fmt(totalRoadDistance / 1000)} km`
  $('totalDuration').textContent = `${fmt(totalDuration / 3600, 2)} h`
  $('totals').classList.remove('hidden')
  $('durationNote').classList.remove('hidden')

  const warnings = []
  if (matrixWarning) warnings.push(matrixWarning)
  if (routeFallback) warnings.push('هندسه حداقل یک مسیر از OSRM دریافت نشد و آن بخش به‌صورت تقریبی رسم شد.')
  if (meta?.objective === 'time' && meta.trafficScenario !== 'base') warnings.push('سناریوی ترافیک انتخاب‌شده مصنوعی و برای تحلیل حساسیت است؛ داده زنده، تاریخی یا پیش‌بینی‌شده محسوب نمی‌شود.')
  else warnings.push('ترافیک زنده/تاریخی در داده OSRM لحاظ نشده است.')
  warnings.push('پنجره زمانی، زمان سرویس و محدودیت تخصصی کامیون در مدل فعلی لحاظ نشده‌اند.')
  $('warning').textContent = warnings.join(' ')
  $('warning').classList.remove('hidden')
}

function clearResult() {
  state.routes = []
  state.lastSolveMeta = null
  state.routeLayers.forEach(layer => layer.remove())
  state.routeLayers = []
  $('routeGrid').innerHTML = ''
  $('resultSubtitle').textContent = 'بعد از حل، روش، کیفیت و جزئیات مسیرها اینجا نمایش داده می‌شود.'
  $('totals').classList.add('hidden')
  $('solutionBadge').classList.add('hidden')
  $('warning').classList.add('hidden')
  $('durationNote').classList.add('hidden')
}

function loadExample() {
  state.depot = { id: 'depot', name: 'انبار مرکزی تهران', lat: 35.7219, lng: 51.3347 }
  state.customers = [
    { id: crypto.randomUUID(), name: 'ونک', lat: 35.7575, lng: 51.4090, demand: 3, priority: 5 },
    { id: crypto.randomUUID(), name: 'تجریش', lat: 35.8067, lng: 51.4280, demand: 2, priority: 4 },
    { id: crypto.randomUUID(), name: 'تهرانپارس', lat: 35.7292, lng: 51.5326, demand: 4, priority: 3 },
    { id: crypto.randomUUID(), name: 'آزادی', lat: 35.6997, lng: 51.3370, demand: 2, priority: 2 },
    { id: crypto.randomUUID(), name: 'بازار', lat: 35.6757, lng: 51.4215, demand: 3, priority: 5 },
    { id: crypto.randomUUID(), name: 'صادقیه', lat: 35.7212, lng: 51.3231, demand: 2, priority: 3 },
  ]
  state.vehicles = [
    { id: crypto.randomUUID(), name: 'وانت A', type: 'وانت', capacity: 7, enabled: true },
    { id: crypto.randomUUID(), name: 'کامیون B', type: 'کامیون سبک', capacity: 10, enabled: true },
  ]
  $('capacityUnit').value = 'بسته'
  $('customUnitWrap').classList.add('hidden')
  clearSelectionPin()
  clearResult()
  renderPoints()
  renderVehicles()
  fitData(false)
  updateStats()
  setStatus('داده نمونه تهران بارگذاری شد. حالت خودکار ابتدا حل دقیق را امتحان می‌کند.')
}

function resetAll() {
  state.depot = null
  state.customers = []
  state.vehicles = []
  cancelPointEdit()
  cancelVehicleEdit()
  clearSelectionPin()
  clearResult()
  renderPoints()
  renderVehicles()
  map.fitBounds(IRAN_BOUNDS, { padding: [12, 12], animate: false })
  setStatus('همه داده‌های مسئله پاک شدند.')
}

function exportJson() {
  const payload = { version: '2.1.0', app: 'OptiMasir', unit: currentUnit(), objective: $('objectiveMode').value, trafficScenario: $('trafficScenario').value, depot: state.depot, customers: state.customers, vehicles: state.vehicles }
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'optimasi-data.json'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function sanitizeImportedData(data) {
  if (!data || typeof data !== 'object') throw new Error('ساختار فایل معتبر نیست.')
  const depot = data.depot == null ? null : sanitizePoint(data.depot, true)
  if (!Array.isArray(data.customers) || data.customers.length > MAX_PUBLIC_POINTS - 1) throw new Error('لیست مشتری‌ها معتبر نیست یا بیش از حد بزرگ است.')
  const customers = data.customers.map(x => ({ ...sanitizePoint(x, false), id: crypto.randomUUID(), demand: positiveNumber(x.demand), priority: validPriority(x.priority) }))
  let vehicleData = data.vehicles
  if (!Array.isArray(vehicleData) && Number.isFinite(Number(data.vehicleCapacity)) && Number.isInteger(Number(data.vehicleCount)) && Number(data.vehicleCount) > 0) {
    const count = Math.min(Number(data.vehicleCount), 30)
    vehicleData = Array.from({ length: count }, (_, i) => ({ name: `خودرو ${i + 1}`, type: 'ناوگان قدیمی', capacity: Number(data.vehicleCapacity), enabled: true }))
  }
  if (!Array.isArray(vehicleData) || vehicleData.length > 30) throw new Error('لیست خودروها معتبر نیست.')
  const vehicles = vehicleData.map(v => ({ id: crypto.randomUUID(), name: clampText(v.name, 60) || 'خودرو', type: clampText(v.type, 40) || 'خودرو', capacity: positiveNumber(v.capacity), enabled: v.enabled !== false }))
  return { depot, customers, vehicles, unit: clampText(data.unit, 24) || 'واحد', objective: data.objective === 'time' ? 'time' : 'distance', trafficScenario: TRAFFIC_SCENARIOS[data.trafficScenario] ? data.trafficScenario : 'base' }
}

function sanitizePoint(p, depot) {
  const lat = Number(p?.lat), lng = Number(p?.lng)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error('مختصات فایل ورودی معتبر نیست.')
  return { id: depot ? 'depot' : crypto.randomUUID(), name: clampText(p.name) || (depot ? 'دپو' : 'مشتری'), lat, lng }
}
function positiveNumber(v) { const n = Number(v); if (!Number.isFinite(n) || n <= 0) throw new Error('مقدار ظرفیت/تقاضا در فایل معتبر نیست.'); return n }
function validPriority(v) { const n = Number(v ?? 3); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 3 }

function importJson(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (file.size > 1_000_000) { setStatus('فایل JSON بیش از ۱ مگابایت است.'); event.target.value = ''; return }
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = sanitizeImportedData(JSON.parse(String(reader.result)))
      state.depot = parsed.depot
      state.customers = parsed.customers
      state.vehicles = parsed.vehicles
      const standard = [...$('capacityUnit').options].some(o => o.value === parsed.unit)
      if (standard) $('capacityUnit').value = parsed.unit
      else { $('capacityUnit').value = 'custom'; $('customUnit').value = parsed.unit; $('customUnitWrap').classList.remove('hidden') }
      $('objectiveMode').value = parsed.objective
      $('trafficScenario').value = parsed.trafficScenario
      $('trafficScenarioWrap').classList.toggle('hidden', parsed.objective !== 'time')
      clearSelectionPin(); clearResult(); renderPoints(); renderVehicles(); updateStats(); fitData(false)
      setStatus('فایل JSON با اعتبارسنجی ورودی بارگذاری شد.')
    } catch (error) { setStatus(error.message || 'ساختار فایل JSON معتبر نیست.') }
  }
  reader.readAsText(file)
  event.target.value = ''
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
}

$('modeCustomer').addEventListener('click', () => setMode('customer'))
$('modeDepot').addEventListener('click', () => setMode('depot'))
$('savePoint').addEventListener('click', savePoint)
$('cancelEdit').addEventListener('click', () => cancelPointEdit())
$('myLocation').addEventListener('click', useMyLocation)
$('fitPoints').addEventListener('click', () => fitData(false))
$('saveVehicle').addEventListener('click', saveVehicle)
$('cancelVehicleEdit').addEventListener('click', () => cancelVehicleEdit())
$('capacityUnit').addEventListener('change', () => { $('customUnitWrap').classList.toggle('hidden', $('capacityUnit').value !== 'custom'); updateStats(); renderPoints(); renderVehicles() })
$('customUnit').addEventListener('input', () => { updateStats(); renderRegisteredPoints(); renderVehicles() })
$('lat').addEventListener('change', syncSelectionPinFromInputs)
$('lng').addEventListener('change', syncSelectionPinFromInputs)
$('objectiveMode').addEventListener('change', updateObjectiveUi)
$('trafficScenario').addEventListener('change', () => { clearResult(); setStatus(`سناریوی ${TRAFFIC_SCENARIOS[$('trafficScenario').value]?.label || 'زمان'} انتخاب شد.`) })
$('solveBtn').addEventListener('click', solve)
$('sampleBtn').addEventListener('click', loadExample)
$('resetBtn').addEventListener('click', resetAll)
$('exportBtn').addEventListener('click', exportJson)
$('importFile').addEventListener('change', importJson)

setMode('customer')
renderPoints()
renderVehicles()
updateStats()
