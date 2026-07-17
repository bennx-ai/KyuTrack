// Per-expense debt tracking. Each split expense's participants carry their own
// `settled` state directly (see app.js), so balances are just a live rollup of
// whichever shares haven't been marked paid yet — no separate ledger to keep in sync.

/**
 * Net balance per person across all *unsettled* shares.
 * Positive = is owed money (net creditor), negative = owes money (net debtor).
 * @param {Array} expenses
 * @returns {Map<number, number>}
 */
function computeNetBalances(expenses) {
  const balances = new Map();
  const add = (id, delta) => balances.set(id, Math.round(((balances.get(id) || 0) + delta) * 100) / 100);

  for (const exp of expenses) {
    if (!exp.isSplit || !Array.isArray(exp.participants)) continue;
    for (const p of exp.participants) {
      if (p.personId === exp.payerId || p.settled) continue;
      add(exp.payerId, p.amount);
      add(p.personId, -p.amount);
    }
  }
  return balances;
}

/** Splits `total` (integer yen) equally among `count` people, distributing the
 * rounding remainder to the first participants so the sum is always exact. */
function splitEqual(total, count) {
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  const shares = new Array(count).fill(base);
  for (let i = 0; i < remainder; i++) shares[i] += 1;
  return shares;
}

/** Adds `taxTotal` (integer yen) on top of each person's `baseAmounts`, split
 * proportionally to what they actually ordered (largest-remainder rounding so
 * the sum is always exact). If nobody has a base amount yet, falls back to an
 * even split of the tax alone. */
function splitProportional(baseAmounts, taxTotal) {
  const baseSum = baseAmounts.reduce((a, b) => a + b, 0);
  if (baseSum <= 0) {
    const taxShares = splitEqual(taxTotal, baseAmounts.length);
    return baseAmounts.map((b, i) => b + taxShares[i]);
  }
  const rawTaxShares = baseAmounts.map((b) => (taxTotal * b) / baseSum);
  const floorShares = rawTaxShares.map(Math.floor);
  const allocated = floorShares.reduce((a, b) => a + b, 0);
  const remainder = taxTotal - allocated;
  const order = rawTaxShares
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder; k++) floorShares[order[k].i] += 1;
  return baseAmounts.map((b, i) => b + floorShares[i]);
}
