export type CountryOption = {
  code: string;
  name: string;
  flag: string;
};

const COUNTRY_ROWS: ReadonlyArray<readonly [string, string]> = [
  ["IN", "India"], ["US", "United States"], ["GB", "United Kingdom"],
  ["AU", "Australia"], ["CA", "Canada"], ["DE", "Germany"],
  ["FR", "France"], ["IT", "Italy"], ["ES", "Spain"],
  ["PT", "Portugal"], ["NL", "Netherlands"], ["BE", "Belgium"],
  ["CH", "Switzerland"], ["AT", "Austria"], ["SE", "Sweden"],
  ["NO", "Norway"], ["DK", "Denmark"], ["FI", "Finland"],
  ["IE", "Ireland"], ["PL", "Poland"], ["GR", "Greece"],
  ["TR", "Turkey"], ["RU", "Russia"], ["UA", "Ukraine"],
  ["JP", "Japan"], ["CN", "China"], ["KR", "South Korea"],
  ["SG", "Singapore"], ["MY", "Malaysia"], ["TH", "Thailand"],
  ["ID", "Indonesia"], ["PH", "Philippines"], ["VN", "Vietnam"],
  ["NP", "Nepal"], ["BT", "Bhutan"], ["BD", "Bangladesh"],
  ["LK", "Sri Lanka"], ["PK", "Pakistan"],
  ["AE", "United Arab Emirates"], ["SA", "Saudi Arabia"],
  ["QA", "Qatar"], ["KW", "Kuwait"], ["OM", "Oman"],
  ["BH", "Bahrain"], ["IL", "Israel"], ["ZA", "South Africa"],
  ["KE", "Kenya"], ["EG", "Egypt"], ["NG", "Nigeria"],
  ["MA", "Morocco"], ["BR", "Brazil"], ["AR", "Argentina"],
  ["CL", "Chile"], ["CO", "Colombia"], ["MX", "Mexico"],
  ["NZ", "New Zealand"],
];

export function getCountryFlag(countryCode: string | null | undefined): string {
  const code = String(countryCode ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return [...code]
    .map((character) => String.fromCodePoint(127397 + character.charCodeAt(0)))
    .join("");
}

export const COUNTRIES: readonly CountryOption[] = COUNTRY_ROWS.map(
  ([code, name]) => ({ code, name, flag: getCountryFlag(code) }),
);

const COUNTRY_CODE_BY_NAME = new Map(
  COUNTRIES.map((country) => [country.name.toLowerCase(), country.code]),
);

const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  IND: "IN",
  INDIAN: "IN",
  USA: "US",
  "UNITED STATES OF AMERICA": "US",
  UK: "GB",
  "GREAT BRITAIN": "GB",
  UAE: "AE",
  KSA: "SA",
};

export function normalizeCountryCode(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  return COUNTRY_ALIASES[upper] || COUNTRY_CODE_BY_NAME.get(raw.toLowerCase()) || "";
}

export function getCountryDisplayName(value: string | null | undefined): string {
  const code = normalizeCountryCode(value);
  return COUNTRIES.find((country) => country.code === code)?.name || String(value ?? "").trim();
}

export function getCountryFlagFromValue(value: string | null | undefined): string {
  return getCountryFlag(normalizeCountryCode(value));
}
