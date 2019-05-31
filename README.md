# Events
SlimIO - Events (Built-in Addon). Events is the heart of SlimIO, this addon handle all kinds of events (Alarms, Metrics, etc..).

## Getting Started
This package is available in the SlimIO Package Registry and can be easily installed with [SlimIO CLI](https://github.com/SlimIO/CLI).

```bash
$ slimio --add events
# or
$ slimio --add https://github.com/SlimIO/Events
```

> Note: this addon is automatically installed with the slimio -i command.

## Dependencies

|Name|Refactoring|Security Risk|Usage|
|---|---|---|---|
|[@slimio/addon](https://github.com/SlimIO/Addon#readme)|Minor|Low|Addon default class|
|[@slimio/is](https://github.com/SlimIO/is#readme)|Minor|Low|Type checker|
|[@slimio/queue](https://github.com/SlimIO/Queue#readme)|Minor|Low|Queue system|
|[@slimio/sqlite-transaction](https://github.com/SlimIO/sqlite-transaction#readme)|Minor|High|Manage transaction for SQLite|
|[@slimio/timer](https://github.com/SlimIO/Timer#readme)|Minor|Low|Driftless interval|
|[@slimio/utils](https://github.com/SlimIO/Utils#readme)|Minor|Low|Bunch of useful functions|
|[hyperid](https://github.com/mcollina/hyperid#readme)|Minor|Medium|Unique ID generator|
|[sqlite](https://github.com/kriasoft/node-sqlite#readme)|⚠️Major|High|SQLite DB|

## Licence
MIT
