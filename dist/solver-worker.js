const INF = Number.POSITIVE_INFINITY

self.onmessage = (event) => {
  const { command, payload } = event.data || {}
  if (command !== 'solve') return
  try {
    const started = performance.now()
    const result = payload.mode === 'exact'
      ? exactSolve(payload, started)
      : heuristicSolve(payload, started)
    self.postMessage({ ok: true, result: { ...result, elapsedMs: performance.now() - started } })
  } catch (error) {
    self.postMessage({ ok: false, error: error?.message || 'خطای حل' })
  }
}

function checkDeadline(started, deadlineMs) {
  if (performance.now() - started > deadlineMs) throw new Error('__TIMEOUT__')
}

function validate(payload) {
  const { costs, customers, vehicles } = payload
  if (!Array.isArray(customers) || !customers.length) throw new Error('حداقل یک مشتری لازم است.')
  if (!Array.isArray(vehicles) || !vehicles.length) throw new Error('حداقل یک خودروی فعال لازم است.')
  if (!Array.isArray(costs) || costs.length !== customers.length + 1 || costs.some(row => !Array.isArray(row) || row.length !== customers.length + 1 || row.some(v => !Number.isFinite(v) || v < 0))) throw new Error('ماتریس هزینه معتبر نیست.')
  if (customers.some(c => !Number.isFinite(c.demand) || c.demand <= 0)) throw new Error('تقاضای مشتری‌ها باید مثبت باشد.')
  if (vehicles.some(v => !Number.isFinite(v.capacity) || v.capacity <= 0)) throw new Error('ظرفیت خودروها باید مثبت باشد.')
  if (customers.some(c => !vehicles.some(v => v.capacity + 1e-9 >= c.demand))) throw new Error('تقاضای حداقل یک مشتری از ظرفیت تمام خودروها بیشتر است.')
  const totalDemand = customers.reduce((s, c) => s + c.demand, 0)
  const totalCapacity = vehicles.reduce((s, v) => s + v.capacity, 0)
  if (totalDemand > totalCapacity + 1e-9) throw new Error('ظرفیت کل ناوگان برای کل تقاضا کافی نیست.')
}

function exactSolve(payload, started) {
  validate(payload)
  const { costs, customers, vehicles, deadlineMs = 5000 } = payload
  const n = customers.length
  if (n > 12) throw new Error('__TOO_LARGE__')
  const states = 1 << n
  const full = states - 1

  const demandSum = new Float64Array(states)
  for (let mask = 1; mask < states; mask++) {
    const bit = mask & -mask
    const j = 31 - Math.clz32(bit)
    demandSum[mask] = demandSum[mask ^ bit] + customers[j].demand
  }

  const size = states * n
  const dp = new Float64Array(size)
  dp.fill(INF)
  const parent = new Int16Array(size)
  parent.fill(-1)
  for (let j = 0; j < n; j++) dp[(1 << j) * n + j] = costs[0][j + 1]

  for (let mask = 1; mask < states; mask++) {
    if ((mask & 127) === 0) checkDeadline(started, deadlineMs)
    for (let j = 0; j < n; j++) {
      if (!(mask & (1 << j))) continue
      const prevMask = mask ^ (1 << j)
      if (!prevMask) continue
      let best = INF
      let bestK = -1
      for (let k = 0; k < n; k++) {
        if (!(prevMask & (1 << k))) continue
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
    let best = INF
    let end = -1
    for (let j = 0; j < n; j++) {
      if (!(mask & (1 << j))) continue
      const value = dp[mask * n + j] + costs[j + 1][0]
      if (value < best) { best = value; end = j }
    }
    tourCost[mask] = best
    tourEnd[mask] = end
  }

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
    pMask.fill(-1)
    pSub.fill(-1)
    const cap = vehicles[vi].capacity

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

  if (!Number.isFinite(prev[full])) throw new Error('با ظرفیت خودروهای فعلی، پوشش همه مشتری‌ها ممکن نشد.')
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
    const indices = reconstructTour(sub, tourEnd[sub], n, parent)
    routes.push({
      vehicleId: vehicles[vi].id,
      indices,
      load: indices.reduce((s, i) => s + customers[i].demand, 0),
      objectiveValue: tourCost[sub],
    })
  })
  return { method: 'exact', optimal: true, routes, objectiveValue: prev[full] }
}

function reconstructTour(mask, end, n, parent) {
  const reversed = []
  let current = end
  let currentMask = mask
  while (current >= 0) {
    reversed.push(current)
    const previous = parent[currentMask * n + current]
    currentMask ^= (1 << current)
    current = previous
  }
  return reversed.reverse()
}

