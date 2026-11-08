# Third-party services

Both services are called directly from the browser; the backend, its health check and CI
never call them. Neither needs an API key.

| Service | Use | Failure handling |
| --- | --- | --- |
| [DiceBear](https://www.dicebear.com/) HTTP API, [Personas](https://www.dicebear.com/styles/personas/) style | `https://api.dicebear.com/10.x/personas/svg?seed=<person id>`, so a person has the same avatar everywhere | Falls back once to `/avatar-fallback.svg`; if that also fails, the name is still shown |
| [BigDataCloud](https://www.bigdatacloud.com/) client-side reverse geocoding | After the user clicks 「使用我的城市」, the browser sends its current coordinates to `reverse-geocode-client` and maps the county code to one of the 22 cities | Denied permission, timeouts, provider errors, places outside Taiwan and ambiguous answers keep the current city and ask for a manual choice |

## City mapping and privacy

The county mapping lives in `frontend/src/geo/normalizeCity.js`. It trusts county codes
first, uses only exact full county names when no code is present, and never guesses from
town-level fields.

Coordinates are used for that one lookup only: they are not stored, logged or sent to the
SixDegrees backend. To keep the button quick, the browser may reuse a position it found in
the last 10 minutes (`maximumAge`), and the page preconnects to the lookup host.

Automated tests use mocked geolocation and HTTP responses; the real lookup is verified by
hand in a browser.

## Avatar licence

Avatars are "Personas" by Draftbit, provided through DiceBear and licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The site crops them to circles
and shows people who do not match the current filter in greyscale. The DiceBear public API
is for non-commercial use; a commercial product would need to self-host the avatars or
obtain them another way while keeping the Personas licence.
