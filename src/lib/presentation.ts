const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Los_Angeles",
});
const valueFormatter = new Intl.NumberFormat("en-US");
const currencyFormatters = new Map<string, Intl.NumberFormat>();

export const displayDate = (value: Date): string => dateFormatter.format(value);

export const displayRelativeFreshness = (value: Date | null): string =>
  value ? displayDate(value) : "unknown";

const currencyFormatter = (currency: string): Intl.NumberFormat => {
  const existing = currencyFormatters.get(currency);
  if (existing) return existing;
  const created = new Intl.NumberFormat("en-US", { currency, style: "currency" });
  currencyFormatters.set(currency, created);
  return created;
};

export const displayMoney = (value: number | null, currency = "USD"): string =>
  value === null ? "unknown" : currencyFormatter(currency).format(value);

export const displayValue = (value: number | null): string =>
  value === null ? "unknown" : valueFormatter.format(value);
