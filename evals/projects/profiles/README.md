# Profiles

Loads people's profiles from the members API for the dashboard. Several parts of the page can ask for the same person
at once, and the API is slow and rate-limited, so each profile should be fetched once.

`createLoader(fetchUser)` takes the function that calls the API and returns `load(id)`, which resolves the profile.
If the API fails, `load` rejects with its error; the next call for that person tries again.
