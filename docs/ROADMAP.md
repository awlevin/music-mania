# Roadmap

## Catalog that grows as people play

Today the catalog is `data/catalog.json`, built offline by
`scripts/build-catalog.mjs` and read only through `lib/catalog/index.ts`
(`pickSongs`). Nothing else knows where songs come from, so the move below
touches that folder and nothing else.

The plan, to revisit once this first version has been played for a while:

1. **Move the catalog into a database.** Postgres fits best: songs are rows we
   filter by decade and genre, join to feedback, and edit one at a time. Neon
   has a free tier on the Vercel Marketplace. `catalog.json` stays as the seed.
   (Redis is already here and could hold it, but it is the wrong shape for
   "every 90s hip-hop song with fewer than two complaints".)
2. **Let games discover new songs.** Mix a few songs from outside the catalog
   into each game: iTunes charts, or more songs by artists already in it,
   resolved with the same original-album rules as the build script. Mark them
   as candidates.
3. **Players vote with their thumbs.** On the reveal of a candidate song the
   phone offers a thumbs down and a reason. This already exists for every song
   as "Something off with this song?" (`components/feedback/FeedbackSheet.tsx`),
   and a reported song is already benched until someone looks at it.
4. **No thumbs down means it is in.** A candidate that gets played without a
   complaint joins the catalog. A candidate that gets one does not, and the
   report goes to the feedback queue like any other.

## Smaller things

- Pick the 15 seconds ourselves instead of taking the first half of Apple's
  preview: find the loudest stretch offline and start the reveal there.
- Rename from the phone (the `rename` action exists; there is no button).
- A "local mode" with no Redis, for a venue with bad internet.
