import { test } from "node:test";
import assert from "node:assert/strict";
import { avatarUrl } from "../src/people.js";

const FEMALE_HAIR = ["long", "bobCut", "bobBangs", "pigtails", "curlyBun", "straightBun", "extraLong"];
const MALE_HAIR = ["shortCombover", "curlyHighTop", "buzzcut", "fade", "shortComboverChops"];
const paramsOf = (url) => new URL(url).searchParams;

test("avatar URLs use the Personas 10.x endpoint seeded by person ID", () => {
  const url = new URL(avatarUrl("u01", "male"));
  assert.equal(`${url.origin}${url.pathname}`, "https://api.dicebear.com/10.x/personas/svg");
  assert.equal(url.searchParams.get("seed"), "u01");
});

test("the same person always gets the same avatar", () => {
  assert.equal(avatarUrl("u04", "female"), avatarUrl("u04", "female"));
});

test("hairstyles follow gender, one value per request, and women have no facial hair", () => {
  for (let i = 0; i < 12; i += 1) {
    const id = `u${String(i).padStart(2, "0")}`;
    const female = paramsOf(avatarUrl(id, "female"));
    assert.ok(FEMALE_HAIR.includes(female.get("hairVariant")), `${id} female hair ${female.get("hairVariant")}`);
    assert.equal(female.get("facialHairProbability"), "0");

    const male = paramsOf(avatarUrl(id, "male"));
    assert.ok(MALE_HAIR.includes(male.get("hairVariant")), `${id} male hair ${male.get("hairVariant")}`);
    assert.equal(male.get("facialHairProbability"), null);
  }
});

test("an unknown gender falls back to the plain seeded avatar", () => {
  assert.deepEqual([...paramsOf(avatarUrl("u01", undefined)).keys()], ["seed"]);
});
