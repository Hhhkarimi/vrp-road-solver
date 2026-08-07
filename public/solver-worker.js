const INF = Number.POSITIVE_INFINITY

self.onmessage = event => {
  const { command, payload } = event.data || {}
  if (command !== 'solve') return
  const started = performance.now()
  try {
    validate(payload)
    let result
    if (payload.mode === 'exact') {
      result = exactSolve(payload, started)
      result.lowerBound = result.objectiveValue
      result.gap = 0
    } else if (payload.mode === 'bounded') {
      const incumbent = heuristicSolve(payload, started)
      const lowerBound = computeLowerBound(payload)
      if (payload.complexConstraints || payload.customers.length > (payload.exactMaxCustomers || 12)) {
        result = { ...incumbent, method: 'bounded', optimal: false, lowerBound, gap: relativeGap(incumbent.objectiveValue, lowerBound), boundOnly: true }
      } else {
        try {
          const exact = exactSolve(payload, started)
          result = { ...exact, lowerBound: exact.objectiveValue, gap: 0 }
        } catch (error) {
          if (!['__TIMEOUT__', '__TOO_LARGE__'].includes(error?.message)) throw error
          result = { ...incumbent, method: 'bounded', optimal: false, lowerBound, gap: relativeGap(incumbent.objectiveValue, lowerBound), timedOut: error?.message === '__TIMEOUT__' }
        }
      }
    } else {
      result = heuristicSolve(payload, started)
      const lowerBound = computeLowerBound(payload)
      result.lowerBound = lowerBound
      result.gap = relativeGap(result.objectiveValue, lowerBound)
    }
    self.postMessage({ ok: true, result: { ...result, elapsedMs: performance.now() - started } })
  } catch (error) {
    self.postMessage({ ok: false, error: error?.message || 'خطای حل' })
  }
}

function checkDeadline(started, deadlineMs) {
  if (performance.now() - started > deadlineMs) throw new Error('__TIMEOUT__')
}

function validate(payload) {
  const { vehicleCosts, distances, durations, customers, vehicles } = payload
  if (!Array.isArray(customers) || !customers.length) throw new Error('حداقل یک مشتری لازم است.')
  if (!Array.isArray(vehicles) || !vehicles.length) throw new Error('حداقل یک خودروی فعال لازم است.')
  const size = customers.length + 1
  for (const matrix of [distances, durations]) {
    if (!Array.isArray(matrix) || matrix.length !== size || matrix.some(row => !Array.isArray(row) || row.length !== size || row.some(v => !Number.isFinite(v) || v < 0))) throw new Error('ماتریس فاصله/زمان معتبر نیست.')
  }
  if (!Array.isArray(vehicleCosts) || vehicleCosts.length !== vehicles.length || vehicleCosts.some(matrix => !Array.isArray(matrix) || matrix.length !== size || matrix.some(row => !Array.isArray(row) || row.length !== size || row.some(v => !Number.isFinite(v) || v < 0)))) throw new Error('ماتریس هزینه خودروها معتبر نیست.')
  if (customers.some(c => !Number.isFinite(c.demand) || c.demand <= 0)) throw new Error('تقاضای مشتری‌ها باید مثبت باشد.')
  if (vehicles.some(v => !Number.isFinite(v.capacity) || v.capacity <= 0)) throw new Error('ظرفیت خودروها باید مثبت باشد.')
  if (customers.some(c => !vehicles.some(v => v.capacity + 1e-9 >= c.demand))) throw new Error('تقاضای حداقل یک مشتری از ظرفیت تمام خودروها بیشتر است.')
  const totalDemand = customers.reduce((s, c) => s + c.demand, 0)
  const totalCapacity = vehicles.reduce((s, v) => s + v.capacity, 0)
  if (totalDemand > totalCapacity + 1e-9) throw new Error('ظرفیت کل ناوگان برای کل تقاضا کافی نیست.')
}

