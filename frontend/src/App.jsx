import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, describeError, getNetwork, getOptions, searchPeople } from "./api.js";
import { copyFilters, describeFilters, emptyFilters, isEmptyFilters } from "./filters.js";
import FilterPanel from "./components/FilterPanel.jsx";
import PersonDetails from "./components/PersonDetails.jsx";
import RelationshipGraph from "./components/RelationshipGraph.jsx";

const isAborted = (error) => error instanceof ApiError && error.kind === "aborted";

export default function App() {
  // Initialization: options and network form one required batch.
  const [init, setInit] = useState({ status: "loading", options: null, network: null, error: null });

  // Search state. appliedFilters is null until the first successful search.
  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(null);
  const [failedFilters, setFailedFilters] = useState(null);
  const [items, setItems] = useState([]);
  const [hasSuccessfulSearch, setHasSuccessfulSearch] = useState(false);
  const [search, setSearch] = useState({ status: "idle", error: null });
  const [selectedPersonId, setSelectedPersonId] = useState(null);

  const initBatchRef = useRef(0);
  const initControllerRef = useRef(null);
  const searchRequestRef = useRef(0);
  const searchControllerRef = useRef(null);
  const graphAreaRef = useRef(null);
  const nodeElementsRef = useRef(new Map());
  const graphRef = useRef(null);

  const runSearch = useCallback(async (filters) => {
    const snapshot = copyFilters(filters);
    searchControllerRef.current?.abort();
    const controller = new AbortController();
    searchControllerRef.current = controller;
    const requestId = ++searchRequestRef.current;
    setSearch({ status: "loading", error: null });

    try {
      const result = await searchPeople(snapshot, { signal: controller.signal });
      if (requestId !== searchRequestRef.current) {
        return;
      }
      setItems(result);
      setAppliedFilters(snapshot);
      setHasSuccessfulSearch(true);
      setFailedFilters(null);
      setSelectedPersonId(null);
      setSearch({ status: "idle", error: null });
    } catch (error) {
      if (requestId !== searchRequestRef.current) {
        return;
      }
      if (isAborted(error)) {
        setSearch({ status: "idle", error: null });
        return;
      }
      setFailedFilters(snapshot);
      setSearch({ status: "error", error });
    }
  }, []);

  const initialize = useCallback(async () => {
    initControllerRef.current?.abort();
    const controller = new AbortController();
    initControllerRef.current = controller;
    const batch = ++initBatchRef.current;
    setInit({ status: "loading", options: null, network: null, error: null });

    try {
      const [options, network] = await Promise.all([
        getOptions({ signal: controller.signal }),
        getNetwork({ signal: controller.signal }),
      ]);
      if (batch !== initBatchRef.current) {
        return;
      }
      setInit({ status: "ready", options, network, error: null });
      runSearch(emptyFilters());
    } catch (error) {
      controller.abort(); // Cancel whichever request of the batch is still running.
      if (batch !== initBatchRef.current || isAborted(error)) {
        return;
      }
      setInit({ status: "error", options: null, network: null, error });
    }
  }, [runSearch]);

  useEffect(() => {
    initialize();
    return () => {
      initBatchRef.current += 1;
      searchRequestRef.current += 1;
      initControllerRef.current?.abort();
      searchControllerRef.current?.abort();
    };
  }, [initialize]);

  const { options, network } = init;

  const peopleById = useMemo(
    () => new Map((network?.nodes ?? []).map((node) => [node.id, node])),
    [network],
  );
  const citiesById = useMemo(() => new Map((options?.cities ?? []).map((city) => [city.id, city])), [options]);
  const interestsById = useMemo(
    () => new Map((options?.interests ?? []).map((interest) => [interest.id, interest])),
    [options],
  );
  const matchedIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);

  const searching = search.status === "loading";
  const filterActive = hasSuccessfulSearch && appliedFilters !== null && !isEmptyFilters(appliedFilters);
  const selectedPerson = selectedPersonId ? peopleById.get(selectedPersonId) : null;

  const registerNode = useCallback((personId, element) => {
    if (element) {
      nodeElementsRef.current.set(personId, element);
    } else {
      nodeElementsRef.current.delete(personId);
    }
  }, []);

  const selectPerson = (personId) => {
    if (peopleById.has(personId)) {
      setSelectedPersonId((current) => (current === personId ? null : personId));
    }
  };

  // Closing the card returns keyboard focus to the person it belonged to.
  const closeDetails = useCallback(() => {
    if (selectedPersonId !== null) {
      nodeElementsRef.current.get(selectedPersonId)?.focus();
    }
    setSelectedPersonId(null);
  }, [selectedPersonId]);

  const toggleInterest = (interestId) => {
    setDraftFilters((draft) => ({
      ...draft,
      interests: draft.interests.includes(interestId)
        ? draft.interests.filter((id) => id !== interestId)
        : [...draft.interests, interestId],
    }));
  };

  const clearFilters = () => {
    setDraftFilters(emptyFilters());
    runSearch(emptyFilters());
  };

  return (
    <div className="app">
      <header className="site-header">
        <h1>近緣 <span className="brand__sub">SixDegrees</span></h1>
        <p className="demo-badge">展示模式／人物皆為虛構</p>
      </header>

      {init.status === "loading" && <p className="status-block" role="status">正在載入人際網路…</p>}

      {init.status === "error" && (
        <div className="status-block notice notice--error" role="alert">
          <p>無法載入示範資料：{describeError(init.error)}</p>
          <button type="button" className="button button--primary" onClick={initialize}>重試</button>
        </div>
      )}

      {init.status === "ready" && (
        <>
          <FilterPanel
            draft={draftFilters}
            options={options}
            disabled={searching}
            onCityChange={(city) => setDraftFilters((draft) => ({ ...draft, city }))}
            onToggleInterest={toggleInterest}
            onApply={() => runSearch(draftFilters)}
            onClear={clearFilters}
          >
            <SearchStatus
              hasSuccessfulSearch={hasSuccessfulSearch}
              appliedFilters={appliedFilters}
              filterActive={filterActive}
              matchCount={items.length}
              searching={searching}
              error={search.status === "error" ? search.error : null}
              failedFilters={failedFilters}
              options={options}
              onRetry={() => runSearch(failedFilters ?? emptyFilters())}
            />
          </FilterPanel>

          {/* The card lives outside the isolated .graph-area, so it always stacks above the 3D name labels. */}
          <main className="graph-wrap" ref={graphAreaRef}>
            <div className="graph-area">
              <RelationshipGraph
                ref={graphRef}
                network={network}
                selectedId={selectedPersonId}
                matchedIds={matchedIds}
                filterActive={filterActive}
                onSelect={selectPerson}
                registerNode={registerNode}
                onBackgroundClick={() => setSelectedPersonId(null)}
              />
            </div>
            {selectedPerson && (
              <PersonDetails
                person={selectedPerson}
                graph={graphRef.current}
                container={graphAreaRef.current}
                peopleById={peopleById}
                citiesById={citiesById}
                interestsById={interestsById}
                notMatching={filterActive && selectedPerson.distance > 0 && !matchedIds.has(selectedPerson.id)}
                onClose={closeDetails}
              />
            )}
          </main>
        </>
      )}

      <footer className="site-footer">
        <p>近緣 SixDegrees 展示版。所有人物、好友關係與簡介皆為虛構，「關係距離」僅代表最短好友連結數。</p>
      </footer>
    </div>
  );
}

