const GEO_STAGE_MESSAGES = {
  "awaiting-permission": "請在瀏覽器選擇是否允許定位。",
  locating: "正在取得你的位置…",
  lookup: "正在查詢所在縣市…",
};

export default function FilterPanel({
  draft,
  options,
  disabled,
  geo,
  onCityChange,
  onLocate,
  onCancelLocate,
  onToggleInterest,
  onApply,
  onClear,
  children,
}) {
  return (
    <section className="filter-panel" aria-labelledby="filter-heading">
      <h2 id="filter-heading">篩選條件</h2>

      <div className="filter-panel__controls">
        <div className="filter-panel__field">
          <label htmlFor="city-select" className="field-label">城市</label>
          <select
            id="city-select"
            value={draft.city ?? ""}
            disabled={disabled}
            onChange={(event) => onCityChange(event.target.value === "" ? null : event.target.value)}
          >
            <option value="">不限城市</option>
            {options.cities.map((city) => (
              <option key={city.id} value={city.id}>{city.name}</option>
            ))}
          </select>

          <div className="locate">
            <button
              type="button"
              className="button button--small"
              onClick={onLocate}
              disabled={disabled || geo.status === "working"}
            >
              使用我的城市
            </button>
            {geo.status === "working" && (
              <button type="button" className="button button--small button--quiet" onClick={onCancelLocate}>
                取消定位
              </button>
            )}
          </div>
          <p
            className={geo.status === "error" ? "locate__status locate__status--error" : "locate__status"}
            role="status"
            aria-live="polite"
          >
            {geo.status === "working" ? GEO_STAGE_MESSAGES[geo.stage] : geo.message}
          </p>
        </div>

        <fieldset className="filter-panel__field" disabled={disabled}>
          <legend className="field-label">興趣（可複選，符合任一項即可）</legend>
          <div className="chips">
            {options.interests.map((interest) => {
              const active = draft.interests.includes(interest.id);
              return (
                <button
                  key={interest.id}
                  type="button"
                  className={active ? "chip chip--active" : "chip"}
                  aria-pressed={active}
                  onClick={() => onToggleInterest(interest.id)}
                >
                  {interest.name}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="filter-panel__actions">
          <button type="button" className="button button--primary" onClick={onApply} disabled={disabled}>
            套用篩選
          </button>
          <button type="button" className="button" onClick={onClear} disabled={disabled}>
            清除條件
          </button>
        </div>
      </div>

      <div className="filter-panel__status">{children}</div>
    </section>
  );
}