function relativeGap(incumbent, lowerBound) {
  if (!Number.isFinite(incumbent) || incumbent <= 1e-12 || !Number.isFinite(lowerBound)) return null
  return Math.max(0, (incumbent - lowerBound) / Math.max(Math.abs(incumbent), 1e-9))
}

function computeLowerBound(payload) {
  const { vehicleCosts, customers } = payload
  let lb = 0
  for (let j = 1; j <= customers.length; j++) {
    let bestIncoming = INF
    for (const matrix of vehicleCosts) {
      for (let i = 0; i <= customers.length; i++) {
        if (i === j) continue
        bestIncoming = Math.min(bestIncoming, matrix[i][j])
      }
    }
    if (Number.isFinite(bestIncoming)) lb += bestIncoming
  }
  return lb
}

function exactSolve(payload, started) {
  const { customers, vehicles, vehicleCosts, deadlineMs = 8000, priorityPolicy = 'soft', exactMaxCustomers = 12 } = payload
  const n = customers.length
  if (n > exactMaxCustomers) throw new Error('__TOO_LARGE__')
  if (payload.complexConstraints) throw new Error('__TOO_LARGE__')
  const states = 1 << n
  const full = states - 1
  const demandSum = new Float64Array(states)
  const popcount = new Uint8Array(states)
  for (let mask = 1; mask < states; mask++) {
    const bit = mask & -mask
    const j = 31 - Math.clz32(bit)
    demandSum[mask] = demandSum[mask ^ bit] + customers[j].demand
    popcount[mask] = popcount[mask ^ bit] + 1
  }

  const vehicleTours = vehicles.map((vehicle, vi) => computeVehicleTours({
    vehicle,
    costs: vehicleCosts[vi],
    customers,
    states,
    n,
    popcount,
    priorityPolicy,
    started,
    deadlineMs,
  }))

  let prev = new Float64Array(states)
  prev.fill(INF)
  prev[0] = 0
  const parentMasks = []
  const parentSubs = []

  for (let vi = 0; vi < vehicles.length; vi++) {
    checkDeadline(started, deadlineMs)
    const next = new Float64Array(states)
    next.fill(INF)
    const pMask = new Int32Array(states)
    const pSub = new Int32Array(states)
    pMask.fill(-1); pSub.fill(-1)
    const cap = vehicles[vi].capacity
    const tourCost = vehicleTours[vi].tourCost

    for (let covered = 0; covered < states; covered++) {
      if (!Number.isFinite(prev[covered])) continue
      const remaining = full ^ covered
      let sub = remaining
      while (true) {
        if (demandSum[sub] <= cap + 1e-9 && Number.isFinite(tourCost[sub])) {
          const nextMask = covered | sub
          const value = prev[covered] + tourCost[sub]
          if (value + 1e-7 < next[nextMask]) {
            next[nextMask] = value
            pMask[nextMask] = covered
            pSub[nextMask] = sub
          }
        }
        if (sub === 0) break
        sub = (sub - 1) & remaining
      }
      if ((covered & 127) === 0) checkDeadline(started, deadlineMs)
    }
    prev = next
    parentMasks.push(pMask)
    parentSubs.push(pSub)
  }

  if (!Number.isFinite(prev[full])) throw new Error('با ظرفیت، محدودیت توقف و سیاست اولویت فعلی، پوشش همه مشتری‌ها ممکن نشد.')
  const assigned = Array(vehicles.length).fill(0)
  let mask = full
  for (let vi = vehicles.length - 1; vi >= 0; vi--) {
    const sub = parentSubs[vi][mask]
    const before = parentMasks[vi][mask]
    if (sub < 0 || before < 0) throw new Error('بازسازی جواب دقیق ناموفق بود.')
    assigned[vi] = sub
    mask = before
  }

  const routes = []
  assigned.forEach((sub, vi) => {
    if (!sub) return
    const vt = vehicleTours[vi]
    const indices = reconstructTour(sub, vt.tourEnd[sub], n, vt.parent)
    routes.push(makeRouteResult(indices, vi, payload, vt.tourCost[sub]))
  })
  return { method: 'exact', optimal: true, routes, objectiveValue: prev[full] }
}

