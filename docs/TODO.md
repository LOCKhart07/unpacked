# To do

Not in priority order, and none of it has to land at once. The full feature list compared with other tools is in [FEATURES.md](FEATURES.md).

## UI

- [x] **Redesign the stats page.** Headline numbers per tab, charts with an axis, hover values and the peak marked, over-time charts for Streaming and Voice, badge progress bars, and tabs that stay pinned while scrolling.
- [x] **Split the stats page into tabs:** Overview · Games · Streaming · Voice · Badges, Messages, with the tab in the URL (`#voice`).
- [x] **Range selector is confusing.** The range chips now only show on tabs with dated data (Streaming, Voice, Messages); the others say "Lifetime totals". The range carries over between those tabs.
- [x] **Highlight the important numbers.** Bigger headline stats, comparisons people get at a glance ("that's 414 days in voice"), and a Highlights card on the Overview.
- [x] **Game images on Overview** (most played and most streamed game), from `icon_hash` in Discord's detectable list via `cdn.discordapp.com/app-icons/<id>/<hash>.png`; the CSP allows that host.
- [x] **Game images in the Games table and the streamed-games list.** Streamed games are matched by name, including Discord's aliases for renamed apps.

## New stats

- [x] **Messages:** counts, top DMs / channels / servers, messages over time, hour-of-day and day-of-week charts.
- [x] **Word chart:** favourite words, leaving out stopwords, links, code and bot commands.
- [x] **Emoji use:** top emojis, including custom server emojis.
- [ ] **Stopwords for other languages.** Only English filler words are left out, so Hinglish chat gives "nai", "hai", "kai" as top words. Add lists for common languages (Hinglish, Spanish, French, German, Portuguese...).
- [ ] **Show custom emoji images** (`cdn.discordapp.com/emojis/<id>`); the id is in the message text. The CSP already allows `cdn.discordapp.com`.
- [ ] **Everything else from the reference sites** (DDPE, Discord Package, Dumpus). See the checklist in [FEATURES.md](FEATURES.md): sessions / time on Discord, servers, payments, connections, event counts, and so on.

## SEO

- [ ] **Google Search Console:** verify `unpacked.lockhart.in` (a DNS TXT record at Cloudflare) and submit `https://unpacked.lockhart.in/sitemap-index.xml`. Same for Bing Webmaster Tools.
- [x] **Social preview image** (`og:image`) so links look good when shared.
- [ ] **More guide pages** people search for, e.g. how Discord's profile badges are counted, and what's in the data package.

## Loose ends

- [x] **Make the repo public.** Public since 2026-10-26, with the live site link, screenshots from a made-up demo package, and issue forms for feedback.
- [ ] **Timezones:** streaming and voice daily / yearly totals use UTC; the message hour and weekday charts use the viewer's browser timezone. Use each event's `time_zone` and let people override it.
- [ ] **Accept an extracted folder,** not just the ZIP.
- [ ] **Turn off the Netlify toolbar** in the Netlify project settings. Its injected inline script shows up as a CSP error in the console.
