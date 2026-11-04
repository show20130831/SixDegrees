import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { GraphScene } from "../graph3d/GraphScene.js";
import { distanceLabel } from "../people.js";

const ROTATE_STEP_DEGREES = 45;

// WebGL relationship graph. The camera orbits left and right around the viewer.
// A list of real buttons mirrors the people for keyboard and screen-reader users; it
// becomes the visible fallback when WebGL is unavailable.
export default function RelationshipGraph({
  ref,
  network,
  selectedId,
  matchedIds,
  filterActive,
  onSelect,
  registerNode,
  onBackgroundClick,
}) {
  const viewportRef = useRef(null);
  const sceneRef = useRef(null);
  const viewListenersRef = useRef(new Set());
  const [webglFailed, setWebglFailed] = useState(false);
  const [focusedId, setFocusedId] = useState(null);

  // The scene is built once per network, so it reads the latest callbacks through a ref.
  const callbacksRef = useRef({ onSelect, onBackgroundClick });
  callbacksRef.current = { onSelect, onBackgroundClick };

  useEffect(() => {
    let scene;
    try {
      scene = new GraphScene(viewportRef.current, {
        onSelect: (id) => callbacksRef.current.onSelect(id),
        onBackgroundClick: () => callbacksRef.current.onBackgroundClick(),
        onViewChange: () => viewListenersRef.current.forEach((listener) => listener()),
      });
    } catch {
      setWebglFailed(true);
      return undefined;
    }
    scene.setGraph(network.nodes, network.edges);
    sceneRef.current = scene;
    return () => {
      sceneRef.current = null;
      scene.dispose();
    };
  }, [network]);

  useEffect(() => {
    sceneRef.current?.setAppearance({ matchedIds, filterActive, selectedId, focusedId });
  }, [matchedIds, filterActive, selectedId, focusedId, network]);

  useImperativeHandle(
    ref,
    () => ({
      anchorRect: (personId) => sceneRef.current?.anchorRect(personId) ?? null,
      subscribeView: (listener) => {
        viewListenersRef.current.add(listener);
        return () => viewListenersRef.current.delete(listener);
      },
    }),
    [],
  );

  const people = network.nodes;

  return (
    <div className={webglFailed ? "graph graph--fallback" : "graph"}>
      <div ref={viewportRef} className="graph-viewport" aria-hidden="true" />

      {webglFailed && <p className="notice graph-fallback-note">此瀏覽器無法顯示 3D 關係圖，改以清單呈現。</p>}

      <ul className="graph-people" aria-label="示範使用者的兩層人際關係">
        {people.map((node) => {
          const isViewer = node.distance === 0;
          const matched = filterActive && !isViewer && matchedIds.has(node.id);
          const dimmed = filterActive && !isViewer && !matched;
          const label = [
            node.display_name,
            distanceLabel(node.distance),
            matched ? "符合目前篩選" : null,
            dimmed ? "不符合目前篩選" : null,
          ].filter(Boolean).join("，");
          return (
            <li key={node.id}>
              <button
                ref={(element) => registerNode(node.id, element)}
                type="button"
                className={matched ? "graph-person graph-person--matched" : "graph-person"}
                aria-label={label}
                aria-pressed={node.id === selectedId}
                aria-haspopup="dialog"
                onClick={() => onSelect(node.id)}
                onFocus={(event) => setFocusedId(event.currentTarget.matches(":focus-visible") ? node.id : null)}
                onBlur={() => setFocusedId(null)}
              >
                {node.display_name}
                <span className="graph-person__meta">{distanceLabel(node.distance)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {!webglFailed && (
        <div className="graph-controls">
          <button type="button" className="icon-button" onClick={() => sceneRef.current?.rotateBy(-ROTATE_STEP_DEGREES)} aria-label="向左旋轉" title="向左旋轉">
            ⟲
          </button>
          <button type="button" className="button button--small" onClick={() => sceneRef.current?.resetView()}>
            重設視角
          </button>
          <button type="button" className="icon-button" onClick={() => sceneRef.current?.rotateBy(ROTATE_STEP_DEGREES)} aria-label="向右旋轉" title="向右旋轉">
            ⟳
          </button>
        </div>
      )}

      <ul className="legend" aria-label="圖例">
        <li><span className="legend__frame legend__frame--d0" />你</li>
        <li><span className="legend__frame legend__frame--d1" />朋友（實線）</li>
        <li><span className="legend__frame legend__frame--d2" />朋友的朋友（虛線）</li>
        {filterActive && <li><span className="legend__frame legend__frame--match" />符合篩選（閃爍）</li>}
        {!webglFailed && <li className="legend__hint">左右拖曳可旋轉</li>}
      </ul>
    </div>
  );
}