function SearchStatus({
  hasSuccessfulSearch,
  appliedFilters,
  filterActive,
  matchCount,
  searching,
  error,
  failedFilters,
  options,
  onRetry,
}) {
  return (
    <>
      {searching && <p className="muted" role="status">搜尋中…</p>}

      {!searching && hasSuccessfulSearch && !filterActive && (
        <p className="status-line">目前顯示全部可探索的人（{matchCount} 位）。選擇條件後按「套用篩選」，符合的人頭像框線會閃爍。</p>
      )}

      {!searching && filterActive && matchCount > 0 && (
        <p className="status-line">
          目前條件：{describeFilters(appliedFilters, options)}，符合 <strong>{matchCount}</strong> 位（頭像框線閃爍）。點頭像可查看資料。
        </p>
      )}

      {!searching && filterActive && matchCount === 0 && (
        <p className="status-line notice">沒有符合條件的人，請調整篩選。（條件：{describeFilters(appliedFilters, options)}）</p>
      )}

      {error && (
        <div className="notice notice--error" role="alert">
          <p>
            搜尋失敗：{describeError(error)}
            {failedFilters && <><br />未套用的條件：{describeFilters(failedFilters, options)}</>}
            {hasSuccessfulSearch && <><br />圖上仍顯示上一次成功的結果。</>}
          </p>
          <button type="button" className="button" onClick={onRetry} disabled={searching}>重試</button>
        </div>
      )}
    </>
  );
}
