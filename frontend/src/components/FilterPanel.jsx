export default function FilterPanel({
  draft,
  options,
  disabled,
  onCityChange,
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
