const OSRM_BASE = 'https://router.project-osrm.org'
const ROUTE_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be123c', '#4f46e5']
const IRAN_BOUNDS = [[24.5, 44.0], [40.0, 63.5]]
const MAX_PUBLIC_POINTS = 50
const EXACT_MAX_CUSTOMERS = 12
let appBootCompleted = false


function showRuntimeError(message) {
  const mapEl = document.getElementById('map')
  if (!mapEl) return
  mapEl.classList.add('map-load-failed')
  let box = mapEl.querySelector('.map-error')
  if (!box) {
    box = document.createElement('div')
    box.className = 'map-error'
    mapEl.appendChild(box)
  }
  box.textContent = `خطا در راه‌اندازی نقشه: ${String(message || 'خطای ناشناخته')}`
}

window.addEventListener('error', event => {
  if (!appBootCompleted && event?.message) showRuntimeError(event.message)
})
window.addEventListener('unhandledrejection', event => {
  if (appBootCompleted) return
  const reason = event?.reason
  showRuntimeError(reason?.message || reason || 'Promise rejected')
})

function makeId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    try { return globalThis.crypto.randomUUID() } catch {}
  }
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16)
    globalThis.crypto.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

const $ = id => document.getElementById(id)
const fmt = (value, digits = 1) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits }).format(Number(value) || 0)
const setStatus = message => { $('status').textContent = message }
const clampText = (value, max = 80) => String(value ?? '').trim().slice(0, max)
const numericOrNull = value => {
  if (value === '' || value == null) return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}
const nonNegative = value => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function makeVehicle(input = {}) {
  return {
    id: input.id || makeId(),
    name: clampText(input.name, 60) || 'خودرو',
    type: clampText(input.type, 40) || 'خودرو',
    capacity: Number(input.capacity) > 0 ? Number(input.capacity) : 10,
    enabled: input.enabled !== false,
    fixedCost: nonNegative(input.fixedCost),
    costPerKm: nonNegative(input.costPerKm),
    costPerMinute: nonNegative(input.costPerMinute),
    maxDistanceKm: numericOrNull(input.maxDistanceKm),
    maxDurationMin: numericOrNull(input.maxDurationMin),
    maxStops: Number.isInteger(Number(input.maxStops)) && Number(input.maxStops) > 0 ? Number(input.maxStops) : null,
    returnToDepot: input.returnToDepot !== false,
  }
}

const state = {
  mode: 'customer',
  depot: null,
  customers: [],
  vehicles: [
    makeVehicle({ name: 'وانت ۱', type: 'وانت', capacity: 8, fixedCost: 350000, costPerKm: 12000, costPerMinute: 1500 }),
    makeVehicle({ name: 'کامیون ۱', type: 'کامیون سبک', capacity: 14, fixedCost: 700000, costPerKm: 18000, costPerMinute: 2200 }),
  ],
  editingCustomerId: null,
  editingVehicleId: null,
  routes: [],
  routeLayers: [],
  pointLayers: [],
  selectionLayer: null,
  lastSolveMeta: null,
  pendingImport: null,
}

if (typeof window.L === 'undefined') {
  const mapEl = $('map')
  if (mapEl) {
    mapEl.classList.add('map-load-failed')
    const box = document.createElement('div')
    box.className = 'map-error'
    box.textContent = 'کتابخانه نقشه بارگذاری نشد. صفحه را یک‌بار Hard Refresh کنید؛ اگر مشکل ادامه داشت، Deploy را دوباره انجام دهید.'
    mapEl.appendChild(box)
  }
  setStatus('خطا در بارگذاری کتابخانه نقشه. فایل Leaflet از خروجی Deploy در دسترس نیست.')
  throw new Error('Leaflet failed to load')
}

const L = window.L
const map = L.map('map', { zoomControl: true })
map.fitBounds(IRAN_BOUNDS, { padding: [12, 12], animate: false })
const baseTiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
}).addTo(map)
let tileErrorReported = false
baseTiles.on('tileerror', () => {
  if (tileErrorReported) return
  tileErrorReported = true
  setStatus('خود نقشه آماده است، اما کاشی‌های OpenStreetMap دریافت نشدند. اتصال شبکه یا دسترسی به tile.openstreetmap.org را بررسی کنید.')
})
baseTiles.on('load', () => { tileErrorReported = false })

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
    iconSize: [38, 46], iconAnchor: [19, 43],
  })
  state.selectionLayer = L.marker([lat, lng], { icon, zIndexOffset: 1200, interactive: false }).addTo(map)
  $('selectionHint').textContent = state.mode === 'depot' ? ' · دپوی انتخاب‌شده؛ هنوز ثبت نشده' : ' · مشتری انتخاب‌شده؛ هنوز ثبت نشده'
}

function syncSelectionPinFromInputs() {
  const lat = parseCoordinate('lat', -90, 90), lng = parseCoordinate('lng', -180, 180)
  if (lat === null || lng === null) return clearSelectionPin()
  showSelectionPin(lat, lng)
}

map.on('click', event => {
  const { lat, lng } = event.latlng
  $('lat').value = lat.toFixed(6); $('lng').value = lng.toFixed(6)
  showSelectionPin(lat, lng)
  setStatus(state.mode === 'depot' ? 'مختصات دپو انتخاب شد؛ برای ثبت دکمه ذخیره را بزنید.' : 'پین موقت محل مشتری را نشان می‌دهد؛ اطلاعات را کامل و ذخیره کنید.')
})

function setMode(mode, preserveForm = false) {
  state.mode = mode
  const customer = mode === 'customer'
  $('modeCustomer').classList.toggle('active', customer); $('modeDepot').classList.toggle('active', !customer)
  $('customerFields').classList.toggle('hidden', !customer); $('myLocation').classList.toggle('hidden', customer)
  $('modeBadge').textContent = customer ? 'انتخاب مشتری' : 'انتخاب دپو'
  $('pointName').placeholder = customer ? 'مثلاً مشتری ۱' : 'مثلاً انبار مرکزی'
  if (!preserveForm) { cancelPointEdit(false); clearSelectionPin() }
  updatePointSaveLabel()
}

function parseCoordinate(id, min, max) {
  const raw = $(id).value.trim(); if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= min && value <= max ? value : null
}

function currentUnit() {
  if ($('capacityUnit').value === 'custom') return clampText($('customUnit').value, 24) || 'واحد دلخواه'
  return $('capacityUnit').value
}
function currentCostUnit() { return $('costUnit').value || 'واحد پول' }

function savePoint() {
  const lat = parseCoordinate('lat', -90, 90), lng = parseCoordinate('lng', -180, 180)
  if (lat === null || lng === null) return setStatus('مختصات معتبر وارد کنید.')
  const name = clampText($('pointName').value) || (state.mode === 'depot' ? 'دپو' : `مشتری ${state.customers.length + 1}`)
  if (state.mode === 'depot') {
    state.depot = { id: 'depot', name, lat, lng }
    clearPointForm(); clearSelectionPin(); clearResult(); renderPoints()
    setStatus(`دپو «${name}» دقیقاً با مختصات ثبت‌شده ذخیره شد.`); return
  }
  const demand = Number($('demand').value), priority = Number($('priority').value)
  if (!Number.isFinite(demand) || demand <= 0) return setStatus('تقاضای مشتری باید بزرگ‌تر از صفر باشد.')
  if (!Number.isInteger(priority) || priority < 1 || priority > 5) return setStatus('اولویت مشتری معتبر نیست.')
  if (state.editingCustomerId) {
    const customer = state.customers.find(c => c.id === state.editingCustomerId)
    if (!customer) return cancelPointEdit()
    Object.assign(customer, { name, lat, lng, demand, priority }); setStatus(`اطلاعات «${name}» ویرایش شد.`)
  } else {
    state.customers.push({ id: makeId(), name, lat, lng, demand, priority }); setStatus(`مشتری «${name}» اضافه شد.`)
  }
  cancelPointEdit(false); clearPointForm(); clearSelectionPin(); clearResult(); renderPoints()
}

