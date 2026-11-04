// Maps a BigDataCloud reverse-geocoding response to one of our cities.
//
// Pure module: no HTTP, no JSX, no browser or Vite globals, so Node tests import it directly.
// `cities` is the list from /api/options: [{ id, name, iso_code, en_name }].
//
// Rules, in order:
// 1. The response must be an object whose countryCode is TW.
// 2. County codes come from principalSubdivisionCode and localityInfo.administrative[].isoCode.
//    An unknown code is "unrecognized"; codes naming different cities are a "conflict".
// 3. With exactly one code, full names that point to another city are a conflict.
// 4. Only when there is no county code at all may full names decide, and they must agree.
// Town-level fields (city, locality) are never used.
//
// Returns { ok: true, city_id, city_name } or { ok: false, reason }, where reason is one of
// "invalid-response", "missing-country", "outside-taiwan", "unrecognized" or "conflict".

const COUNTY_CODE = /^TW-[A-Z]{3}$/;

export function normalizeCity(response, cities) {
  if (!isPlainObject(response)) {
    return failure("invalid-response");
  }

  const country = normalizeCode(response.countryCode);
  if (country === null) {
    return failure(response.countryCode === undefined || response.countryCode === null ? "missing-country" : "invalid-response");
  }
  if (country === "") {
    return failure("missing-country");
  }
  if (country !== "TW") {
    return failure("outside-taiwan");
  }

  const administrative = readAdministrative(response);
  if (administrative === null) {
    return failure("invalid-response");
  }

  const byCode = new Map(cities.map((city) => [city.iso_code.toUpperCase(), city]));
  const byName = buildNameIndex(cities);

  // County codes.
  const codedCities = new Set();
  const principalCode = normalizeCode(response.principalSubdivisionCode);
  if (principalCode === null && response.principalSubdivisionCode != null) {
    return failure("invalid-response");
  }
  if (principalCode && principalCode !== "TW") {
    const city = byCode.get(principalCode);
    if (!city) {
      return failure("unrecognized");
    }
    codedCities.add(city);
  }
  for (const entry of administrative) {
    const code = normalizeCode(entry.isoCode);
    if (code === null && entry.isoCode != null) {
      return failure("invalid-response");
    }
    if (!code || !COUNTY_CODE.test(code)) {
      continue; // Country-level "TW", missing codes and other levels are not counties.
    }
    const city = byCode.get(code);
    if (!city) {
      return failure("unrecognized");
    }
    codedCities.add(city);
  }
  if (codedCities.size > 1) {
    return failure("conflict");
  }

  // Full names from trusted fields; unrecognized names are ignored.
  const nameValues = [response.principalSubdivision];
  for (const entry of administrative) {
    nameValues.push(entry.name, entry.isoName);
  }
  if (nameValues.some((value) => value != null && typeof value !== "string")) {
    return failure("invalid-response");
  }
  const namedCities = new Set(nameValues.map((value) => lookupName(byName, value)).filter(Boolean));

  if (codedCities.size === 1) {
    const [city] = codedCities;
    if ([...namedCities].some((named) => named !== city)) {
      return failure("conflict");
    }
    return success(city);
  }

  if (namedCities.size === 1) {
    return success([...namedCities][0]);
  }
  return failure(namedCities.size > 1 ? "conflict" : "unrecognized");
}

function readAdministrative(response) {
  const { localityInfo } = response;
  if (localityInfo === undefined || localityInfo === null) {
    return [];
  }
  if (!isPlainObject(localityInfo)) {
    return null;
  }
  const { administrative } = localityInfo;
  if (administrative === undefined || administrative === null) {
    return [];
  }
  if (!Array.isArray(administrative) || !administrative.every(isPlainObject)) {
    return null;
  }
  return administrative;
}

// Chinese names: exact full names, accepting 台 for 臺. English names: case-insensitive,
// ignoring outer and repeated whitespace; "City"/"County" are never dropped.
function buildNameIndex(cities) {
  const index = new Map();
  for (const city of cities) {
    index.set(normalizeChineseName(city.name), city);
    index.set(normalizeEnglishName(city.en_name), city);
  }
  return index;
}

function lookupName(index, value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  return index.get(normalizeChineseName(value)) ?? index.get(normalizeEnglishName(value)) ?? null;
}

function normalizeChineseName(value) {
  return value.trim().replaceAll("台", "臺");
}

function normalizeEnglishName(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

// Returns the trimmed upper-case code, "" for blank, or null when the value is not a string.
function normalizeCode(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : null;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function success(city) {
  return { ok: true, city_id: city.id, city_name: city.name };
}

function failure(reason) {
  return { ok: false, reason };
}
