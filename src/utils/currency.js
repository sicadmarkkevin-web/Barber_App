/** Formats a numeric price as Philippine pesos, e.g. formatPHP(200) -> "₱200". */
export function formatPHP(amount) {
  const n = Number(amount) || 0;
  const hasCents = Math.round(n * 100) % 100 !== 0;
  return `₱${n.toLocaleString("en-PH", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}
