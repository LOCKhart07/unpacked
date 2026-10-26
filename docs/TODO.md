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
- [x] **Show custom emoji images** (`cdn.discordapp.com/emojis/<id>.webp`, lazy and 64 px); a deleted emoji falls back to its `:name:`.
- [ ] **Playtime by year.** `application_closed` events date each game session (`activity_duration_s`, from 2019 on), so the Games tab could get a playtime-over-time chart and the range chips. Label it as its own partial source: it sums to about 2,800 h against 3,473 h in `user_activity_application_statistics`, and it misses games Discord didn't detect (no VALORANT before 2023).
- [ ] **Ad profile** from `Ads/traits.json`: age group, region, games targeted on (last 30 / 90 / 365 / 730 days, IDs to name via the app list), game themes, music and mobile genres, named custom audiences (`mobile_install_*`), quests joined, ad ID state. Explain each field in plain words, and leave out bare audience IDs and the unnamed `genre_ids`. Probably on the Account tab.
- [ ] **Servers you read but don't talk in.** `channel_opened` (51k events with `channel_id`) against messages sent: most opened channels and a lurker ratio per server.
- [ ] **Avatar history** from `Account/recent_avatars/` (6 images), as a small gallery.
- [ ] **Everything else from the reference sites** (DDPE, Discord Package, Dumpus). See the checklist in [FEATURES.md](FEATURES.md) for what's left. (Done: Account tab; Activity tab with time on Discord and event counts.)

## SEO

- [ ] **Google Search Console:** verify `unpacked.lockhart.in` (a DNS TXT record at Cloudflare) and submit `https://unpacked.lockhart.in/sitemap-index.xml`. Same for Bing Webmaster Tools.
- [x] **Social preview image** (`og:image`) so links look good when shared.
- [ ] **More guide pages** people search for, e.g. how Discord's profile badges are counted, and what's in the data package.

## Loose ends

- [x] **Make the repo public.** Public since 2026-10-26, with the live site link, screenshots from a made-up demo package, and issue forms for feedback.
- [x] **Timezones:** streaming and voice daily / yearly totals use UTC; the message hour and weekday charts use the viewer's browser timezone. Use each event's `time_zone` and let people override it.
- [ ] **Accept an extracted folder,** not just the ZIP.
- [ ] **Turn off the Netlify toolbar** in the Netlify project settings. Its injected inline script shows up as a CSP error in the console.
