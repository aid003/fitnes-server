const KOPECKS_IN_RUBLE = 100;

export function rublesToKopecks(amountRubles: number) {
  assertFiniteAmount(amountRubles, 'rubles');

  return Math.round(amountRubles * KOPECKS_IN_RUBLE);
}

export function kopecksToRubles(amountKopecks: number) {
  assertFiniteAmount(amountKopecks, 'kopecks');

  return amountKopecks / KOPECKS_IN_RUBLE;
}

export function toGatewayAmount(amountKopecks: number, currency: string) {
  assertFiniteAmount(amountKopecks, 'kopecks');
  assertSupportedCurrency(currency);

  return String(Math.round(amountKopecks));
}

function assertFiniteAmount(value: number, unit: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${unit} amount`);
  }
}

function assertSupportedCurrency(currency: string) {
  if (currency.trim().toUpperCase() !== 'RUB') {
    throw new Error(`Unsupported currency: ${currency}`);
  }
}