function clearPointForm() { $('pointName').value = ''; $('lat').value = ''; $('lng').value = ''; $('demand').value = '1'; $('priority').value = '3' }
function editCustomer(id) {
  const c = state.customers.find(x => x.id === id); if (!c) return
  setMode('customer', true); state.editingCustomerId = id
  $('pointName').value = c.name; $('lat').value = c.lat.toFixed(6); $('lng').value = c.lng.toFixed(6); $('demand').value = String(c.demand); $('priority').value = String(c.priority ?? 3)
  showSelectionPin(c.lat, c.lng); $('cancelEdit').classList.remove('hidden'); updatePointSaveLabel(); setStatus(`در حال ویرایش «${c.name}».`)
}
function editDepot() {
  if (!state.depot) return
  setMode('depot', true); $('pointName').value = state.depot.name; $('lat').value = state.depot.lat.toFixed(6); $('lng').value = state.depot.lng.toFixed(6)
  showSelectionPin(state.depot.lat, state.depot.lng); $('cancelEdit').classList.remove('hidden'); updatePointSaveLabel(); setStatus('در حال ویرایش دپو.')
}
function cancelPointEdit(clear = true) { state.editingCustomerId = null; $('cancelEdit').classList.add('hidden'); if (clear) { clearPointForm(); clearSelectionPin() } updatePointSaveLabel() }
function updatePointSaveLabel() { $('savePoint').textContent = state.mode === 'depot' ? (state.depot ? '✓ ذخیره دپو' : '▣ ثبت دپو') : (state.editingCustomerId ? '✓ ذخیره ویرایش مشتری' : '＋ افزودن مشتری') }

function useMyLocation() {
  if (!navigator.geolocation) return setStatus('مرورگر شما موقعیت مکانی را پشتیبانی نمی‌کند.')
  setStatus('در حال دریافت موقعیت فعلی…')
  navigator.geolocation.getCurrentPosition(pos => {
    $('lat').value = pos.coords.latitude.toFixed(6); $('lng').value = pos.coords.longitude.toFixed(6)
    map.panTo([pos.coords.latitude, pos.coords.longitude], { animate: false }); showSelectionPin(pos.coords.latitude, pos.coords.longitude)
    setStatus('موقعیت فعلی در فرم دپو قرار گرفت؛ برای ثبت دکمه ذخیره را بزنید.')
  }, () => setStatus('دریافت موقعیت ناموفق بود.'), { enableHighAccuracy: true, timeout: 10000 })
}

function removeCustomer(id) { const c = state.customers.find(x => x.id === id); if (!c) return; state.customers = state.customers.filter(x => x.id !== id); if (state.editingCustomerId === id) cancelPointEdit(); clearResult(); renderPoints(); setStatus(`مشتری «${c.name}» حذف شد.`) }
function removeDepot() { if (!state.depot) return; const name = state.depot.name; state.depot = null; clearResult(); renderPoints(); updatePointSaveLabel(); setStatus(`دپو «${name}» حذف شد؛ مشتری‌ها باقی ماندند.`) }