function computeVehicleTours({ vehicle, costs, customers, states, n, popcount, priorityPolicy, started, deadlineMs }) {
  const size = states * n
  const dp = new Float64Array(size)
  dp.fill(INF)
  const parent = new Int16Array(size)
  parent.fill(-1)
  for (let j = 0; j < n; j++) dp[(1 << j) * n + j] = costs[0][j + 1]

  for (let mask = 1; mask < states; mask++) {
    if (vehicle.maxStops && popcount[mask] > vehicle.maxStops) continue
    if ((mask & 127) === 0) checkDeadline(started, deadlineMs)
    for (let j = 0; j < n; j++) {
      if (!(mask & (1 << j))) continue
      const prevMask = mask ^ (1 << j)
      if (!prevMask) continue
      let best = INF, bestK = -1
      for (let k = 0; k < n; k++) {
        if (!(prevMask & (1 << k))) continue
        if (priorityPolicy === 'hard' && (customers[j].priority ?? 3) > (customers[k].priority ?? 3)) continue
        const prev = dp[prevMask * n + k]
        const value = prev + costs[k + 1][j + 1]
        if (value < best) { best = value; bestK = k }
      }
      dp[mask * n + j] = best
      parent[mask * n + j] = bestK
    }
  }

  const tourCost = new Float64Array(states)
  tourCost.fill(INF)
  const tourEnd = new Int16Array(states)
  tourEnd.fill(-1)
  tourCost[0] = 0
  for (let mask = 1; mask < states; mask++) {
    if (vehicle.maxStops && popcount[mask] > vehicle.maxStops) continue
    let best = INF, end = -1
    for (let j = 0; j < n; j++) {
      if (!(mask & (1 << j))) continue
      const base = dp[mask * n + j]
      const value = base + (vehicle.returnToDepot === false ? 0 : costs[j + 1][0])
      if (value < best) { best = value; end = j }
    }
    if (Number.isFinite(best)) {
      tourCost[mask] = best + (vehicle.fixedCost || 0)
      tourEnd[mask] = end
    }
  }
  return { tourCost, tourEnd, parent }
}

function reconstructTour(mask, end, n, parent) {
  const reversed = []
  let current = end, currentMask = mask
  while (current >= 0) {
    reversed.push(current)
    const previous = parent[currentMask * n + current]
    currentMask ^= (1 << current)
    current = previous
  }
  return reversed.reverse()
}

function heuristicSolve(payload, started) {
  const { customers, vehicles, vehicleCosts, distances, durations, deadlineMs = 3500, priorityPolicy = 'soft' } = payload
  const routes = vehicles.map(() => [])
  const loads = vehicles.map(() => 0)
  const order = customers.map((c, i) => i).sort((a, b) => (customers[b].priority ?? 3) - (customers[a].priority ?? 3) || customers[b].demand - customers[a].demand)

  for (const ci of order) {
    checkDeadline(started, deadlineMs)
    const demand = customers[ci].demand
    let best = null
    for (let vi = 0; vi < vehicles.length; vi++) {
      const v = vehicles[vi]
      if (loads[vi] + demand > v.capacity + 1e-9) continue
      if (v.maxStops && routes[vi].length + 1 > v.maxStops) continue
      const oldObj = fullVehicleCost(routes[vi], vi, payload)
      for (let pos = 0; pos <= routes[vi].length; pos++) {
        const candidate = [...routes[vi].slice(0, pos), ci, ...routes[vi].slice(pos)]
        if (priorityPolicy === 'hard' && !priorityOrderOk(candidate, customers)) continue
        const metrics = routeMetrics(candidate, v, distances, durations)
        if (!operationallyFeasible(metrics, v)) continue
        const newObj = routeCost(candidate, vehicleCosts[vi], v.returnToDepot !== false) + (candidate.length ? (v.fixedCost || 0) : 0)
        const delta = newObj - oldObj
        const tieBias = priorityPolicy === 'soft' ? pos * (customers[ci].priority ?? 3) * 1e-7 : 0
        const score = delta + tieBias
        if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) < 1e-9 && metrics.distance < best.metrics.distance)) best = { vi, pos, score, metrics }
      }
    }
    if (!best) throw new Error(`برای مشتری «${customers[ci].name || ci + 1}» هیچ درج شدنی با ظرفیت/محدودیت‌های فعلی پیدا نشد. محدودیت خودروها را بازبینی کنید.`)
    routes[best.vi].splice(best.pos, 0, ci)
    loads[best.vi] += demand
  }

  let objectiveValue = 0
  const resultRoutes = []
  routes.forEach((route, vi) => {
    if (!route.length) return
    const improved = localImprove(route, vi, payload, started, deadlineMs)
    const obj = fullVehicleCost(improved, vi, payload)
    objectiveValue += obj
    resultRoutes.push(makeRouteResult(improved, vi, payload, obj))
  })
  return { method: 'heuristic', optimal: false, routes: resultRoutes, objectiveValue }
}

