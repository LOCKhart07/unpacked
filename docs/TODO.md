# To do

Not in priority order, and none of it has to land at once. The full feature list compared with other tools is in [FEATURES.md](FEATURES.md).

## UI

- [ ] **Redesign the stats page.** It works but looks plain. Make it look good enough to share.
- [x] **Split the stats page into tabs:** Overview · Games · Streaming · Voice · Badges, Messages, with the tab in the URL (`#voice`).
- [x] **Range selector is confusing.** The range chips now only show on tabs with dated data (Streaming, Voice, Messages); the others say "Lifetime totals". The range carries over between those tabs.
- [ ] **Highlight the important numbers.** Bigger headline stats, comparisons people get at a glance ("that's 414 days in voice"), and a top-of-page summary.
- [x] **Game images on Overview** (most played and most streamed game), from `icon_hash` in Discord's detectable list via `cdn.discordapp.com/app-icons/<id>/<hash>.png`; the CSP allows that host.
- [ ] **Game images everywhere else:** the Games table and the streamed-games list.

## New stats

- [x] **Messages:** counts, top DMs / channels / servers, messages over time, hour-of-day and day-of-week charts.
- [x] **Word chart:** favourite words, leaving out stopwords, links, code and bot commands.
- [x] **Emoji use:** top emojis, including custom server emojis.
- [ ] **Stopwords for other languages.** Only English filler words are left out, so Hinglish chat gives "nai", "hai", "kai" as top words. Add lists for common languages (Hinglish, Spanish, French, German, Portuguese...).
- [ ] **Show custom emoji images** (`cdn.discordapp.com/emojis/<id>`); the id is in the message text. The CSP already allows `cdn.discordapp.com`.
- [ ] **Everything else from the reference sites** (DDPE, Discord Package, Dumpus). See the checklist in [FEATURES.md](FEATURES.md): sessions / time on Discord, servers, payments, connections, event counts, demo mode, shareable image card, and so on.

## SEO

- [ ] **Google Search Console:** verify `unpacked.lockhart.in` (a DNS TXT record at Cloudflare) and submit `https://unpacked.lockhart.in/sitemap-index.xml`. Same for Bing Webmaster Tools.
- [ ] **Social preview image** (`og:image`) so links look good when shared.
- [ ] **More guide pages** people search for, e.g. how Discord's profile badges are counted, and what's in the data package.

## Loose ends

- [ ] **Make the repo public.** The footer links to the source and the landing page says "the code is open source", which isn't true while the repo is private.
- [ ] **Timezones:** streaming and voice daily / yearly totals use UTC; the message hour and weekday charts use the viewer's browser timezone. Use each event's `time_zone` and let people override it.
- [ ] **Accept an extracted folder,** not just the ZIP.
- [ ] **Turn off the Netlify toolbar** in the Netlify project settings. Its injected inline script shows up as a CSP error in the console.
