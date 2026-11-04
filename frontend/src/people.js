// Display helpers shared by the graph, the results list and the details panel.

export const FALLBACK_AVATAR_URL = "/avatar-fallback.svg";

// External avatars are added in a later phase; until then every person uses the local fallback.
export function avatarUrl(_personId) {
  return FALLBACK_AVATAR_URL;
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