function localImprove(route, vi, payload, started, deadlineMs) {
  const v = payload.vehicles[vi]
  let best = [...route]
  let bestCost = fullVehicleCost(best, vi, payload)
  let improved = true, guard = 0
  while (improved && guard++ < 20) {
    improved = false
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        if (performance.now() - started > deadlineMs * .95) return best
        const candidate = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)]
        if (payload.priorityPolicy === 'hard' && !priorityOrderOk(candidate, payload.customers)) continue
        const metrics = routeMetrics(candidate, v, payload.distances, payload.durations)
        if (!operationallyFeasible(metrics, v)) continue
        const cost = fullVehicleCost(candidate, vi, payload)
        if (cost + 1e-7 < bestCost) { best = candidate; bestCost = cost; improved = true }
      }
    }
  }
  return best
}

function priorityOrderOk(route, customers) {
  for (let i = 1; i < route.length; i++) if ((customers[route[i]].priority ?? 3) > (customers[route[i - 1]].priority ?? 3)) return false
  return true
}

function operationallyFeasible(metrics, vehicle) {
  if (vehicle.maxDistanceKm && metrics.distance > vehicle.maxDistanceKm * 1000 + 1e-6) return false
  if (vehicle.maxDurationMin && metrics.duration > vehicle.maxDurationMin * 60 + 1e-6) return false
  return true
}

function makeRouteResult(indices, vi, payload, objectiveValue) {
  const vehicle = payload.vehicles[vi]
  const metrics = routeMetrics(indices, vehicle, payload.distances, payload.durations)
  return {
    vehicleId: vehicle.id,
    indices,
    load: indices.reduce((s, i) => s + payload.customers[i].demand, 0),
    objectiveValue,
    matrixDistance: metrics.distance,
    matrixDuration: metrics.duration,
  }
}

function fullVehicleCost(route, vi, payload) {
  if (!route.length) return 0
  return routeCost(route, payload.vehicleCosts[vi], payload.vehicles[vi].returnToDepot !== false) + (payload.vehicles[vi].fixedCost || 0)
}

function routeMetrics(route, vehicle, distances, durations) {
  return {
    distance: routeCost(route, distances, vehicle.returnToDepot !== false),
    duration: routeCost(route, durations, vehicle.returnToDepot !== false),
  }
}

function routeCost(route, matrix, returnToDepot = true) {
  if (!route.length) return 0
  let total = matrix[0][route[0] + 1]
  for (let i = 0; i < route.length - 1; i++) total += matrix[route[i] + 1][route[i + 1] + 1]
  if (returnToDepot) total += matrix[route.at(-1) + 1][0]
  return total
}
