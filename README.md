# discord-data

Stats from your Discord data package: playtime per game, Go Live and watch time, voice, messages, and more. The site processes everything in your browser, so your package never leaves your machine.

**Status:** research and prototype. The site isn't built yet.

- [`docs/FEATURES.md`](docs/FEATURES.md): feature checklist compared with existing tools, package format notes, and edge cases from their issue trackers.
- [`scripts/stats.py`](scripts/stats.py): Python prototype of the playtime and streaming parsing (stdlib only).

## Trying the prototype

1. Request your data from Discord: User Settings → Data & Privacy → Request Data.
2. Extract `package.zip` into `data/package/`. The `data/` folder is gitignored.
3. Run:

```sh
python3 scripts/stats.py playtime            # hours per game
python3 scripts/stats.py streams             # Go Live / watching / camera time
python3 scripts/stats.py streams --since 2024-01-01
```

Game names are looked up from Discord's public application endpoints and cached in `data/cache/`.

## License

[GPL-3.0](LICENSE)
