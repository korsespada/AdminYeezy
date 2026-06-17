export function isPriceOnRequest(price: number | string | null | undefined) {
  const value = Number(price) || 0
  return value <= 0
}

export function isPriceCentsOnRequest(priceCents: number | string | null | undefined) {
  const value = Number(priceCents) || 0
  return value <= 0
}