function heuristicSolve(payload, started) {
  validate(payload)
  const { costs, customers, vehicles, deadlineMs = 3500, objective = 'distance' } = payload
  const assignments = assignByCapacity(customers, vehicles, started, deadlineMs)
  const routes = []
  let objectiveValue = 0
  const toleranceAbs = objective === 'time' ? 5 : 10

  assignments.forEach((indices, vi) => {
    if (!indices.length) return
    const ordered = buildRoute(indices, customers, costs, toleranceAbs)
    const improved = twoOpt(ordered, costs)
    const cost = routeCost(improved, costs)
    objectiveValue += cost
    routes.push({
      vehicleId: vehicles[vi].id,
      indices: improved,
      load: improved.reduce((s, i) => s + customers[i].demand, 0),
      objectiveValue: cost,
    })
  })
  return { method: 'heuristic', optimal: false, routes, objectiveValue }
}

function assignByCapacity(customers, vehicles, started, deadlineMs) {
  const order = customers.map((c, i) => i).sort((a, b) => customers[b].demand - customers[a].demand || customers[b].priority - customers[a].priority)
  const remaining = vehicles.map(v => v.capacity)
  const bins = vehicles.map(() => [])
  let nodes = 0

  function dfs(pos) {
    if (pos === order.length) return true
    if (++nodes > 120000 || performance.now() - started > Math.min(deadlineMs, 1200)) return false
    const ci = order[pos]
    const demand = customers[ci].demand
    const candidates = vehicles.map((_, vi) => vi)
      .filter(vi => remaining[vi] + 1e-9 >= demand)
      .sort((a, b) => (remaining[a] - demand) - (remaining[b] - demand))
    const seen = new Set()
    for (const vi of candidates) {
      const key = remaining[vi].toFixed(6)
      if (seen.has(key)) continue
      seen.add(key)
      remaining[vi] -= demand
      bins[vi].push(ci)
      if (dfs(pos + 1)) return true
      bins[vi].pop()
      remaining[vi] += demand
    }
    return false
  }

  if (!dfs(0)) {
    remaining.splice(0, remaining.length, ...vehicles.map(v => v.capacity))
    bins.forEach(b => b.splice(0))
    for (const ci of order) {
      const demand = customers[ci].demand
      const vi = vehicles.map((_, i) => i)
        .filter(i => remaining[i] + 1e-9 >= demand)
        .sort((a, b) => remaining[a] - remaining[b])[0]
      if (vi === undefined) throw new Error('روش ابتکاری نتوانست یک تخصیص ظرفیت‌پذیر پیدا کند؛ ترکیب ظرفیت خودروها را بازبینی کنید یا حالت دقیق را امتحان کنید.')
      bins[vi].push(ci)
      remaining[vi] -= demand
    }
  }
  return bins
}

function buildRoute(indices, customers, costs, toleranceAbs) {
  const remaining = [...indices]
  remaining.sort((a, b) => customers[b].priority - customers[a].priority || costs[0][b + 1] - costs[0][a + 1])
  const route = [remaining.shift()]
  while (remaining.length) {
    const candidates = []
    for (const ci of remaining) {
      for (let pos = 0; pos <= route.length; pos++) {
        const prev = pos === 0 ? 0 : route[pos - 1] + 1
        const next = pos === route.length ? 0 : route[pos] + 1
        const delta = costs[prev][ci + 1] + costs[ci + 1][next] - costs[prev][next]
        candidates.push({ ci, pos, delta, priority: customers[ci].priority })
      }
    }
    const minDelta = Math.min(...candidates.map(c => c.delta))
    // The selected objective remains primary. Priority only breaks near-ties.
    const tolerance = Math.max(toleranceAbs, Math.abs(minDelta) * 0.02)
    const nearBest = candidates.filter(c => c.delta <= minDelta + tolerance)
      .sort((a, b) => b.priority - a.priority || a.pos - b.pos || a.delta - b.delta)
    const best = nearBest[0]
    route.splice(best.pos, 0, best.ci)
    remaining.splice(remaining.indexOf(best.ci), 1)
  }
  return route
}

function routeCost(route, costs) {
  if (!route.length) return 0
  let total = costs[0][route[0] + 1]
  for (let i = 0; i < route.length - 1; i++) total += costs[route[i] + 1][route[i + 1] + 1]
  return total + costs[route.at(-1) + 1][0]
}

function twoOpt(route, costs) {
  if (route.length < 4) return [...route]
  let best = [...route]
  let bestCost = routeCost(best, costs)
  let improved = true
  let guard = 0
  while (improved && guard++ < 30) {
    improved = false
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)]
        const cost = routeCost(candidate, costs)
        if (cost + 1e-7 < bestCost) {
          best = candidate
          bestCost = cost
          improved = true
        }
      }
    }
  }
  return best
}