function renderPoints() {
  state.pointLayers.forEach(layer => layer.remove()); state.pointLayers = []
  if (state.depot) {
    const icon = L.divIcon({ html: '<div class="depot-pin">D</div>', iconSize: [34, 34], iconAnchor: [17, 17] })
    const marker = L.marker([state.depot.lat, state.depot.lng], { icon }).addTo(map); marker.bindPopup(`<b>${escapeHtml(state.depot.name)}</b><br>دپو`); state.pointLayers.push(marker)
  }
  state.customers.forEach((c, index) => {
    const icon = L.divIcon({ html: `<div class="customer-pin">${index + 1}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] })
    const marker = L.marker([c.lat, c.lng], { icon }).addTo(map); marker.bindPopup(`<b>${escapeHtml(c.name)}</b><br>تقاضا: ${fmt(c.demand)} ${escapeHtml(currentUnit())}<br>اولویت: ${fmt(c.priority ?? 3, 0)}`); state.pointLayers.push(marker)
  })
  updateStats(); renderRegisteredPoints()
}

function renderRegisteredPoints() {
  const container = $('registeredPoints'), total = state.customers.length + (state.depot ? 1 : 0)
  $('pointsSummary').textContent = total ? `${fmt(total, 0)} نقطه` : 'بدون نقطه'
  const rows = []
  if (state.depot) rows.push(`<div class="point-row depot-row"><div class="point-row-main"><span class="point-kind depot-kind">D</span><div><b>${escapeHtml(state.depot.name)}</b><small>${state.depot.lat.toFixed(5)}, ${state.depot.lng.toFixed(5)}</small></div></div><div class="row-actions"><button data-edit-depot>ویرایش</button><button class="danger-mini" data-remove-depot>حذف</button></div></div>`)
  state.customers.forEach((c, index) => rows.push(`<div class="point-row"><div class="point-row-main"><span class="point-kind">${index + 1}</span><div><b>${escapeHtml(c.name)}</b><small>${fmt(c.demand)} ${escapeHtml(currentUnit())} · اولویت ${fmt(c.priority ?? 3, 0)} · ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}</small></div></div><div class="row-actions"><button data-edit-customer="${c.id}">ویرایش</button><button class="danger-mini" data-remove-customer="${c.id}">حذف</button></div></div>`))
  container.innerHTML = rows.length ? rows.join('') : '<div class="points-empty">هنوز دپو یا مشتری ثبت نشده است.</div>'
  container.querySelector('[data-edit-depot]')?.addEventListener('click', editDepot); container.querySelector('[data-remove-depot]')?.addEventListener('click', removeDepot)
  container.querySelectorAll('[data-edit-customer]').forEach(btn => btn.addEventListener('click', () => editCustomer(btn.dataset.editCustomer)))
  container.querySelectorAll('[data-remove-customer]').forEach(btn => btn.addEventListener('click', () => removeCustomer(btn.dataset.removeCustomer)))
}

function updateStats() {
  $('customerCount').textContent = fmt(state.customers.length, 0)
  $('totalDemand').textContent = `${fmt(state.customers.reduce((s, c) => s + c.demand, 0))} ${currentUnit()}`
  $('totalCapacity').textContent = `${fmt(state.vehicles.filter(v => v.enabled).reduce((s, v) => s + v.capacity, 0))} ${currentUnit()}`
  $('demandUnitLabel').textContent = currentUnit(); $('vehicleUnitLabel').textContent = currentUnit()
}

function fitData(includeRoutes = true) {
  const points = []; if (state.depot) points.push([state.depot.lat, state.depot.lng]); state.customers.forEach(c => points.push([c.lat, c.lng])); if (includeRoutes) state.routes.forEach(r => points.push(...r.geometry))
  if (points.length === 1) map.setView(points[0], 13, { animate: false }); else if (points.length > 1) map.fitBounds(points, { padding: [30, 30], animate: false })
}

function vehicleFromForm() {
  const capacity = Number($('vehicleCapacity').value)
  if (!Number.isFinite(capacity) || capacity <= 0) throw new Error('ظرفیت خودرو باید بزرگ‌تر از صفر باشد.')
  const maxStopsRaw = $('vehicleMaxStops').value.trim(); const maxStops = maxStopsRaw ? Number(maxStopsRaw) : null
  if (maxStopsRaw && (!Number.isInteger(maxStops) || maxStops <= 0)) throw new Error('حداکثر توقف باید عدد صحیح مثبت باشد.')
  return makeVehicle({
    id: state.editingVehicleId || undefined,
    name: clampText($('vehicleName').value, 60) || `خودرو ${state.vehicles.length + 1}`,
    type: clampText($('vehicleType').value, 40) || 'خودرو', capacity,
    fixedCost: $('vehicleFixedCost').value, costPerKm: $('vehicleCostKm').value, costPerMinute: $('vehicleCostMin').value,
    maxDistanceKm: $('vehicleMaxDistance').value, maxDurationMin: $('vehicleMaxDuration').value, maxStops,
    returnToDepot: $('vehicleReturnDepot').checked, enabled: true,
  })
}

function saveVehicle() {
  try {
    const candidate = vehicleFromForm()
    if (state.editingVehicleId) {
      const v = state.vehicles.find(x => x.id === state.editingVehicleId); if (!v) return cancelVehicleEdit()
      const enabled = v.enabled; Object.assign(v, candidate, { id: v.id, enabled }); setStatus(`خودرو «${v.name}» ویرایش شد.`)
    } else { state.vehicles.push(candidate); setStatus(`خودرو «${candidate.name}» اضافه شد.`) }
    clearVehicleForm(); cancelVehicleEdit(false); clearResult(); renderVehicles(); updateStats()
  } catch (e) { setStatus(e.message) }
}
function clearVehicleForm() {
  $('vehicleName').value = ''; $('vehicleType').value = ''; $('vehicleCapacity').value = '10'; $('vehicleFixedCost').value = '0'; $('vehicleCostKm').value = '0'; $('vehicleCostMin').value = '0'; $('vehicleMaxDistance').value = ''; $('vehicleMaxDuration').value = ''; $('vehicleMaxStops').value = ''; $('vehicleReturnDepot').checked = true
}
function editVehicle(id) {
  const v = state.vehicles.find(x => x.id === id); if (!v) return
  state.editingVehicleId = id; $('vehicleName').value = v.name; $('vehicleType').value = v.type; $('vehicleCapacity').value = v.capacity; $('vehicleFixedCost').value = v.fixedCost || 0; $('vehicleCostKm').value = v.costPerKm || 0; $('vehicleCostMin').value = v.costPerMinute || 0; $('vehicleMaxDistance').value = v.maxDistanceKm || ''; $('vehicleMaxDuration').value = v.maxDurationMin || ''; $('vehicleMaxStops').value = v.maxStops || ''; $('vehicleReturnDepot').checked = v.returnToDepot !== false
  $('saveVehicle').textContent = '✓ ذخیره ویرایش خودرو'; $('cancelVehicleEdit').classList.remove('hidden')
}
function cancelVehicleEdit(clear = true) { state.editingVehicleId = null; $('saveVehicle').textContent = '＋ افزودن خودرو'; $('cancelVehicleEdit').classList.add('hidden'); if (clear) clearVehicleForm() }
function toggleVehicle(id, enabled) { const v = state.vehicles.find(x => x.id === id); if (!v) return; v.enabled = enabled; clearResult(); renderVehicles(); updateStats() }
function removeVehicle(id) { const v = state.vehicles.find(x => x.id === id); if (!v) return; state.vehicles = state.vehicles.filter(x => x.id !== id); if (state.editingVehicleId === id) cancelVehicleEdit(); clearResult(); renderVehicles(); updateStats(); setStatus(`خودرو «${v.name}» حذف شد.`) }
function vehicleConstraintSummary(v) {
  const parts = []; if (v.maxDistanceKm) parts.push(`≤${fmt(v.maxDistanceKm)}km`); if (v.maxDurationMin) parts.push(`≤${fmt(v.maxDurationMin, 0)}min`); if (v.maxStops) parts.push(`≤${fmt(v.maxStops, 0)} توقف`); if (!v.returnToDepot) parts.push('بدون بازگشت')
  return parts.length ? ` · ${parts.join(' · ')}` : ''
}
function renderVehicles() {
  const container = $('vehicleList'); if (!state.vehicles.length) { container.innerHTML = '<div class="points-empty">هنوز خودرویی تعریف نشده است.</div>'; return }
  container.innerHTML = state.vehicles.map(v => `<div class="vehicle-row ${v.enabled ? '' : 'disabled-row'}"><label class="vehicle-toggle"><input type="checkbox" data-toggle-vehicle="${v.id}" ${v.enabled ? 'checked' : ''}/><span></span></label><div class="vehicle-info"><b>${escapeHtml(v.name)}</b><small>${escapeHtml(v.type)} · ظرفیت ${fmt(v.capacity)} ${escapeHtml(currentUnit())}${vehicleConstraintSummary(v)}<br>هزینه: ثابت ${fmt(v.fixedCost,0)} + ${fmt(v.costPerKm,0)}/km + ${fmt(v.costPerMinute,0)}/min</small></div><div class="row-actions"><button data-edit-vehicle="${v.id}">ویرایش</button><button class="danger-mini" data-remove-vehicle="${v.id}">حذف</button></div></div>`).join('')
  container.querySelectorAll('[data-toggle-vehicle]').forEach(el => el.addEventListener('change', () => toggleVehicle(el.dataset.toggleVehicle, el.checked)))
  container.querySelectorAll('[data-edit-vehicle]').forEach(el => el.addEventListener('click', () => editVehicle(el.dataset.editVehicle)))
  container.querySelectorAll('[data-remove-vehicle]').forEach(el => el.addEventListener('click', () => removeVehicle(el.dataset.removeVehicle)))
}

const rad = d => d * Math.PI / 180
function haversineMeters(a, b) { const R = 6371000, dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)) }
function fallbackMatrix(points) { const distances = points.map(a => points.map(b => haversineMeters(a, b) * 1.25)); const durations = distances.map(row => row.map(m => (m / 1000 / 35) * 3600)); return { distances, durations } }
const TRAFFIC_SCENARIOS = { base: { label: 'زمان پایه OSRM', alpha: 0 }, light: { label: 'ترافیک مصنوعی سبک', alpha: .18 }, moderate: { label: 'ترافیک مصنوعی متوسط', alpha: .38 }, heavy: { label: 'ترافیک مصنوعی سنگین', alpha: .68 } }
function syntheticTrafficDurations(baseDurations, points, scenarioKey) {
  const scenario = TRAFFIC_SCENARIOS[scenarioKey] || TRAFFIC_SCENARIOS.base; if (!scenario.alpha) return baseDurations.map(r => [...r])
  const center = { lat: points.reduce((s,p)=>s+p.lat,0)/points.length, lng: points.reduce((s,p)=>s+p.lng,0)/points.length }
  const mids = points.map((a,i)=>points.map((b,j)=>haversineMeters({lat:(a.lat+b.lat)/2,lng:(a.lng+b.lng)/2},center))); const max = Math.max(1,...mids.flat())
  return baseDurations.map((row,i)=>row.map((sec,j)=> i===j ? 0 : sec * (1 + scenario.alpha * (.35 + .65 * (1 - Math.min(1,mids[i][j]/max))))))
}

function getObjectiveConfig(matrix, vehicles, objectiveOverride = null, scenarioOverride = null) {
  const objective = objectiveOverride || $('objectiveMode').value
  const scenario = scenarioOverride || $('trafficScenario').value
  const points = [state.depot, ...state.customers]
  const scenarioDurations = (objective === 'time' || objective === 'cost') ? syntheticTrafficDurations(matrix.durations, points, scenario) : matrix.durations
  if (objective === 'distance') return { objective, scenario: 'none', label: 'فاصله جاده‌ای', vehicleCosts: vehicles.map(() => matrix.distances), durations: matrix.durations, costUnit: currentCostUnit() }
  if (objective === 'time') return { objective, scenario, label: scenario === 'base' && matrix.source !== 'osrm' ? 'زمان تقریبی fallback' : TRAFFIC_SCENARIOS[scenario].label, vehicleCosts: vehicles.map(() => scenarioDurations), durations: scenarioDurations, costUnit: currentCostUnit() }
  const vehicleCosts = vehicles.map(v => matrix.distances.map((row,i)=>row.map((meters,j)=> (meters/1000)*(v.costPerKm||0) + (scenarioDurations[i][j]/60)*(v.costPerMinute||0))))
  return { objective: 'cost', scenario, label: `هزینه کل ناوگان · ${scenario === 'base' ? 'زمان پایه' : TRAFFIC_SCENARIOS[scenario].label}`, vehicleCosts, durations: scenarioDurations, costUnit: currentCostUnit() }
}
function formatObjective(value, objective, costUnit = currentCostUnit()) { if (objective === 'time') return `${fmt(value / 60, 1)} دقیقه`; if (objective === 'cost') return `${fmt(value, 0)} ${escapeHtml(costUnit)}`; return `${fmt(value / 1000)} km` }
function updateObjectiveUi() {
  const objective = $('objectiveMode').value, usesTime = objective === 'time' || objective === 'cost'
  $('trafficScenarioWrap').classList.toggle('hidden', !usesTime); $('costSettingsWrap').classList.toggle('hidden', objective !== 'cost'); clearResult()
  setStatus(objective === 'distance' ? 'تابع هدف فاصله جاده‌ای انتخاب شد.' : objective === 'time' ? 'تابع هدف زمان انتخاب شد؛ سناریوهای ترافیک مصنوعی داده واقعی نیستند.' : 'تابع هدف هزینه انتخاب شد؛ ضرایب هزینه هر خودرو مستقیماً در تخصیص و ترتیب مسیر اثر می‌گذارند.')
}

async function getRoadMatrix() {
  const points = [state.depot, ...state.customers], fallback = fallbackMatrix(points), coords = points.map(p => `${p.lng},${p.lat}`).join(';')
  try {
    const response = await fetch(`${OSRM_BASE}/table/v1/driving/${coords}?annotations=distance,duration`); if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json(); const invalid = data.code !== 'Ok' || !data.distances || !data.durations || data.distances.some(r=>r.some(v=>!Number.isFinite(v))) || data.durations.some(r=>r.some(v=>!Number.isFinite(v)))
    if (invalid) throw new Error(data.message || 'ماتریس ناقص')
    return { distances: data.distances, durations: data.durations, source: 'osrm' }
  } catch (error) { return { ...fallback, source: 'fallback', warning: `OSRM در دسترس نبود؛ حل با تقریب فاصله هوایی × ۱٫۲۵ انجام شد. گواهی دقیق فقط نسبت به همین ماتریس تقریبی معتبر است. (${error.message || 'خطا'})` } }
}

async function getRouteGeometry(orderedCustomers, vehicle) {
  const points = [state.depot, ...orderedCustomers, ...(vehicle?.returnToDepot === false ? [] : [state.depot])], coords = points.map(p => `${p.lng},${p.lat}`).join(';')
  try {
    const response = await fetch(`${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`); if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json(); if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error(data.message || 'مسیر پیدا نشد')
    const route = data.routes[0]; return { geometry: route.geometry.coordinates.map(([lng,lat])=>[lat,lng]), distanceMeters: route.distance, durationSeconds: route.duration, source: 'osrm' }
  } catch {
    const distanceMeters = points.slice(0,-1).reduce((s,p,i)=>s+haversineMeters(p,points[i+1])*1.25,0)
    return { geometry: points.map(p=>[p.lat,p.lng]), distanceMeters, durationSeconds: (distanceMeters/1000/35)*3600, source: 'fallback' }
  }
}

function hasComplexOperationalConstraints(vehicles) { return vehicles.some(v => v.maxDistanceKm || v.maxDurationMin) }
function workerVehicles(vehicles, objective) { return vehicles.map(v => ({ id:v.id, capacity:v.capacity, maxDistanceKm:v.maxDistanceKm, maxDurationMin:v.maxDurationMin, maxStops:v.maxStops, returnToDepot:v.returnToDepot, fixedCost: objective === 'cost' ? v.fixedCost : 0 })) }
function runWorker(mode, objectiveConfig, vehicles, deadlineMs) {
  return new Promise((resolve,reject)=>{
    const worker = new Worker('./solver-worker.js', { type:'module' }); const kill = setTimeout(()=>{worker.terminate();reject(new Error('__TIMEOUT__'))}, deadlineMs+1500)
    worker.onmessage = event => { clearTimeout(kill); worker.terminate(); event.data?.ok ? resolve(event.data.result) : reject(new Error(event.data?.error || 'خطای Solver')) }
    worker.onerror = () => { clearTimeout(kill); worker.terminate(); reject(new Error('اجرای Web Worker ناموفق بود.')) }
    worker.postMessage({ command:'solve', payload:{ mode, vehicleCosts:objectiveConfig.vehicleCosts, distances:objectiveConfig.matrixDistances, durations:objectiveConfig.durations, objective:objectiveConfig.objective, customers:state.customers.map(c=>({name:c.name,demand:c.demand,priority:c.priority??3})), vehicles:workerVehicles(vehicles,objectiveConfig.objective), deadlineMs, priorityPolicy:$('priorityPolicy').value, complexConstraints:hasComplexOperationalConstraints(vehicles), exactMaxCustomers:EXACT_MAX_CUSTOMERS } })
  })
}
function attachMatrices(config, matrix) { return { ...config, matrixDistances: matrix.distances } }

async function chooseSolver(objectiveConfig, vehicles) {
  const requested = $('solverMode').value, complex = hasComplexOperationalConstraints(vehicles), n = state.customers.length
  if (requested === 'heuristic') return runWorker('heuristic', objectiveConfig, vehicles, 4500)
  if (requested === 'exact') {
    if (complex) throw new Error('در حضور محدودیت حداکثر مسافت/مدت، این نسخه گواهی Exact صادر نمی‌کند؛ حالت کراندار یا ابتکاری را انتخاب کنید.')
    if (n > EXACT_MAX_CUSTOMERS) throw new Error(`حل دقیق حداکثر برای ${EXACT_MAX_CUSTOMERS} مشتری فعال است.`)
    return runWorker('exact', objectiveConfig, vehicles, 15000)
  }
  if (requested === 'bounded') return runWorker('bounded', objectiveConfig, vehicles, 9000)
  if (n <= EXACT_MAX_CUSTOMERS && !complex) { setStatus('در حال حل کراندار؛ اگر جست‌وجوی دقیق کامل شود Gap صفر خواهد شد…'); return runWorker('bounded', objectiveConfig, vehicles, 5500) }
  return runWorker('bounded', objectiveConfig, vehicles, 4500)
}

function validateProblemBeforeSolve(vehicles) {
  if (!state.depot) throw new Error('ابتدا دپو را مشخص کنید.')
  if (!state.customers.length) throw new Error('حداقل یک مشتری اضافه کنید.')
  if (!vehicles.length) throw new Error('حداقل یک خودروی فعال تعریف کنید.')
  if (state.customers.length + 1 > MAX_PUBLIC_POINTS) throw new Error(`برای سرویس عمومی OSRM حداکثر ${MAX_PUBLIC_POINTS - 1} مشتری مجاز است.`)
  const totalDemand = state.customers.reduce((s,c)=>s+c.demand,0), totalCapacity = vehicles.reduce((s,v)=>s+v.capacity,0)
  if (totalDemand > totalCapacity + 1e-9) throw new Error('ظرفیت کل خودروهای فعال کمتر از تقاضای کل است.')
}

async function solve() {
  const vehicles = state.vehicles.filter(v=>v.enabled)
  try { validateProblemBeforeSolve(vehicles) } catch(e) { return setStatus(e.message) }
  $('solveBtn').disabled = true; $('compareBtn').disabled = true; clearResult()
  try {
    setStatus('در حال دریافت ماتریس فاصله و زمان پایه جاده‌ای…'); const matrix = await getRoadMatrix(); const objectiveConfig = attachMatrices(getObjectiveConfig(matrix, vehicles), matrix); const solverResult = await chooseSolver(objectiveConfig, vehicles)
    const resultRoutes = []
    for (let i=0;i<solverResult.routes.length;i++) {
      const sr=solverResult.routes[i], vehicle=vehicles.find(v=>v.id===sr.vehicleId), orderedCustomers=sr.indices.map(index=>state.customers[index]); setStatus(`در حال دریافت هندسه مسیر ${i+1} از ${solverResult.routes.length}…`)
      const road=await getRouteGeometry(orderedCustomers,vehicle); resultRoutes.push({...road,vehicleId:sr.vehicleId,vehicle,customerIds:orderedCustomers.map(c=>c.id),load:sr.load,objectiveValue:sr.objectiveValue,matrixDistance:sr.matrixDistance,matrixDuration:sr.matrixDuration})
    }
    state.routes=resultRoutes; state.lastSolveMeta={...solverResult,matrixSource:matrix.source,objective:objectiveConfig.objective,objectiveLabel:objectiveConfig.label,trafficScenario:objectiveConfig.scenario,costUnit:objectiveConfig.costUnit,priorityPolicy:$('priorityPolicy').value,complexConstraints:hasComplexOperationalConstraints(vehicles)}
    renderRoutes(matrix.warning); fitData(true)
    if (solverResult.optimal) setStatus('حل دقیق کامل شد و Gap صفر است؛ بهینگی نسبت به مدل و ماتریس ورودی اثبات شده است.')
    else if (solverResult.method==='bounded') setStatus(`بهترین جواب موجود همراه با کران پایین و Gap گزارش شد${solverResult.boundOnly?'؛ به علت محدودیت‌های عملیاتی پیچیده، جست‌وجوی Exact اجرا نشد.':''}`)
    else setStatus('حل ابتکاری انجام شد؛ جواب شدنی است اما تضمین بهینگی ندارد.')
  } catch(error) { setStatus(error.message==='__TIMEOUT__'?'حل در محدودیت زمانی مرورگر کامل نشد.':(error.message||'خطایی در حل مسئله رخ داد.')) }
  finally { $('solveBtn').disabled=false; $('compareBtn').disabled=false }
}

function operatingCostFromRoad(route) { const v=route.vehicle||{}; return (v.fixedCost||0)+(route.distanceMeters/1000)*(v.costPerKm||0)+(route.durationSeconds/60)*(v.costPerMinute||0) }
function renderRoutes(matrixWarning) {
  state.routeLayers.forEach(l=>l.remove()); state.routeLayers=[]; $('routeGrid').innerHTML=''
  let totalRoadDistance=0,totalDuration=0,routeFallback=false,totalOperatingCost=0
  state.routes.forEach((route,i)=>{
    const color=ROUTE_COLORS[i%ROUTE_COLORS.length], layer=L.polyline(route.geometry,{color,weight:5,opacity:.84}).addTo(map); state.routeLayers.push(layer); totalRoadDistance+=route.distanceMeters; totalDuration+=route.durationSeconds; totalOperatingCost+=operatingCostFromRoad(route); routeFallback ||= route.source==='fallback'
    const customers=route.customerIds.map(id=>state.customers.find(c=>c.id===id)).filter(Boolean), card=document.createElement('article'); card.className='route-card'; card.style.borderTopColor=color
    const returnText=route.vehicle?.returnToDepot===false?'پایان مسیر':'دپو'
    card.innerHTML=`<div class="route-title">🚚 ${escapeHtml(route.vehicle?.name||`خودرو ${i+1}`)} <small>${escapeHtml(route.vehicle?.type||'')}</small></div><div class="route-metrics"><span>بار: <b>${fmt(route.load)} ${escapeHtml(currentUnit())}</b></span><span>استفاده ظرفیت: <b>${fmt(route.load/(route.vehicle?.capacity||1)*100,0)}٪</b></span><span>سهم تابع هدف: <b>${formatObjective(route.objectiveValue,state.lastSolveMeta?.objective,state.lastSolveMeta?.costUnit)}</b></span><span>مسیر رسم‌شده: <b>${fmt(route.distanceMeters/1000)} km</b></span><span>زمان پایه: <b>${fmt(route.durationSeconds/60,0)} دقیقه</b></span><span>هزینه عملیاتی برآوردی: <b>${fmt(operatingCostFromRoad(route),0)} ${escapeHtml(currentCostUnit())}</b></span></div><div class="sequence">دپو ← ${customers.map(c=>`${escapeHtml(c.name)} <small>(اولویت ${fmt(c.priority??3,0)})</small>`).join(' ← ')} ← ${returnText}</div>`
    $('routeGrid').appendChild(card)
  })
  const meta=state.lastSolveMeta, exact=meta?.optimal===true, bounded=meta?.method==='bounded'&&!exact
  $('solutionBadge').className=`solution-badge ${exact?'exact':bounded?'bounded':'heuristic'}`
  if (exact) $('solutionBadge').innerHTML=`<b>حل دقیق · Gap = 0%</b><span>بهینگی نسبت به مدل و ماتریس ${meta.matrixSource==='osrm'?'OSRM':'تقریبی'} اثبات شده · ${fmt(meta.elapsedMs/1000,2)} ثانیه</span>`
  else if (bounded) $('solutionBadge').innerHTML=`<b>حل کراندار</b><span>Incumbent: ${formatObjective(meta.objectiveValue,meta.objective,meta.costUnit)} · Lower Bound: ${formatObjective(meta.lowerBound||0,meta.objective,meta.costUnit)} · Gap: ${meta.gap==null?'—':fmt(meta.gap*100,1)+'٪'} · ${fmt(meta.elapsedMs/1000,2)} ثانیه</span>`
  else $('solutionBadge').innerHTML=`<b>حل ابتکاری</b><span>بدون اثبات بهینگی · Gap مبتنی بر کران ساده: ${meta?.gap==null?'—':fmt(meta.gap*100,1)+'٪'} · ${fmt(meta?.elapsedMs/1000||0,2)} ثانیه</span>`
  $('solutionBadge').classList.remove('hidden')
  $('resultSubtitle').textContent=`${fmt(state.routes.length,0)} مسیر برای ${fmt(state.customers.length,0)} مشتری ساخته شد. تابع هدف: ${meta?.objectiveLabel}.`
  $('objectiveTotalLabel').textContent=`تابع هدف · ${meta?.objective==='cost'?'هزینه':meta?.objective==='time'?'زمان':'فاصله'}`; $('objectiveTotal').textContent=formatObjective(meta?.objectiveValue??0,meta?.objective,meta?.costUnit); $('totalDistance').textContent=`${fmt(totalRoadDistance/1000)} km`; $('totalDuration').textContent=`${fmt(totalDuration/3600,2)} h`; $('totals').classList.remove('hidden'); $('durationNote').classList.remove('hidden')
  renderKpis({totalRoadDistance,totalDuration,totalOperatingCost})
  const warnings=[]; if(matrixWarning)warnings.push(matrixWarning); if(routeFallback)warnings.push('هندسه حداقل یک مسیر به‌صورت تقریبی رسم شد.'); if(meta?.objective!=='distance'&&meta.trafficScenario!=='base')warnings.push('سناریوی ترافیک مصنوعی است و داده زنده/تاریخی محسوب نمی‌شود.'); else warnings.push('ترافیک زنده/تاریخی در OSRM لحاظ نشده است.'); if(meta?.complexConstraints)warnings.push('حداکثر مسافت/مدت با روش ابتکاری کنترل شده‌اند؛ برای این حالت گواهی Exact صادر نمی‌شود.'); warnings.push('محدودیت تخصصی کامیون، زمان سرویس و عدم قطعیت عملیات هنوز مدل نشده‌اند.'); $('warning').textContent=warnings.join(' '); $('warning').classList.remove('hidden')
}

function renderKpis({totalRoadDistance,totalDuration,totalOperatingCost}) {
  const used=state.routes.length, utils=state.routes.map(r=>r.load/(r.vehicle?.capacity||1)*100), avgUtil=utils.length?utils.reduce((a,b)=>a+b,0)/utils.length:0, maxUtil=utils.length?Math.max(...utils):0, meta=state.lastSolveMeta
  const cards=[['خودروهای استفاده‌شده',`${fmt(used,0)} از ${fmt(state.vehicles.filter(v=>v.enabled).length,0)}`],['بهره‌برداری متوسط ظرفیت',`${fmt(avgUtil,0)}٪`],['بیشترین بهره‌برداری',`${fmt(maxUtil,0)}٪`],['مسافت کل',`${fmt(totalRoadDistance/1000)} km`],['زمان پایه کل',`${fmt(totalDuration/60,0)} دقیقه`],['هزینه عملیاتی برآوردی',`${fmt(totalOperatingCost,0)} ${currentCostUnit()}`],['زمان Solver',`${fmt((meta?.elapsedMs||0)/1000,2)} ثانیه`],['Optimality Gap',meta?.optimal?'0٪':(meta?.gap==null?'نامشخص':`${fmt(meta.gap*100,1)}٪`)]]
  $('kpiGrid').innerHTML=cards.map(([label,value])=>`<div class="kpi-card"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join(''); $('kpiGrid').classList.remove('hidden')
}

function clearResult() {
  state.routes=[]; state.lastSolveMeta=null; state.routeLayers.forEach(l=>l.remove()); state.routeLayers=[]; $('routeGrid').innerHTML=''; $('resultSubtitle').textContent='بعد از حل، روش، کیفیت و جزئیات مسیرها اینجا نمایش داده می‌شود.'; $('totals').classList.add('hidden'); $('solutionBadge').classList.add('hidden'); $('warning').classList.add('hidden'); $('durationNote').classList.add('hidden'); $('kpiGrid').classList.add('hidden'); clearScenarioComparison()
}
function clearScenarioComparison(){ $('scenarioComparison').classList.add('hidden'); $('scenarioTableBody').innerHTML='' }

async function compareScenarios() {
  const vehicles=state.vehicles.filter(v=>v.enabled); try{validateProblemBeforeSolve(vehicles)}catch(e){return setStatus(e.message)}
  $('compareBtn').disabled=true; $('solveBtn').disabled=true; clearScenarioComparison()
  try {
    setStatus('در حال دریافت یک ماتریس مشترک و حل چهار سناریوی مقایسه‌ای…'); const matrix=await getRoadMatrix(); const scenarios=[['فاصله','distance','base'],['زمان پایه','time','base'],['ترافیک متوسط مصنوعی','time','moderate'],['ترافیک سنگین مصنوعی','time','heavy']], rows=[]
    for (const [name,obj,sc] of scenarios) {
      const cfg=attachMatrices(getObjectiveConfig(matrix,vehicles,obj,sc),matrix); const res=await runWorker('heuristic',cfg,vehicles,3500); const totalDist=res.routes.reduce((s,r)=>s+r.matrixDistance,0), totalDur=res.routes.reduce((s,r)=>s+r.matrixDuration,0), utils=res.routes.map(r=>r.load/(vehicles.find(v=>v.id===r.vehicleId)?.capacity||1)*100), avg=utils.length?utils.reduce((a,b)=>a+b,0)/utils.length:0
      rows.push({name,obj,value:res.objectiveValue,totalDist,totalDur,used:res.routes.length,avg})
    }
    $('scenarioTableBody').innerHTML=rows.map(r=>`<tr><td>${escapeHtml(r.name)}</td><td>${formatObjective(r.value,r.obj,currentCostUnit())}</td><td>${fmt(r.totalDist/1000)} km</td><td>${fmt(r.totalDur/60,0)} دقیقه</td><td>${fmt(r.used,0)}</td><td>${fmt(r.avg,0)}٪</td></tr>`).join(''); $('scenarioComparison').classList.remove('hidden'); setStatus('مقایسه سناریوها آماده شد. این جدول با روش ابتکاری یکسان تهیه شده است.')
  } catch(e){setStatus(e.message||'مقایسه سناریوها ناموفق بود.')} finally{$('compareBtn').disabled=false;$('solveBtn').disabled=false}
}

function loadExample() {
  state.depot={id:'depot',name:'انبار مرکزی تهران',lat:35.7219,lng:51.3347}; state.customers=[
    {id:makeId(),name:'ونک',lat:35.7575,lng:51.4090,demand:3,priority:5},{id:makeId(),name:'تجریش',lat:35.8067,lng:51.4280,demand:2,priority:4},{id:makeId(),name:'تهرانپارس',lat:35.7292,lng:51.5326,demand:4,priority:3},{id:makeId(),name:'آزادی',lat:35.6997,lng:51.3370,demand:2,priority:2},{id:makeId(),name:'بازار',lat:35.6757,lng:51.4215,demand:3,priority:5},{id:makeId(),name:'صادقیه',lat:35.7212,lng:51.3231,demand:2,priority:3}]
  state.vehicles=[makeVehicle({name:'وانت A',type:'وانت',capacity:7,fixedCost:350000,costPerKm:11000,costPerMinute:1400,maxStops:4}),makeVehicle({name:'کامیون B',type:'کامیون سبک',capacity:10,fixedCost:700000,costPerKm:18000,costPerMinute:2100,maxDistanceKm:120})]
  $('capacityUnit').value='بسته'; $('customUnitWrap').classList.add('hidden'); clearSelectionPin(); clearResult(); renderPoints(); renderVehicles(); fitData(false); updateStats(); setStatus('داده نمونه عملیاتی تهران بارگذاری شد؛ هزینه‌ها و محدودیت خودروها نیز مقدار نمونه دارند.')
}
function resetAll(){state.depot=null;state.customers=[];state.vehicles=[];cancelPointEdit();cancelVehicleEdit();clearSelectionPin();clearResult();renderPoints();renderVehicles();map.fitBounds(IRAN_BOUNDS,{padding:[12,12],animate:false});setStatus('همه داده‌های مسئله پاک شدند.')}

function exportJson() {
  const payload={version:'2.2.0',app:'OptiMasir',unit:currentUnit(),costUnit:currentCostUnit(),objective:$('objectiveMode').value,trafficScenario:$('trafficScenario').value,priorityPolicy:$('priorityPolicy').value,depot:state.depot,customers:state.customers,vehicles:state.vehicles}
  downloadBlob('optimasi-data.json',new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}))
}
function downloadBlob(name,blob){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function positiveNumber(v){const n=Number(v);if(!Number.isFinite(n)||n<=0)throw new Error('مقدار ظرفیت/تقاضا در فایل معتبر نیست.');return n}
function validPriority(v){const n=Number(v??3);return Number.isInteger(n)&&n>=1&&n<=5?n:3}
function sanitizePoint(p,depot){const lat=Number(p?.lat),lng=Number(p?.lng);if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lng)||lng<-180||lng>180)throw new Error('مختصات فایل ورودی معتبر نیست.');return{id:depot?'depot':makeId(),name:clampText(p.name)||(depot?'دپو':'مشتری'),lat,lng}}
function sanitizeImportedData(data){
  if(!data||typeof data!=='object')throw new Error('ساختار فایل معتبر نیست.');const depot=data.depot==null?null:sanitizePoint(data.depot,true);if(!Array.isArray(data.customers)||data.customers.length>MAX_PUBLIC_POINTS-1)throw new Error('لیست مشتری‌ها معتبر نیست یا بیش از حد بزرگ است.');const customers=data.customers.map(x=>({...sanitizePoint(x,false),demand:positiveNumber(x.demand),priority:validPriority(x.priority)}));let vehicleData=data.vehicles
  if(!Array.isArray(vehicleData)&&Number.isFinite(Number(data.vehicleCapacity))&&Number.isInteger(Number(data.vehicleCount))&&Number(data.vehicleCount)>0){const count=Math.min(Number(data.vehicleCount),30);vehicleData=Array.from({length:count},(_,i)=>({name:`خودرو ${i+1}`,type:'ناوگان قدیمی',capacity:Number(data.vehicleCapacity),enabled:true}))}
  if(!Array.isArray(vehicleData)||vehicleData.length>30)throw new Error('لیست خودروها معتبر نیست.');const vehicles=vehicleData.map(v=>makeVehicle({...v,capacity:positiveNumber(v.capacity)}));const objective=['distance','time','cost'].includes(data.objective)?data.objective:'distance';return{depot,customers,vehicles,unit:clampText(data.unit,24)||'واحد',costUnit:clampText(data.costUnit,24)||'تومان',objective,trafficScenario:TRAFFIC_SCENARIOS[data.trafficScenario]?data.trafficScenario:'base',priorityPolicy:data.priorityPolicy==='hard'?'hard':'soft'}
}
function importJson(event){const file=event.target.files?.[0];if(!file)return;if(file.size>2_000_000){setStatus('فایل JSON بیش از ۲ مگابایت است.');event.target.value='';return}const reader=new FileReader();reader.onload=()=>{try{const parsed=sanitizeImportedData(JSON.parse(String(reader.result)));applyImportedProject(parsed);setStatus('فایل JSON با اعتبارسنجی بارگذاری شد.')}catch(e){setStatus(e.message||'ساختار JSON معتبر نیست.')}};reader.readAsText(file);event.target.value=''}
function applyImportedProject(parsed){state.depot=parsed.depot;state.customers=parsed.customers;state.vehicles=parsed.vehicles;const standard=[...$('capacityUnit').options].some(o=>o.value===parsed.unit);if(standard)$('capacityUnit').value=parsed.unit;else{$('capacityUnit').value='custom';$('customUnit').value=parsed.unit;$('customUnitWrap').classList.remove('hidden')}$('costUnit').value=[...$('costUnit').options].some(o=>o.value===parsed.costUnit)?parsed.costUnit:'تومان';$('objectiveMode').value=parsed.objective;$('trafficScenario').value=parsed.trafficScenario;$('priorityPolicy').value=parsed.priorityPolicy;updateObjectiveUi();clearSelectionPin();clearResult();renderPoints();renderVehicles();updateStats();fitData(false)}

function downloadTemplate(){const csv='kind,name,latitude,longitude,demand,priority,vehicle_type,capacity,fixed_cost,cost_per_km,cost_per_min,max_distance_km,max_duration_min,max_stops,return_to_depot,enabled,unit\ndepot,انبار مرکزی,35.7219,51.3347,,,,,,,,,,,,,بسته\ncustomer,مشتری 1,35.7575,51.4090,3,5,,,,,,,,,,,بسته\nvehicle,وانت 1,,,,,وانت,8,350000,12000,1500,120,480,8,true,true,بسته\n';downloadBlob('optimasi-import-template.csv',new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}))}

