import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeCity } from "../src/geo/normalizeCity.js";

// The real city list, read from the backend data so there is no second copy to drift.
const { cities } = JSON.parse(readFileSync(new URL("../../app/data/options.json", import.meta.url), "utf8"));

const tw = (fields) => ({ countryCode: "TW", ...fields });
const admin = (...entries) => ({ localityInfo: { administrative: entries } });
const cityOf = (response) => normalizeCity(response, cities);
const reasonOf = (response) => cityOf(response).reason;

test("every one of the 22 county codes maps to its city", () => {
  assert.equal(cities.length, 22);
  for (const city of cities) {
    assert.deepEqual(cityOf(tw({ principalSubdivisionCode: city.iso_code })), {
      ok: true,
      city_id: city.id,
      city_name: city.name,
    });
  }
});

test("Hsinchu and Chiayi counties are told apart from the cities", () => {
  assert.equal(cityOf(tw({ principalSubdivisionCode: "TW-HSZ" })).city_id, "hsinchu-city");
  assert.equal(cityOf(tw({ principalSubdivisionCode: "TW-HSQ" })).city_id, "hsinchu-county");
  assert.equal(cityOf(tw({ principalSubdivisionCode: "TW-CYI" })).city_id, "chiayi-city");
  assert.equal(cityOf(tw({ principalSubdivisionCode: "TW-CYQ" })).city_id, "chiayi-county");
});

test("codes are trimmed and case-insensitive, and administrative codes count", () => {
  assert.equal(cityOf({ countryCode: " tw ", principalSubdivisionCode: " tw-tpe " }).city_id, "taipei");
  const response = tw(admin({ isoCode: "TW", name: "Taiwan" }, { isoCode: "TW-KHH", name: "Kaohsiung City" }));
  assert.equal(cityOf(response).city_id, "kaohsiung");
});

test("full English names are a fallback only when no county code exists", () => {
  assert.equal(cityOf(tw({ principalSubdivision: "Taipei City" })).city_id, "taipei");
  assert.equal(cityOf(tw({ principalSubdivision: "  tainan   CITY " })).city_id, "tainan");
  assert.equal(cityOf(tw({ principalSubdivisionCode: "", ...admin({ name: "Hualien County" }) })).city_id, "hualien");
});

test("full Chinese names are accepted, including 台 for 臺", () => {
  assert.equal(cityOf(tw({ principalSubdivision: "臺中市" })).city_id, "taichung");
  assert.equal(cityOf(tw(admin({ name: "台東縣" }))).city_id, "taitung");
});

test("ambiguous or partial names are rejected", () => {
  for (const name of ["Hsinchu", "Chiayi", "新竹", "嘉義", "Taipei"]) {
    assert.equal(reasonOf(tw({ principalSubdivision: name })), "unrecognized", name);
  }
});

test("an unknown county code is not rescued by a valid name", () => {
  assert.equal(reasonOf(tw({ principalSubdivisionCode: "TW-XYZ", principalSubdivision: "Taipei City" })), "unrecognized");
  assert.equal(reasonOf(tw(admin({ isoCode: "TW-ABC", name: "Taipei City" }))), "unrecognized");
});

test("codes or names pointing to different cities are a conflict", () => {
  assert.equal(reasonOf(tw({ principalSubdivisionCode: "TW-TPE", ...admin({ isoCode: "TW-NWT" }) })), "conflict");
  assert.equal(reasonOf(tw({ principalSubdivisionCode: "TW-TPE", principalSubdivision: "New Taipei City" })), "conflict");
  assert.equal(reasonOf(tw({ principalSubdivision: "Taipei City", ...admin({ name: "臺中市" }) })), "conflict");
});

test("town-level fields are never used to guess the county", () => {
  assert.equal(reasonOf(tw({ city: "Taipei City", locality: "Taipei City" })), "unrecognized");
});

test("a missing or foreign country is not guessed", () => {
  assert.equal(reasonOf({ principalSubdivisionCode: "TW-TPE" }), "missing-country");
  assert.equal(reasonOf({ countryCode: "  ", principalSubdivisionCode: "TW-TPE" }), "missing-country");
  assert.equal(reasonOf({ countryCode: "JP", principalSubdivisionCode: "JP-13" }), "outside-taiwan");
});

test("malformed responses and field types are rejected", () => {
  for (const response of [null, "TW", [], 42]) {
    assert.equal(reasonOf(response), "invalid-response");
  }
  assert.equal(reasonOf(tw({ localityInfo: { administrative: "TW-TPE" } })), "invalid-response");
  assert.equal(reasonOf(tw(admin("TW-TPE"))), "invalid-response");
  assert.equal(reasonOf(tw(admin({ isoCode: 42 }))), "invalid-response");
  assert.equal(reasonOf(tw({ principalSubdivisionCode: 42 })), "invalid-response");
  assert.equal(reasonOf(tw({ principalSubdivision: ["Taipei City"] })), "invalid-response");
});
