export function normalizePlate(raw: string): string {
  return raw
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s.\-\u2010-\u2015]/gu, "");
}

export function plausiblePlate(plate: string): boolean {
  return /^[0-9]{2}[A-Z]{1,2}[0-9]{4,6}$/.test(plate);
}
