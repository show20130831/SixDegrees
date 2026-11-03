"""Filter and rank explorable people by city and interests."""

from __future__ import annotations

from dataclasses import dataclass

from app.services.network import Network


@dataclass(frozen=True)
class SearchResult:
    id: str
    distance: int
    matched_interest_ids: tuple[str, ...]

    @property
    def matched_interest_count(self) -> int:
        return len(self.matched_interest_ids)


def search_people(
    network: Network,
    interest_order: dict[str, int],
    city_id: str | None = None,
    interest_ids: frozenset[str] = frozenset(),
) -> list[SearchResult]:
    """Return matches ordered by distance asc, matched interest count desc, id asc.

    The city filter is an exact match; interests use OR semantics; the two are combined
    with AND. An absent filter means "no restriction". Inputs are assumed to be validated.
    """
    results = []
    for node in network.explorable():
        person = node.person
        if city_id is not None and person.city_id != city_id:
            continue
        matched = interest_ids.intersection(person.interest_ids)
        if interest_ids and not matched:
            continue
        ordered = tuple(sorted(matched, key=interest_order.__getitem__))
        results.append(SearchResult(person.id, node.distance, ordered))

    results.sort(key=lambda result: (result.distance, -result.matched_interest_count, result.id))
    return results
