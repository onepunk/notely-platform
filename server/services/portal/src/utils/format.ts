export const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

export const formatPercent = (value: number, maximumFractionDigits = 0) =>
  `${value.toFixed(maximumFractionDigits)}%`;
