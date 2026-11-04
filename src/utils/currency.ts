/**
 * Formats a monetary amount into Indian Rupees (INR ₹)
 * using the official Indian numbering system (en-IN).
 * Examples: ₹1,000, ₹10,000, ₹1,00,000, ₹10,00,000
 */
export function formatINR(amount: number): string {
  if (isNaN(amount) || amount === null || amount === undefined) {
    return '₹0';
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}
