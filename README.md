# Events
SlimIO - Events (Built-in Addon). Events is the heart of SlimIO, this addon handle all kinds of events (Alarms, Metrics, etc..).

## Getting Started
This package is available in the SlimIO Package Registry and can be easily installed with [SlimIO CLI](https://github.com/SlimIO/CLI).

```bash
$ slimio --add events
# or
$ slimio --add https://github.com/SlimIO/Events
```

> Note: this addon is automatically installed with the slimio init command.

## Events Kinds

| Type | Description |
| --- | --- |
| Alarm | N/A |
| Metrics | N/A |
| Error | An error that has occured somewhere in the product (they are useful for fire hunting) |
| Log | N/A |
| Entity (CI) | A SlimIO Entity is like a Configuration Item |
| MIC | MIC mean Metric Identity Card. It contain everything about a given metric (type, description etc..) |

## Dependencies

|Name|Refactoring|Security Risk|Usage|
|---|---|---|---|
|[@lukeed/uuid](https://github.com/lukeed/uuid#readme)|Minor|Low|A tiny (230B), fast, and cryptographically secure UUID (v4) generator|
|[@slimio/addon](https://github.com/SlimIO/Addon#readme)|Minor|Low|Addon default class|
|[@slimio/is](https://github.com/SlimIO/is#readme)|Minor|Low|Type checker|
|[@slimio/queue](https://github.com/SlimIO/Queue#readme)|Minor|Low|Queue system|
|[@slimio/sqlite-transaction](https://github.com/SlimIO/sqlite-transaction#readme)|Minor|High|Manage transaction for SQLite|
|[@slimio/utils](https://github.com/SlimIO/Utils#readme)|Minor|Low|Bunch of useful functions|
|[sqlite](https://github.com/kriasoft/node-sqlite#readme)|⚠️Major|High|A wrapper library written in Typescript with ZERO dependencies that adds ES6 promises and SQL-based migrations API to sqlite3 (docs).|
|[sqlite3](https://github.com/mapbox/node-sqlite3)|Minor|High|Sqlite3 Driver for Node.js|


## Licence
MIT
