const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function paiseToRupees(paise) {
  return paise / 100;
}

export function formatPaise(paise) {
  if (typeof paise !== 'number' || Number.isNaN(paise)) return '—';
  return inr.format(paiseToRupees(paise));
}
