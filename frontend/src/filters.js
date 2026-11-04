// Pure helpers for search filter state. A filter set is { city: string | null, interests: string[] }.

export function emptyFilters() {
  return { city: null, interests: [] };
}

export function copyFilters(filters) {
  return { city: filters.city, interests: [...filters.interests] };
}

export function isEmptyFilters(filters) {
  return filters.city === null && filters.interests.length === 0;
}

// Builds the /api/people query string. City is omitted when unrestricted;
// each interest is appended as a repeated parameter, de-duplicated.
export function buildPeopleQuery(filters) {
  const params = new URLSearchParams();
  if (filters.city !== null) {
    params.append("city", filters.city);
  }
  for (const interest of new Set(filters.interests)) {
    params.append("interest", interest);
  }
  return params.toString();
}

// Human-readable summary of applied filters, using option names from /api/options.
export function describeFilters(filters, options) {
  if (isEmptyFilters(filters)) {
    return "全部可探索人物";
  }
  const cityName = filters.city === null
    ? "不限城市"
    : options.cities.find((city) => city.id === filters.city)?.name ?? filters.city;
  const interestNames = options.interests
    .filter((interest) => filters.interests.includes(interest.id))
    .map((interest) => interest.name);
  const interestText = interestNames.length > 0 ? interestNames.join("、") : "不限興趣";
  return `${cityName}；${interestText}`;
}
