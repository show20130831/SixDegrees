"""Two-hop exploration: distances, scope boundary, cycles and connecting friends."""

from app.services.network import Network, build_adjacency, shortest_distances

EXPLORABLE_IDS = ["u01", "u02", "u03", "u04", "u05", "u06", "u07", "u08", "u09"]


def test_scope_contains_viewer_and_nine_explorable_people(network: Network) -> None:
    assert [node.person.id for node in network.nodes] == ["u00", *EXPLORABLE_IDS]
    assert [node.person.id for node in network.explorable()] == EXPLORABLE_IDS


def test_people_beyond_two_hops_or_disconnected_are_excluded(network: Network) -> None:
    ids = {node.person.id for node in network.nodes}
    assert "u10" not in ids  # distance 3
    assert "u11" not in ids  # no friendships


def test_cycle_uses_shortest_distance_without_duplicates(network: Network) -> None:
    distances = {node.person.id: node.distance for node in network.nodes}
    # u04-u05 closes a cycle; both remain at distance 2.
    assert distances["u04"] == 2
    assert distances["u05"] == 2
    assert len(distances) == len(network.nodes)


def test_via_ids_list_every_connecting_direct_friend(network: Network) -> None:
    via = {node.person.id: node.via_ids for node in network.nodes}
    assert via["u05"] == ("u01", "u02")
    assert via["u04"] == ("u01",)
    assert via["u01"] == ()
    assert via["u00"] == ()


def test_edges_are_limited_to_scope_and_normalized(network: Network) -> None:
    assert ("u04", "u10") not in network.edges
    assert ("u04", "u05") in network.edges
    assert all(first < second for first, second in network.edges)
    assert list(network.edges) == sorted(network.edges)
    assert len(network.edges) == 11


def test_bfs_stops_at_max_distance() -> None:
    adjacency = build_adjacency((("a", "b"), ("b", "c"), ("c", "d")))
    assert shortest_distances(adjacency, "a", max_distance=2) == {"a": 0, "b": 1, "c": 2}