function parseCsv(text){
  text=text.replace(/^\uFEFF/,'');const first=text.split(/\r?\n/,1)[0]||'',delim=['\t',';',','].sort((a,b)=>(first.split(b).length-first.split(a).length))[0];const rows=[];let row=[],cell='',quoted=false
  for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++}else if(ch==='"')quoted=false;else cell+=ch}else{if(ch==='"')quoted=true;else if(ch===delim){row.push(cell);cell=''}else if(ch==='\n'){row.push(cell);rows.push(row);row=[];cell=''}else if(ch!=='\r')cell+=ch}}
  if(cell||row.length){row.push(cell);rows.push(row)}if(rows.length<2)return[];const headers=rows[0].map(normalizeHeader);return rows.slice(1).filter(r=>r.some(v=>String(v).trim())).map(r=>Object.fromEntries(headers.map((h,i)=>[h,String(r[i]??'').trim()])))
}
const HEADER_ALIASES={kind:'kind','نوع':'kind',name:'name','نام':'name',latitude:'latitude',lat:'latitude','عرض':'latitude','عرض جغرافیایی':'latitude',longitude:'longitude',lng:'longitude','طول':'longitude','طول جغرافیایی':'longitude',demand:'demand','تقاضا':'demand',priority:'priority','اولویت':'priority',vehicle_type:'vehicle_type','نوع خودرو':'vehicle_type',capacity:'capacity','ظرفیت':'capacity',fixed_cost:'fixed_cost','هزینه ثابت':'fixed_cost',cost_per_km:'cost_per_km','هزینه هر کیلومتر':'cost_per_km',cost_per_min:'cost_per_min','هزینه هر دقیقه':'cost_per_min',max_distance_km:'max_distance_km','حداکثر مسافت':'max_distance_km',max_duration_min:'max_duration_min','حداکثر مدت':'max_duration_min',max_stops:'max_stops','حداکثر توقف':'max_stops',return_to_depot:'return_to_depot','بازگشت به دپو':'return_to_depot',enabled:'enabled','فعال':'enabled',unit:'unit','واحد':'unit'}
function normalizeHeader(h){const k=String(h||'').trim().toLowerCase().replace(/\s+/g,' ');return HEADER_ALIASES[k]||k.replace(/\s+/g,'_')}
function boolValue(v,defaultValue=true){if(v===''||v==null)return defaultValue;return !['false','0','no','خیر','نه'].includes(String(v).trim().toLowerCase())}

