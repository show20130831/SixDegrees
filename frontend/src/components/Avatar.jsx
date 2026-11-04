import { useState } from "react";
import { FALLBACK_AVATAR_URL, avatarUrl } from "../people.js";

// Tries the primary avatar, then the local fallback exactly once, then gives up quietly.
// Callers remount it per person (key={person.id}) so the retry state never leaks between people.
export function useAvatarSource(personId) {
  const [stage, setStage] = useState(0);
  const sources = [avatarUrl(personId), FALLBACK_AVATAR_URL];
  return {
    src: sources[stage] ?? null,
    onError: () => setStage((current) => current + 1),
  };
}

// Without a size the avatar fills its container, so CSS controls the dimensions.
export default function Avatar({ personId, name, size }) {
  const { src, onError } = useAvatarSource(personId);
  const style = size ? { width: size, height: size } : undefined;
  if (src === null) {
    return <span className="avatar avatar--empty" style={style} aria-hidden="true" />;
  }
  return (
    <img
      className="avatar"
      style={style}
      src={src}
      alt={`${name}的頭像`}
      draggable={false}
      onError={onError}
    />
  );
}
