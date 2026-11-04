import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Avatar from "./Avatar.jsx";
import { distanceLabel, nameOf } from "../people.js";

const CARD_GAP = 14;
// The card stays below the graph's rotate/reset controls in the top corner.
const CARD_MIN_TOP = 56;
const NARROW_QUERY = "(max-width: 640px)";

// Places the card beside the anchor box (right side first, then left), clamped to the container.
function computePlacement(anchorBox, container, card) {
  const containerBox = container.getBoundingClientRect();
  const width = card.offsetWidth;
  const height = card.offsetHeight;

  let left = anchorBox.right - containerBox.left + CARD_GAP;
  if (left + width > containerBox.width) {
    left = anchorBox.left - containerBox.left - CARD_GAP - width;
  }
  left = Math.max(8, Math.min(left, containerBox.width - width - 8));

  let top = anchorBox.top - containerBox.top + anchorBox.height / 2 - height / 2;
  top = Math.max(CARD_MIN_TOP, Math.min(top, containerBox.height - height - 8));
  return { left: Math.round(left), top: Math.round(top) };
}

// graph: the RelationshipGraph handle; the card follows the avatar while the view rotates.
export default function PersonDetails({
  person,
  graph,
  container,
  peopleById,
  citiesById,
  interestsById,
  notMatching,
  onClose,
}) {
  const cardRef = useRef(null);
  const [placement, setPlacement] = useState(null);
  const isViewer = person.distance === 0;
  const connectors = person.via_ids
    .map((id) => peopleById.get(id)?.display_name)
    .filter(Boolean);

  // placement: null until measured, then { mode: "sheet" } or { mode: "float", left, top }.
  useLayoutEffect(() => {
    const update = () => {
      const anchorBox = graph?.anchorRect(person.id) ?? null;
      if (window.matchMedia(NARROW_QUERY).matches || !anchorBox || !container || !cardRef.current) {
        setPlacement((current) => (current?.mode === "sheet" ? current : { mode: "sheet" }));
        return;
      }
      const next = computePlacement(anchorBox, container, cardRef.current);
      setPlacement((current) =>
        current?.mode === "float" && current.left === next.left && current.top === next.top
          ? current
          : { mode: "float", ...next },
      );
    };
    update();
    const unsubscribe = graph?.subscribeView(update);
    window.addEventListener("resize", update);
    return () => {
      unsubscribe?.();
      window.removeEventListener("resize", update);
    };
  }, [graph, container, person.id]);

  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <section
      ref={cardRef}
      className={placement?.mode === "sheet" ? "person-card person-card--sheet" : "person-card"}
      style={
        placement === null
          ? { visibility: "hidden" }
          : placement.mode === "float"
            ? { left: placement.left, top: placement.top }
            : undefined
      }
      role="dialog"
      aria-modal="false"
      aria-labelledby="person-card-heading"
    >
      <div className="person-card__header">
        <Avatar key={person.id} personId={person.id} gender={person.gender} name={person.display_name} size={56} />
        <div className="person-card__title">
          <h2 id="person-card-heading">
            {person.display_name}
            <span className={`tag tag--d${person.distance}`}>{distanceLabel(person.distance)}</span>
          </h2>
          {notMatching && <p className="tag tag--muted">不符合目前篩選</p>}
        </div>
        <button type="button" className="icon-button person-card__close" onClick={onClose} aria-label="關閉人物資料" title="關閉">
          ✕
        </button>
      </div>

      <p className="person-card__bio">{person.bio}</p>

      <dl className="person-card__facts">
        <dt>居住城市</dt>
        <dd>{nameOf(citiesById, person.city_id)}</dd>
        <dt>興趣</dt>
        <dd>{person.interest_ids.map((id) => nameOf(interestsById, id)).join("、")}</dd>
        <dt>關係</dt>
        <dd>
          {isViewer && "示範使用者本人"}
          {person.distance === 1 && "直接好友"}
          {person.distance === 2 && `朋友的朋友，透過 ${connectors.join("、")} 認識`}
        </dd>
      </dl>
    </section>
  );
}