async function parseXlsx(file){const buffer=await file.arrayBuffer(),files=await unzipXlsx(buffer),decoder=new TextDecoder('utf-8');const wbText=files.get('xl/workbook.xml')?decoder.decode(files.get('xl/workbook.xml')):'';const relText=files.get('xl/_rels/workbook.xml.rels')?decoder.decode(files.get('xl/_rels/workbook.xml.rels')):'';let sheetPath='xl/worksheets/sheet1.xml';if(wbText&&relText){const wb=new DOMParser().parseFromString(wbText,'application/xml'),rel=new DOMParser().parseFromString(relText,'application/xml'),sheet=wb.querySelector('sheet');const rid=sheet?.getAttribute('r:id')||sheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');const target=[...rel.querySelectorAll('Relationship')].find(x=>x.getAttribute('Id')===rid)?.getAttribute('Target');if(target)sheetPath=target.startsWith('/')?target.slice(1):`xl/${target.replace(/^\.\//,'')}`}
  const sheetBytes=files.get(sheetPath);if(!sheetBytes)throw new Error('Sheet اول فایل Excel پیدا نشد.');const shared=[];if(files.has('xl/sharedStrings.xml')){const doc=new DOMParser().parseFromString(decoder.decode(files.get('xl/sharedStrings.xml')),'application/xml');doc.querySelectorAll('si').forEach(si=>shared.push(si.textContent||''))}
  const doc=new DOMParser().parseFromString(decoder.decode(sheetBytes),'application/xml'),grid=[];doc.querySelectorAll('row').forEach(row=>{const arr=[];row.querySelectorAll('c').forEach(c=>{const ref=c.getAttribute('r')||'',col=columnIndex(ref),type=c.getAttribute('t'),v=c.querySelector('v')?.textContent??'',inline=c.querySelector('is')?.textContent??'';arr[col]=type==='s'?shared[Number(v)]??'':type==='inlineStr'?inline:v});grid.push(arr)});if(grid.length<2)return[];const headers=grid[0].map(normalizeHeader);return grid.slice(1).filter(r=>r.some(v=>String(v??'').trim())).map(r=>Object.fromEntries(headers.map((h,i)=>[h,String(r[i]??'').trim()]))) }
function columnIndex(ref){const letters=(ref.match(/[A-Z]+/i)||['A'])[0].toUpperCase();let n=0;for(const ch of letters)n=n*26+ch.charCodeAt(0)-64;return n-1}
async function unzipXlsx(buffer){const bytes=new Uint8Array(buffer),dv=new DataView(buffer);let eocd=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-66000);i--){if(dv.getUint32(i,true)===0x06054b50){eocd=i;break}}if(eocd<0)throw new Error('ساختار ZIP/XLSX معتبر نیست.');const entries=dv.getUint16(eocd+10,true),cdOffset=dv.getUint32(eocd+16,true),out=new Map(),decoder=new TextDecoder();let pos=cdOffset;for(let e=0;e<entries;e++){if(dv.getUint32(pos,true)!==0x02014b50)break;const method=dv.getUint16(pos+10,true),compSize=dv.getUint32(pos+20,true),nameLen=dv.getUint16(pos+28,true),extraLen=dv.getUint16(pos+30,true),commentLen=dv.getUint16(pos+32,true),localOffset=dv.getUint32(pos+42,true),name=decoder.decode(bytes.slice(pos+46,pos+46+nameLen));const localNameLen=dv.getUint16(localOffset+26,true),localExtraLen=dv.getUint16(localOffset+28,true),dataStart=localOffset+30+localNameLen+localExtraLen,compressed=bytes.slice(dataStart,dataStart+compSize);let content;if(method===0)content=compressed;else if(method===8){if(typeof DecompressionStream==='undefined')throw new Error('مرورگر شما بازکردن XLSX را پشتیبانی نمی‌کند؛ CSV استفاده کنید.');const ds=new DecompressionStream('deflate-raw');content=new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(ds)).arrayBuffer())}else{pos+=46+nameLen+extraLen+commentLen;continue}out.set(name,content);pos+=46+nameLen+extraLen+commentLen}return out}

