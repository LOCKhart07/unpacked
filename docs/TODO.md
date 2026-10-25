# To do

Not in priority order, and none of it has to land at once. The full feature list compared with other tools is in [FEATURES.md](FEATURES.md).

## UI

- [ ] **Redesign the stats page.** It works but looks plain. Make it look good enough to share.
- [ ] **Range selector is confusing.** The Lifetime / Last 30 days / year chips at the top only change streaming and voice. Playtime is lifetime-only (the package has one total per game) and badges ignore the range. Either move the selector into the sections it affects, or clearly mark the sections that are lifetime-only.
- [ ] **Highlight the important numbers.** Bigger headline stats, comparisons people get at a glance ("that's 414 days in voice"), and a top-of-page summary.
- [ ] **Game images.** Show each game's icon next to its name. The detectable apps list already has icon hashes (`cdn.discordapp.com/app-icons/<id>/<icon>.png`). `img-src` in the CSP in `netlify.toml` needs `https://cdn.discordapp.com`.

## New stats

- [ ] **Messages:** counts, top DMs / channels / servers, messages over time, hour-of-day chart (P1 in FEATURES.md).
- [ ] **Word chart:** favourite words without stopwords.
- [ ] **Emoji use:** top emojis, including custom server emojis.
- [ ] **Everything else from the reference sites** (DDPE, Discord Package, Dumpus). See the checklist in [FEATURES.md](FEATURES.md): sessions / time on Discord, servers, payments, connections, event counts, demo mode, shareable image card, and so on.

## SEO

- [ ] **Google Search Console:** verify `unpacked.lockhart.in` (a DNS TXT record at Cloudflare) and submit `https://unpacked.lockhart.in/sitemap-index.xml`. Same for Bing Webmaster Tools.
- [ ] **Social preview image** (`og:image`) so links look good when shared.
- [ ] **More guide pages** people search for, e.g. how Discord's profile badges are counted, and what's in the data package.

## Loose ends

- [ ] **Make the repo public.** The footer links to the source and the landing page says "the code is open source", which isn't true while the repo is private.
- [ ] **Timezones:** daily and yearly totals use UTC. Use each event's `time_zone` and let people override it.
- [ ] **Accept an extracted folder,** not just the ZIP.
- [ ] **Turn off the Netlify toolbar** in the Netlify project settings. Its injected inline script shows up as a CSP error in the console.
