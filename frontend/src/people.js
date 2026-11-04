// Display helpers shared by the graph, the results list and the details panel.

export const FALLBACK_AVATAR_URL = "/avatar-fallback.svg";

// DiceBear Personas, seeded by person ID so the graph and the card show the same face.
// The 10.x major version is fixed; minor releases may still change pixels slightly.
const AVATAR_BASE_URL = "https://api.dicebear.com/10.x/personas/svg";

// Personas has no gender option, so each person gets a hairstyle from a list that suits
// their gender. The hairstyle is picked here, one value per request, because the public
// API does not validate comma-separated lists consistently.
const HAIRSTYLES = {
  female: ["long", "bobCut", "bobBangs", "pigtails", "curlyBun", "straightBun", "extraLong"],
  male: ["shortCombover", "curlyHighTop", "buzzcut", "fade", "shortComboverChops"],
};

export function avatarUrl(personId, gender) {
  const params = new URLSearchParams({ seed: personId });
  const hairstyles = HAIRSTYLES[gender];
  if (hairstyles) {
    params.set("hairVariant", hairstyles[stableIndex(personId, hairstyles.length)]);
    if (gender === "female") {
      params.set("facialHairProbability", "0");
    }
  }
  return `${AVATAR_BASE_URL}?${params}`;
}

// Same ID, same index: the avatar never changes between renders or visits.
function stableIndex(text, size) {
  let hash = 0;
  for (const char of text) {
    hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  }
  return hash % size;
}

export function distanceLabel(distance) {
  switch (distance) {
    case 0:
      return "你";
    case 1:
      return "直接好友";
    case 2:
      return "朋友的朋友";
    default:
      return "";
  }
}

export function nameOf(lookup, id) {
  return lookup.get(id)?.name ?? id;
}