function validateBulkRows(rows){const result={depot:null,customers:[],vehicles:[],unit:null,errors:[],warnings:[],total:rows.length};rows.forEach((r,idx)=>{const line=idx+2,kind=String(r.kind||'').trim().toLowerCase();try{if(['depot','دپو'].includes(kind)){const p=sanitizePoint({name:r.name,lat:r.latitude,lng:r.longitude},true);if(result.depot)result.warnings.push(`ردیف ${line}: دپوی قبلی با این ردیف جایگزین می‌شود.`);result.depot=p}else if(['customer','مشتری'].includes(kind)){if(result.customers.length>=MAX_PUBLIC_POINTS-1)throw new Error('تعداد مشتری بیش از حد مجاز است');result.customers.push({...sanitizePoint({name:r.name,lat:r.latitude,lng:r.longitude},false),demand:positiveNumber(r.demand),priority:validPriority(r.priority)})}else if(['vehicle','خودرو'].includes(kind)){if(result.vehicles.length>=30)throw new Error('تعداد خودرو بیش از ۳۰ است');result.vehicles.push(makeVehicle({name:r.name,type:r.vehicle_type,capacity:positiveNumber(r.capacity),fixedCost:r.fixed_cost,costPerKm:r.cost_per_km,costPerMinute:r.cost_per_min,maxDistanceKm:r.max_distance_km,maxDurationMin:r.max_duration_min,maxStops:r.max_stops,returnToDepot:boolValue(r.return_to_depot,true),enabled:boolValue(r.enabled,true)}))}else throw new Error('kind باید depot، customer یا vehicle باشد');if(!result.unit&&r.unit)result.unit=clampText(r.unit,24)}catch(e){result.errors.push(`ردیف ${line}: ${e.message}`)}});return result}
function renderImportReport(result){state.pendingImport=result;const valid=(result.depot?1:0)+result.customers.length+result.vehicles.length;$('importReport').innerHTML=`<b>گزارش اعتبارسنجی</b><div class="import-stats"><span>ردیف معتبر: ${fmt(valid,0)}</span><span>خطا: ${fmt(result.errors.length,0)}</span><span>هشدار: ${fmt(result.warnings.length,0)}</span></div>${result.errors.length?`<ul class="import-errors">${result.errors.slice(0,8).map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul>`:''}${result.warnings.length?`<ul class="import-warnings">${result.warnings.slice(0,6).map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul>`:''}<div class="form-actions"><button id="replaceImported" class="primary" type="button" ${valid?'':'disabled'}>جایگزینی داده‌ها</button><button id="appendImported" class="secondary" type="button" ${valid?'':'disabled'}>افزودن به داده‌ها</button></div>`;$('importReport').classList.remove('hidden');$('replaceImported')?.addEventListener('click',()=>applyBulk('replace'));$('appendImported')?.addEventListener('click',()=>applyBulk('append'))}
function applyBulk(mode){const r=state.pendingImport;if(!r)return;if(mode==='replace'){state.depot=r.depot;state.customers=r.customers;state.vehicles=r.vehicles}else{if(r.depot)state.depot=r.depot;if(state.customers.length+r.customers.length>MAX_PUBLIC_POINTS-1)return setStatus('با افزودن این فایل تعداد مشتری‌ها از سقف مجاز عبور می‌کند.');if(state.vehicles.length+r.vehicles.length>30)return setStatus('با افزودن این فایل تعداد خودروها از ۳۰ عبور می‌کند.');state.customers.push(...r.customers);state.vehicles.push(...r.vehicles)}if(r.unit){const standard=[...$('capacityUnit').options].some(o=>o.value===r.unit);if(standard)$('capacityUnit').value=r.unit;else{$('capacityUnit').value='custom';$('customUnit').value=r.unit;$('customUnitWrap').classList.remove('hidden')}}clearResult();renderPoints();renderVehicles();updateStats();if(state.depot||state.customers.length)fitData(false);setStatus(`${mode==='replace'?'داده‌های فعلی جایگزین':'داده‌ها افزوده'} شدند. خطاهای گزارش‌شده اعمال نشدند.`);state.pendingImport=null;$('importReport').classList.add('hidden')}
async function bulkImport(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;if(file.size>5_000_000)return setStatus('فایل ورودی بیش از ۵ مگابایت است.');try{setStatus('در حال خواندن و اعتبارسنجی فایل…');const rows=file.name.toLowerCase().endsWith('.xlsx')?await parseXlsx(file):parseCsv(await file.text());if(!rows.length)throw new Error('هیچ ردیف داده‌ای در فایل پیدا نشد.');const result=validateBulkRows(rows);renderImportReport(result);setStatus('گزارش اعتبارسنجی آماده است؛ قبل از اعمال آن را بررسی کنید.')}catch(e){setStatus(e.message||'خواندن فایل ناموفق بود.')}}

function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}

$('modeCustomer').addEventListener('click',()=>setMode('customer'));$('modeDepot').addEventListener('click',()=>setMode('depot'));$('savePoint').addEventListener('click',savePoint);$('cancelEdit').addEventListener('click',()=>cancelPointEdit());$('myLocation').addEventListener('click',useMyLocation);$('fitPoints').addEventListener('click',()=>fitData(false));$('saveVehicle').addEventListener('click',saveVehicle);$('cancelVehicleEdit').addEventListener('click',()=>cancelVehicleEdit());$('capacityUnit').addEventListener('change',()=>{$('customUnitWrap').classList.toggle('hidden',$('capacityUnit').value!=='custom');updateStats();renderPoints();renderVehicles()});$('customUnit').addEventListener('input',()=>{updateStats();renderRegisteredPoints();renderVehicles()});$('lat').addEventListener('change',syncSelectionPinFromInputs);$('lng').addEventListener('change',syncSelectionPinFromInputs);$('objectiveMode').addEventListener('change',updateObjectiveUi);$('trafficScenario').addEventListener('change',()=>{clearResult();setStatus(`سناریوی ${TRAFFIC_SCENARIOS[$('trafficScenario').value]?.label||'زمان'} انتخاب شد.`)});$('costUnit').addEventListener('change',clearResult);$('priorityPolicy').addEventListener('change',()=>{clearResult();setStatus($('priorityPolicy').value==='hard'?'اولویت سخت: در هر مسیر، اولویت بالاتر باید قبل از پایین‌تر سرویس بگیرد.':'اولویت نرم: اولویت ترجیح ثانویه روش ابتکاری است و تابع هدف اصلی دست‌نخورده می‌ماند.')});$('solveBtn').addEventListener('click',solve);$('compareBtn').addEventListener('click',compareScenarios);$('sampleBtn').addEventListener('click',loadExample);$('resetBtn').addEventListener('click',resetAll);$('exportBtn').addEventListener('click',exportJson);$('importFile').addEventListener('change',importJson);$('templateBtn').addEventListener('click',downloadTemplate);$('bulkImportFile').addEventListener('change',bulkImport)

setMode('customer');renderPoints();renderVehicles();updateStats();updateObjectiveUi();appBootCompleted = true
