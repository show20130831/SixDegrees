"""Two-hop exploration of the undirected friendship graph."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

from app.data_loader import Dataset, Person

MAX_DISTANCE = 2


@dataclass(frozen=True)
class NetworkNode:
    person: Person
    distance: int
    via_ids: tuple[str, ...]


@dataclass(frozen=True)
class Network:
    viewer_id: str
    nodes: tuple[NetworkNode, ...]
    edges: tuple[tuple[str, str], ...]

    def explorable(self) -> tuple[NetworkNode, ...]:
        """People at distance 1 or 2, excluding the viewer."""
        return tuple(node for node in self.nodes if node.distance > 0)


def build_adjacency(edges: tuple[tuple[str, str], ...]) -> dict[str, set[str]]:
    adjacency: dict[str, set[str]] = {}
    for first, second in edges:
        adjacency.setdefault(first, set()).add(second)
        adjacency.setdefault(second, set()).add(first)
    return adjacency


def shortest_distances(
    adjacency: dict[str, set[str]], origin: str, max_distance: int = MAX_DISTANCE
) -> dict[str, int]:
    """Breadth-first search bounded by max_distance; each person is visited once."""
    distances = {origin: 0}
    queue = deque([origin])
    while queue:
        current = queue.popleft()
        if distances[current] == max_distance:
            continue
        for neighbor in adjacency.get(current, ()):
            if neighbor not in distances:
                distances[neighbor] = distances[current] + 1
                queue.append(neighbor)
    return distances


def build_network(dataset: Dataset) -> Network:
    """Build the fixed two-hop subgraph around the viewer."""
    adjacency = build_adjacency(dataset.edges)
    distances = shortest_distances(adjacency, dataset.viewer_id)
    viewer_friends = adjacency.get(dataset.viewer_id, set())

    nodes = []
    for person_id, distance in distances.items():
        if distance == MAX_DISTANCE:
            via_ids = tuple(sorted(viewer_friends & adjacency.get(person_id, set())))
        else:
            via_ids = ()
        nodes.append(NetworkNode(dataset.people[person_id], distance, via_ids))
    nodes.sort(key=lambda node: (node.distance, node.person.id))

    in_scope = set(distances)
    edges = sorted(
        tuple(sorted(edge))
        for edge in dataset.edges
        if edge[0] in in_scope and edge[1] in in_scope
    )

    return Network(viewer_id=dataset.viewer_id, nodes=tuple(nodes), edges=tuple(edges))
