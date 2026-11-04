import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPeopleQuery, copyFilters, describeFilters, emptyFilters, isEmptyFilters } from "../src/filters.js";

const OPTIONS = {
  cities: [{ id: "taipei", name: "臺北市" }],
  interests: [
    { id: "hiking", name: "爬山" },
    { id: "museum", name: "看展" },
  ],
};

test("empty filters omit every query parameter", () => {
  assert.equal(buildPeopleQuery(emptyFilters()), "");
  assert.ok(isEmptyFilters(emptyFilters()));
});

test("interests become repeated, de-duplicated parameters", () => {
  const query = buildPeopleQuery({ city: "taipei", interests: ["hiking", "museum", "hiking"] });
  assert.equal(query, "city=taipei&interest=hiking&interest=museum");
});

test("copyFilters returns an independent snapshot", () => {
  const original = { city: null, interests: ["hiking"] };
  const snapshot = copyFilters(original);
  original.interests.push("museum");
  assert.deepEqual(snapshot.interests, ["hiking"]);
});

test("descriptions use option names in option order", () => {
  assert.equal(describeFilters(emptyFilters(), OPTIONS), "全部可探索人物");
  assert.equal(describeFilters({ city: "taipei", interests: ["museum", "hiking"] }, OPTIONS), "臺北市；爬山、看展");
  assert.equal(describeFilters({ city: null, interests: ["museum"] }, OPTIONS), "不限城市；看展");
  assert.equal(describeFilters({ city: "taipei", interests: [] }, OPTIONS), "臺北市；不限興趣");
});
