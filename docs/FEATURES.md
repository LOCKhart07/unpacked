# Feature checklist and package format notes

Research for the site, gathered on 2026-10-25 from the three existing tools and a real package exported in Oct 2026.

| Tool | Code | Licence | How it processes data |
|---|---|---|---|
| [DDPE](https://ddpe.androz2091.fr) | [Androz2091/discord-data-package-explorer](https://github.com/Androz2091/discord-data-package-explorer) | GPL-3.0 | In the browser (Svelte) |
| [Discord Package](https://discordpackage.com) | [peterhanania/discord-package](https://github.com/peterhanania/discord-package) | GPL-3.0 | In the browser (Next.js) |
| [Dumpus](https://dumpus.app) | [dumpus-app/dumpus-app](https://github.com/dumpus-app/dumpus-app) (app) · [dumpus-api](https://github.com/dumpus-app/dumpus-api) (server, **no licence**) | GPL-3.0 / none | On a server: you paste the package download link, the server fetches and processes it, and stores it encrypted with your key. Mainly a mobile app. |

We're writing our own parser. GPL-3.0 code is fine to learn from or copy, as long as we keep their copyright notices. **Don't copy anything from dumpus-api**, since it has no licence.

## Positioning

- **Everything runs in the browser.** The zip never leaves the user's tab. That's the main difference from Dumpus, which processes packages on a server.
- **Desktop first.** Activity tracking is mostly a PC thing, so mobile layout isn't a goal for now.
- **Modern UI.** The main complaint about the existing tools is that they look dated.
- **New stats nobody shows:** playtime, stream/watch/camera time, voice talk time, and lifetime totals vs Discord's profile badges.

## Feature checklist

Legend: ✅ the tool has it · 💡 requested in that tool's issues · blank = missing.
Priority: **P0** = what makes us different, **P1** = needed to match the existing tools, **P2** = nice to have.

### Gaming and streaming (new)

| Feature | DDPE | DP | Dumpus | Source | Pri |
|---|---|---|---|---|---|
| Total playtime + hours per game | | | | `user.json` → `user_activity_application_statistics[].total_duration` (seconds) | P0 |
| Last played per game, first played (only filled for games first played since about Apr 2024) | | | | same, `last_played_at` / `first_played_at` | P0 |
| Go Live time, session count, longest stream, most viewers | | | | `video_stream_ended`, `context=stream`, `participant_type=streamer` | P0 |
| Top streamed games / screen share | | | | `video_stream_ended.share_application_name` (empty = screen or window share) | P0 |
| Time watching others' streams | | | | `video_stream_ended`, `participant_type=receiver` | P0 |
| Camera on / watching others' cameras | | | | `video_stream_ended`, `context=default`, `sender` / `receiver` | P1 |
| Lifetime totals vs Game Time / Streaming badge tiers | | | | the above + `user_profile_metadata.owned_badges` (see [Badges](#badges)) | P0 |
| Playtime and streaming by year | | | | streams: event timestamps. Playtime: **not possible**, the package only has lifetime totals per game | P0 |

### Voice and sessions

| Feature | DDPE | DP | Dumpus | Source | Pri |
|---|---|---|---|---|---|
| Total time in voice channels | | | ✅ | `voice_disconnect.duration` (skip `context=stream`) / `leave_voice_channel.duration`, both ms (see [Voice](#voice)) | P1 |
| Voice time per server / channel, longest call | | 💡 #145 | ✅ | same + `guild_id`, `channel_id`; names from `Servers/index.json` and `Messages/index.json` | P1 |
| Time spent talking vs listening | | | | `voice_disconnect.duration_speaking` / `duration_listening` (seconds, or `*_ms`) | P0 |
| Call stats per person (DM calls) | | | 💡 #359 | `start_call` / `join_call` + DM `channel_id` → `Messages/c<id>/channel.json` recipients | P2 |
| Time on Discord (sessions) | | | ✅ | `session_start` / `session_end`, paired on `session` (no duration field) | P1 |
| App opens, average per day | ✅ | ✅ | ✅ | `app_opened` | P1 |
| Voice channel joins, calls joined | ✅ | ✅ | ✅ | `join_voice_channel`, `join_call` | P1 |

### Messages

| Feature | DDPE | DP | Dumpus | Source | Pri |
|---|---|---|---|---|---|
| Message count, character count, average per day | ✅ | ✅ | ✅ | `Messages/c<id>/messages.json` (`ID`, `Timestamp`, `Contents`, `Attachments`) | P1 |
| Top DMs (users) | ✅ | ✅ | ✅ | `channel.json` (`type`, `recipients`) + user lookup | P1 |
| Top channels / top servers | ✅ | ✅ | ✅ | `Messages/index.json` (id → "channel, server") | P1 |
| Top group DMs | 💡 #72 | ✅ | | `channel.json.type` | P1 |
| More than the top 10 / sorting | 💡 #50 | 💡 #38 | ✅ ("load more") | — | P1 |
| Hour-of-day activity ("Discord hours") | ✅ | ✅ | ✅ | message timestamps (see [Timezones](#gotchas-from-their-issue-trackers)) | P1 |
| Messages per year / over time | | ✅ | ✅ | message timestamps | P1 |
| Time-range filter (4 weeks / 6 months / year / lifetime) | 💡 #62 | | ✅ | everything with a timestamp | P1 |
| Favourite words (without stopwords) | ✅ | ✅ | | `Contents` | P1 |
| Top emojis, custom emojis, links, Discord invite links | | ✅ | | `Contents` | P2 |
| Mention count, attachment count | | ✅ | | `Contents`, `Attachments` | P2 |
| Swear words ("cursed") | | ✅ | | `Contents` | P2 |
| Oldest messages | | ✅ | | `Timestamp` | P2 |
| Per-channel detail page (graph, counts) | | | ✅ | — | P2 |
| Sentiment score | | | ✅ | `Contents` (needs a small in-browser model) | P2 |
| Messages per user / "days known" | 💡 #66 | | | first/last message per DM | P2 |

### Account, servers, money

| Feature | DDPE | DP | Dumpus | Source | Pri |
|---|---|---|---|---|---|
| Profile card (name, avatar, id, Nitro until) | ✅ | ✅ | ✅ | `Account/user.json`, `avatar.png` (no API call needed) | P1 |
| Profile badges / account flags | | ✅ | | `user.json.flags` (a **list of names** in new packages, see DP #149) | P1 |
| Connections (Steam, Spotify, …) | | ✅ | | `user.json.connections` | P1 |
| Server count, list | ✅ | ✅ | ✅ | `Servers/index.json`, `Servers/<id>/guild.json` | P1 |
| Servers joined / left over time | | | ✅ | `guild_joined`, `leave_guild` events | P2 |
| Bots added, most-used bots | | ✅ | ✅ | `Account/applications/`, `slash_command_used` | P2 |
| Total spent, transaction list, gifted Nitro | ✅ | ✅ | ✅ | `Account/user_data_exports/discord_billing/payments.json` (new) or `user.json.payments` (old) | P1 |
| Recent emojis, appearance settings | | ✅ | | `user.json.settings` | P2 |
| Predicted age / gender | 💡 #79 | 💡 #146 | | `user.json.predicted_age`, `predicted_gender` | P2 |
| Count of each tracked event (reactions, edits, slash commands, notifications, crashes, …) | ✅ (8) | ✅ (many) | ✅ | event types in `Activity/*` | P1 |

### Site features

| Feature | DDPE | DP | Dumpus | Pri |
|---|---|---|---|---|
| Demo mode with fake data | ✅ | ✅ | ✅ | P1 |
| Shareable image card, using the selected time range (Dumpus #235) | | 💡 #37 | ✅ | P0 |
| Hide or show individual stats before sharing | | ✅ | | P1 |
| Export your stats as a file | | ✅ | | P2 |
| Progress bar with time estimate, cancel button | ✅ | ✅ | ✅ | P1 |
| Error messages that say which section is missing | ✅ | | ✅ | P1 |
| Banner when stats are partial (tracking turned off, partial package) | | | ✅ #197 #232 | P1 |
| Pick a timezone for the hour charts | 💡 #69 | 💡 #169 | 💡 #337 | P1 |

## Package format notes

From a package exported Oct 2026:

```
Account/            user.json, avatar.png, recent_avatars/, applications/<id>/,
                    user_data_exports/discord_{billing,promotions,store,virtual_currency,harvests}/*.json
Activities/         Activities_1/{poker,users}/, Activities_2/  (Embedded Activities data, small)
Activity/           modeling/, reporting/, tns/  → events-YYYY-00000-of-00001.json  (newline-delimited JSON)
Ads/
Messages/           index.json, c<channel_id>/{channel.json, messages.json}
Servers/            index.json, <guild_id>/{guild.json, audit-log.json}
Support_Tickets/
```

- **Activity files are huge.** In this package they were 1.2 GB + 1.1 GB + 340 MB unzipped (from a 334 MB zip). Read them line by line inside a Web Worker, check each line with a cheap substring match before calling `JSON.parse`, and never load a whole file into memory. Both browser-based tools have issues about crashes and freezes on big packages (DP #12, #18, #176; DDPE #45).
- **The three activity folders overlap.** `modeling/` and `reporting/` contain almost the same events, and `tns/` is a smaller subset. **Deduplicate by `event_id`** or every count is doubled or tripled. Some event types only appear in some folders (e.g. `session_end` isn't in `modeling/`), so read all three.
- **Older packages used `activity/analytics/events-*.json`.** New packages don't have an `analytics/` folder. DDPE and DP both look only for `analytics/`, which is why DP #166 reports statistics no longer working.
- **Game names aren't in the package**, only application ids. To resolve them:
  1. `GET https://discord.com/api/v9/applications/detectable` (about 13 MB, CORS `*`; cache it, or ship a trimmed id→name snapshot)
  2. `user.json.library_applications[].application.name`
  3. `GET https://discord.com/api/v9/applications/<id>/rpc` (allows cross-origin requests) for old ids missing from step 1. These turned out to be big ones: Minecraft, GTA V and CS:GO all had legacy ids.
  4. Otherwise show "Unknown app (id)".
- **One game can have several app ids** (old and new ids, Legacy/Enhanced editions). Merge by normalised name, ignoring ™/®, colons and "Game of the Year Edition".
- **Playtime only has lifetime totals per game.** There's no per-day breakdown, so playtime can't be split by year or time range. Streams, voice and messages can.
- **Durations:** `total_duration` and `video_stream_ended.duration` are in seconds. Voice durations are mixed; see [Voice](#voice).
- **Payments moved.** New packages have `user_data_exports/discord_billing/payments.json` shaped as `{section, generated_at, record_count, metadata, records}`, and `user.json.payments` may be missing. That missing field crashed DDPE (#148). Only count successful payments, not failed or refunded ones (Dumpus #261), and handle regional currencies (DDPE #56, DP #34) and gifts bought through Apple (DP #13).
- **Messages:** fields are capitalised (`ID`, `Timestamp`, `Contents`, `Attachments`). Old packages used `messages.csv`, and older ones had no `c` prefix on channel folders. Message types changed format too (DP #163).

## Gotchas from their issue trackers

- **Folder names are translated** into the language of the account that requested the package. DDPE's auto-reports include `Compte/ Activité/ Serveurs/` (French), `Conta/ Atividade/ Servidores/` (Portuguese), `Aktivität/ Nachrichten/` (German), `Tili/ Toiminta/ Viestit/` (Finnish), `Cuenta/ Mensajes/` (Spanish) and `帳號/ 訊息/ 伺服器/` (Chinese). Old packages are lowercase (`account/`). **Find files by name and content, not by folder** (e.g. the `user.json` that contains `user_activity_application_statistics`; files matching `events-*.json`; folders holding `messages.json` + `channel.json`). See DP #167, #181.
- **There can be several `user.json` files.** `Activities/Activities_1/users/user.json` is a tiny unrelated one. Pick by content.
- **Partial packages are common.** Users can now request individual sections (DP #149), and many uploads have only `Messages/`, only `Servers/` or only `Activity/`. Of DDPE's 150+ auto-reported errors, most were generic "something went wrong". Show whatever stats are available, and say exactly which section is missing and which stats it would unlock (DDPE #87, Dumpus #197).
- **People upload the wrong thing:** a re-zipped folder, a subfolder, or a nested `package/` folder. Handle any root prefix.
- **Timezones:** all three tools get the hour-of-day chart wrong for someone who travels or whose browser timezone differs (DDPE #69, DP #169, Dumpus #337). Events have a `time_zone` field (e.g. `America/Toronto`); use it per event and offer a manual override.
- **Users:** looking up usernames and avatars through Discord's API breaks often (DDPE #40, #41, #243). Use the names already in the package (`Messages/index.json`, `channel.json.recipients`) first, and treat API lookups as optional extras. Keep deleted users in the lists (DDPE #61).
- **Account flags format changed** from a bitfield to a list of names, which crashed DP's BigInt parsing (DP #149).
- **Stats are missing while tracking is turned off.** When "use data to improve Discord" is disabled, the event data has gaps (Dumpus #312, #232). Detect the gaps and show a banner.
- **Server count:** count `Servers/index.json` entries, don't infer it from messages (Dumpus #342).
- **Earliest date:** start time ranges from the earliest real data, not a hard-coded date (Dumpus #184, #185).

## Voice

Checked against the Oct 2026 package:

- **`voice_disconnect` fires once per RTC connection, and Go Live opens its own** (`context=stream`, next to the voice one with `context=default`). Skip `context=stream` or voice time counts streams twice. Old events (2018–20) have no `context`.
- **Units:** `duration` is **milliseconds** in both `voice_disconnect` and `leave_voice_channel`. `duration_connected`, `duration_speaking`, `duration_listening` and `duration_participation` are **whole seconds**. Newer events (2023+) also have exact `*_ms` versions; prefer those.
- **Speaking and listening overlap.** Speaking is your mic sending audio, listening is receiving others'; `participation` is about their union. Measure them against `duration_connected`, not `duration`: in 2021–22 some long sessions have `duration_connected` far below `duration` (1,665 h vs 2,951 h in 2022), and the speaking/listening numbers follow `duration_connected`.
- **Both sources have gaps.** `voice_disconnect` barely exists before 2020; `leave_voice_channel` goes back to 2017 but has no `duration` on many events from Sep 2020 to Mar 2021. Elsewhere they agree within a few percent. Take the larger of the two per month.
- `channel_type`: 2 = server voice, 1 = DM call, 3 = group DM call, 13 = stage. A connection can last days if the client stays in a channel (longest here: 84 h).
- Voice channel names are only in `Messages/index.json` if you've sent a message in the channel's text chat. Otherwise show the server name.

## Badges

Discord's profile badges (2026) show much lower numbers than the lifetime totals from the package. **The package has the badges you own** in `user.json` → `user_profile_metadata.owned_badges`: `badge.type` (19 = Streaming, 20 = Game Time, 21 = Game Variety) and `tier_base.tier_obtained_at` per tier. Tiers below the one you had when badges launched (2026-07-29) all share that back-filled timestamp. Tiers seen so far:

- **Game Time:** Casual 1 h, Recreational 5, Dedicated 20, Committed 75, Serious 150, Devoted 300, Seasoned 500, Ironclad 1,000, plus higher tiers that aren't shown yet.
- **Streaming:** Newcomer 1 h, Fledgling 5, Breakout 20, Standout 75, Trendsetter 150, Headliner 300, Star 500, Sensation 1,000, plus higher tiers that aren't shown yet.
- **Game Variety** ("detectable PC games played with Discord open"): Sampler 2 games, Dabbler 5, Enthusiast 10, Ranger 15, then Explorer, Adventurer, Voyager (thresholds hidden in the app; Voyager is ≤ 58), next tier at 60.

On one test package:

**All three badges fit counting from about 23 Oct – 1 Nov 2024.** `stats.py badges` uses 2024-11-01.

- **Game Variety:** the app said Voyager, 58 games played. Games whose `first_played_at` is on or after a date between 2024-10-23 and 2025-02-22, merged by name, are exactly 58 (148 lifetime).
- **Streaming:** Headliner (300 h+, not yet Star at 500). Go Live time fits only when counted from a start month between Nov 2023 and Nov 2024. From 2024-11-01: 320 h by the 2026-07-29 back-fill, 407 h now (2,922 h lifetime).
- **Game time:** Seasoned (500 h+, reached 2026-08-18, not yet Ironclad at 1,000). Games first played since 2024-11-01 have 409 h, all of it inside the window; older games played since then add an unknown share (the package has only lifetime totals per game), so the badge's 500–1,000 h fits. An earlier guess of 2024-04-28 gave 1,077 h from new games alone, which ruled that date out.
- So the site can show "your badges count from about Nov 2024" and estimate Game Variety exactly, Streaming exactly, and Game Time as a lower bound.

Present this as "your badge counts from about 2024; here's everything", not as Discord being wrong.

## Prototype

`scripts/stats.py` (stdlib only) has the playtime, streaming, voice and badge logic:

```
python3 scripts/stats.py playtime [data/package] [--csv out.csv]
python3 scripts/stats.py streams  [data/package] [--since 2024-01-01]
python3 scripts/stats.py voice    [data/package] [--since 2024-01-01]
python3 scripts/stats.py badges   [data/package]
```
