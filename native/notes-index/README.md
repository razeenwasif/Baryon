# Indexer-derived native note search

`QAItem.swift` and `HybridSearchEngine.swift` are adapted from the user's local
`~/Github/Indexer` (commit `8befa90`). The original repository is unchanged.
Fairy uses its NaturalLanguage sentence embeddings and Accelerate vector scoring
in a headless, local NDJSON worker (`../NotesSearch.swift`). UI, microphone capture,
AppleScript imports, interview boosts and built-in fallback stories are omitted.
Explicit item loading replaces singleton/asynchronous initialization. Fairy owns
approved-folder access, line-based Markdown chunking, freshness checks, BM25
fallback and source links in `desktop/notes.mjs`.

Vector cache values are keyed by content/revision-derived IDs, contain no note
text, and are bounded to 64 MiB when loading. Cache lives only in app user data;
no notes or embeddings are packaged in Baryon.app. Cold vectors build once at lower
process priority; BM25 stays available in memory during the build. Sleep/lock or
power policy level >=2 kills the helper and clears the live index. A 1.5-second
change debounce replaces polling; selected sources are revalidated per lookup.
