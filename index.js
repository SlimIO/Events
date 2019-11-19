// Require Node.js Dependencies
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { performance } from "perf_hooks";
import os, { cpus } from "os";
import { promises as fs } from "fs";
const { readFile, mkdir } = fs;

// Require Third-Party Dependencies
import sqlite from "sqlite";
import uuid from "uuid";
import Addon from "@slimio/addon";
import is from "@slimio/is";
import Queue from "@slimio/queue";
import Utils from "@slimio/utils";
import TransactManager from "@slimio/sqlite-transaction";
const { assertEntity, assertMIC, assertAlarm, assertCorrelateID, taggedString } = Utils;

// Require Internal Dependencies
import { toUnixEpoch } from "./src/utils.js";
import SharedDB from "./src/sharedDb.js";

// Node.js CONSTANTS
const __dirname = dirname(fileURLToPath(import.meta.url));

// CONSTANTS
const DB_DIR = join(__dirname, "db");
const METRICS_DIR = join(DB_DIR, "metrics");
const POPULATE_INTERVAL_MS = 5000;
const SANITY_INTERVAL_MS = 60000;
const ENTITY_IDENTIFIER = new Set(["name", "id", "parent"]);
const { Insert, Update, Delete } = TransactManager.Actions;
const createMetricDB = taggedString`CREATE TABLE IF NOT EXISTS "${"name"}"
("value" INTEGER NOT NULL, "harvestedAt" DATE NOT NULL, "level" TINYINT DEFAULT 0 NOT NULL);`;

// GLOBALS
let db = null;
const openShareDB = new SharedDB();

/**
 * @type {TransactManager}
 */
let transact = null;

// QUEUES & MAPS
const Q_METRICS = new Queue();

/** @type {Map<string, number>} */
const AVAILABLE_TYPES = new Map([
    ["Addon", 1],
    ["Alarm", 2],
    ["Metric", 3]
]);

/** @type {Map<string, Set<string>>} */
const SUBSCRIBERS = new Map();

// Create EVENTS Addon!
const Events = new Addon("events");

/**
 * @function dbShouldBeOpen
 * @description The database should be open
 * @returns {void}
 */
function dbShouldBeOpen() {
    if (db === null) {
        throw new Error("Events database not open!");
    }
}

/**
 * @async
 * @function getSubscriber
 * @param {string} source source
 * @param {string} target target
 * @param {string} [kind="stats"] kind
 * @returns {Promise<string>}
 */
async function getSubscriber(source, target, kind = "stats") {
    const subscriber = await db.get(
        "SELECT last FROM subscribers WHERE source=? AND target=? AND kind=?", source, target, kind);
    if (typeof subscriber !== "undefined") {
        return toUnixEpoch(new Date(subscriber.last).getTime());
    }
    await db.run("INSERT INTO subscribers (source, target, kind) VALUES (?, ?, ?)", source, target, kind);

    return toUnixEpoch(new Date().getTime());
}

/**
 * @async
 * @function declareEntityDescriptor
 * @description Declare one descriptor for a given entity!
 * @param {!Addon.CallbackHeader} header Callback Header
 * @param {!number} entityId entityId
 * @param {!Array} KeyValue descriptor key
 * @returns {Promise<void>}
 */
async function declareEntityDescriptor(header, entityId, [key, value]) {
    dbShouldBeOpen();
    const row = await db.get(
        "SELECT value FROM entity_descriptor WHERE entity_id=? AND key=?", entityId, key);

    if (typeof row === "undefined") {
        transact.open(Insert, "descriptor", [entityId, key, value]);
    }
    else if (value !== row.value) {
        transact.open(Update, "descriptor", [row.value, entityId, key]);
    }
}

/**
 * @async
 * @function getDescriptors
 * @description Get one or all descriptors of a given entity
 * @param {!Addon.CallbackHeader} header Callback Header
 * @param {!number} entityId entityId
 * @param {string} [key] descriptor key
 * @returns {Promise<void>}
 */
async function getDescriptors(header, entityId, key) {
    dbShouldBeOpen();
    if (typeof entityId !== "number") {
        throw new TypeError("entityId should be typeof number");
    }

    // If key is a string, then only return one descriptor
    if (typeof key === "string") {
        return await db.get(
            "SELECT * FROM entity_descriptor WHERE entity_id=? AND key=?", entityId, key);
    }

    return await db.all("SELECT * FROM entity_descriptor WHERE entity_id=?", entityId);
}

/**
 * @async
 * @function declareEntity
 * @description Declare a new entity
 * @param {!Addon.CallbackHeader} header Callback Header
 * @param {*} entity entity
 * @returns {Promise<number>}
 */
async function declareEntity(header, entity) {
    dbShouldBeOpen();
    assertEntity(entity);
    const { name, parent = 1, description = null, descriptors = {} } = entity;

    /** @type {{id: number, description: string}} */
    let row;
    if (parent === null) {
        row = await db.get("SELECT id, description FROM entity WHERE name=? AND parent IS NULL", name);
    }
    else {
        row = await db.get("SELECT id, description FROM entity WHERE name=? AND parent=?", name, parent);
    }

    if (typeof row !== "undefined") {
        if (description !== row.description) {
            transact.open(Update, "entity", [description, row.id]);
        }

        setImmediate(() => {
            for (const [key, value] of Object.entries(descriptors)) {
                declareEntityDescriptor(void 0, row.id, [key, value]);
            }
        });

        return row.id;
    }

    // Else, create a new row for the entity!
    const { lastID } = await db.run(
        "INSERT INTO entity (uuid, name, parent, description) VALUES(?, ?, ?, ?)",
        uuid.v4(), name, parent, description
    );
    if (typeof lastID !== "number") {
        throw new Error("Failed to insert new entity!");
    }

    setImmediate(() => {
        for (const [key, value] of Object.entries(descriptors)) {
            declareEntityDescriptor(void 0, lastID, [key, value]);
        }
    });

    return lastID;
}

/**
 * @async
 * @function searchEntities
 * @description Search one or many entities by matching search options
 * @param {!Addon.CallbackHeader} header Callback Header
 * @param {object} searchOptions search Options
 * @returns {Promise<number>}
 */
async function searchEntities(header, searchOptions = Object.create(null)) {
    dbShouldBeOpen();
    if (!is.plainObject(searchOptions)) {
        throw new TypeError("searchOptions should be a plainObject!");
    }

    const { name = null, pattern = null, patternIdentifier, fields = "*", createdAt = Date.now() } = searchOptions;
    if (typeof fields !== "string") {
        throw new TypeError("fields must be a string");
    }

    if (name !== null) {
        return await db.get("SELECT * FROM entity WHERE name=?", name);
    }

    const rawResult = await db.all(`SELECT ${fields} FROM entity WHERE createdAt > ?`, createdAt);
    if (typeof pattern === "string") {
        const regex = new RegExp(pattern, "g");
        const identifier = ENTITY_IDENTIFIER.has(patternIdentifier) ? patternIdentifier : "name";

        return rawResult.filter((row) => regex.test(String(row[identifier])));
    }

    return rawResult;
}

/**
 * @async
 * @function getEntityByID
 * @description Get a given entity by his ID.
 * @param {!Addon.CallbackHeader} header Callback Header
 * @param {!number} entityId entity id
 * @returns {Promise<any>}
 */
async function getEntityByID(header, entityId) {
    dbShouldBeOpen();
    if (typeof entityId !== "number") {
        throw new TypeError("entityId must be typeof number");
    }

    return await db.get("SELECT * FROM entity WHERE id=?", entityId);
}

/**
 * @async
 * @function removeEntity
 * @description Remove an entity by his id!
 * @param {!Addon.CallbackHeader} header Callback Header
 * @param {!number} entityId entityId
 * @returns {Promise<void>}
 */
async function removeEntity(header, entityId) {
    dbShouldBeOpen();
    if (typeof entityId !== "number") {
        throw new TypeError("entityId must be typeof number");
    }

    transact.open(Delete, "entity", [entityId]);
}

/**
 * @async
 * @function declareMetricIdentity
 * @description Remove an entity by his id!
 * @param {!Addon.CallbackHeader} header Callback Header
 * @param {*} mic MetricIdentityCard
 * @returns {Promise<number>}
 */
async function declareMetricIdentity(header, mic) {
    dbShouldBeOpen();
    assertMIC(mic);
    const { name, description: desc = "", unit, interval = 5, max = null, entityId } = mic;

    const query = "SELECT id, description, sample_interval as interval FROM metric_identity_card WHERE name=? AND entity_id=?";
    const row = await db.get(query, name, entityId);

    if (typeof row !== "undefined") {
        if (row.description !== desc || row.interval !== interval) {
            transact.open(Update, "mic", [desc, interval, row.id]);
        }

        return row.id;
    }

    const { lastID } = await db.run( // eslint-disable-next-line
        "INSERT INTO metric_identity_card (name, description, sample_unit, sample_interval, sample_max_value, db_name, entity_id) VALUES (?, ?, ?, ?, ?, ?, @entityId)",
        name, desc, unit, interval, max, header.from, entityId);

    // Create .db and table (if not exists).
    const mDB = await sqlite.open(join(METRICS_DIR, `${header.from}.db`));
    try {
        await mDB.exec(createMetricDB({ name: `${lastID}_${name}` }));
    }
    finally {
        mDB.close();
    }
    Events.executeCallback("publish", void 0, ["Metric", "create", [header.from, lastID]]);

    return lastID;
}

/**
 * @async
 * @function publishMetric
 * @description Publish a new metric (to be queue for population).
 * @param {!Addon.CallbackHeader} header Callback Header
 * @param {!number} micId MetricIdentityCard ID
 * @param {!Array} metricValue metric Array value
 * @returns {Promise<void>}
 *
 * @throws {TypeError}
 * @throws {Error}
 */
async function publishMetric(header, micId, [value, harvestedAt = Date.now(), level = 0]) {
    dbShouldBeOpen();
    if (typeof micId !== "number") {
        throw new TypeError("metric micId should be typeof number!");
    }
    if (typeof value !== "number") {
        throw new TypeError("metric value should be typeof number!");
    }
    if (level > 0 && header.from !== "aggregator") {
        throw new Error("Only aggregate is allowed to publish metric with level higher than zero.");
    }

    const row = await db.get("SELECT name FROM metric_identity_card WHERE id=?", micId);
    if (typeof row === "undefined") {
        throw new Error(`Unable to found metric card with id ${micId}`);
    }

    Q_METRICS.enqueue(header.from, [`${micId}_${row.name}`, value, harvestedAt, level]);
}

/**
 * @async
 * @function getMIC
 * @description Get a metric identity card from DB.
 * @param {!Addon.CallbackHeader} header Callback Header
 * @param {!number} micId MetricIdentityCard ID
 * @returns {Promise<object>}
 */
async function getMIC(header, micId) {
    dbShouldBeOpen();
    const micType = typeof micId;
    if (micType !== "undefined" && micType !== "number") {
        throw new TypeError("micId should be undefined or a number");
    }

    if (micType === "undefined") {
        return db.all("SELECT * FROM metric_identity_card");
    }

    return db.get("SELECT * FROM metric_identity_card WHERE id=?", micId);
}

/**
 * @async
 * @function pullMIC
 * @description Pull MIC from a given mic DB
 * @param {!Addon.CallbackHeader} header Callback Header
 * @param {!number} micId MetricIdentityCard ID
 * @param {object} [options]
 * @param {number} [options.level=0] level to pull
 * @param {!boolean} [options.withSubscriber=true] force execution as non-subscriber
 * @returns {Promise<any>}
 */
async function pullMIC(header, micId, options = {}) {
    const { withSubscriber = true, level = 0 } = options;
    const mic = await getMIC(header, micId);

    // TODO: we may want to check the level arg depending the aggregation mode
    // The goal is to disallow invalid level (avoid creating useless subscriber)
    if (typeof level !== "number") {
        throw new TypeError("level must be a number");
    }

    const ts = withSubscriber ? await getSubscriber(header.from, micId, `pull_${level}`) : 0;
    const now = toUnixEpoch(new Date().getTime());

    const metricDB = await openShareDB.open(mic.db_name);
    try {
        const result = await metricDB.get(
            `SELECT * FROM "${micId}" WHERE harvestedAt < ? AND harvestedAt > ? AND level=?`, now, ts, level);
        if (withSubscriber) {
            await db.run(
                "UPDATE subscribers SET last=? WHERE source=? AND target=? AND kind=?", now, header.from, micId, `pull_${level}`);
        }

        return result;
    }
    catch (err) {
        return null;
    }
    finally {
        openShareDB.close(mic.db_name);
    }
}

/**
 * @async
 * @function getMICStats
 * @description Get a stats for a given MIC
 * @param {!Addon.CallbackHeader} header Callback Header
 * @param {!number} micId MetricIdentityCard ID
 * @param {object} [options]
 * @param {!boolean} [options.walkTimestamp=false] update the subscriber timestamp
 * @param {!boolean} [options.withSubscriber=true] force execution as non-subscriber
 * @returns {Promise<object[]>}
 */
async function getMICStats(header, micId, options = {}) {
    const { walkTimestamp = false, withSubscriber = true } = options;

    const mic = await getMIC(header, micId);
    const ts = withSubscriber ? await getSubscriber(header.from, micId) : 0;
    const tableName = `${micId}_${mic.name}`;
    const result = [];

    const metricDB = await openShareDB.open(mic.db_name);
    try {
        // eslint-disable-next-line max-len
        const countQuery = `SELECT level, count(level) AS count FROM "${tableName}" WHERE harvestedAt > ? GROUP BY level ORDER BY level`;
        // eslint-disable-next-line max-len
        const tsQuery = `SELECT harvestedAt, level FROM "${tableName}" GROUP BY level HAVING MIN(ROWID) ORDER BY ROWID`;

        const [countRes, tsRes] = await Promise.all([
            metricDB.all(countQuery, ts),
            metricDB.all(tsQuery)
        ]);
        const tsMap = new Map(tsRes.map((row) => [row.level, new Date(row.harvestedAt).getTime()]));

        for (const { level, count = 0 } of countRes) {
            const timestamp = tsMap.has(level) ? tsMap.get(level) : Date.now();
            result.push({ level, count, timestamp });
        }
    }
    finally {
        openShareDB.close(mic.db_name);
    }

    if (walkTimestamp && withSubscriber) {
        const now = toUnixEpoch(new Date().getTime());
        await db.run(
            "UPDATE subscribers SET last=? WHERE source=? AND target=? AND kind=?", now, header.from, micId, "stats");
    }

    return result;
}

/**
 * @async
 * @function deleteMICRows
 * @description Delete all rows
 * @param {!Addon.CallbackHeader} header Callback Header
 * @param {!number} micId MetricIdentityCard ID
 * @param {object} [options]
 * @param {number} [options.since]
 * @param {number} [options.level=0]
 * @returns {Promise<void>}
 */
async function deleteMICRows(header, micId, options = {}) {
    const { since, level = 0 } = options;

    if (typeof since !== "number") {
        throw new TypeError("since must be typeof number");
    }
    const mic = await getMIC(header, micId);
    const tableName = `${micId}_${mic.name}`;

    const metricDB = await openShareDB.open(mic.db_name);
    try {
        const query = `DELETE FROM "${tableName}" WHERE harvestedAt < ? AND level = ?`;
        await metricDB.run(query, toUnixEpoch(since), level);
    }
    finally {
        openShareDB.close(mic.db_name);
    }
}

/**
 * @async
 * @function createAlarm
 * @description Create a new Alarm
 * @param {!Addon.CallbackHeader} header Callback Header
 * @param {*} alarm Alarm Object
 * @returns {Promise<boolean>}
 */
async function createAlarm(header, alarm) {
    dbShouldBeOpen();
    assertAlarm(alarm);
    const { message, severity, correlateKey, entityId } = alarm;

    const row = await db.get(
        "SELECT * FROM alarms WHERE correlate_key=? AND entity_id=?", correlateKey, entityId);

    if (typeof row === "undefined") {
        await db.run(
            "INSERT INTO alarms (uuid, message, severity, correlate_key, entity_id) VALUES(?, ?, ?, ?, ?)",
            uuid.v4(), message, severity, correlateKey, entityId
        );
        Events.executeCallback("publish", void 0, ["Alarm", "open", `${entityId}#${correlateKey}`]);

        return false;
    }

    const occur = row.occurence + 1;
    await db.run(
        "UPDATE alarms SET message=?, severity=?, occurence=?, updatedAt=DATETIME('now') WHERE id=?",
        message, severity, occur, row.id
    );
    Events.executeCallback("publish", void 0, ["Alarm", "update", [row.correlate_key, occur]]);

    return true;
}

/**
 * @async
 * @function getAlarms
 * @description Get all or one alarms
 * @param {!Addon.CallbackHeader} header Callback Header
 * @param {string} [cid] Alarm Correlate ID
 * @returns {Promise<void>}
 */
async function getAlarms(header, cid) {
    dbShouldBeOpen();
    if (typeof cid === "string") {
        assertCorrelateID(cid);
        const [entityId, correlateKey] = cid.split("#");

        const alarm = await db.get("SELECT * FROM alarms WHERE correlate_key=? AND entity_id=?", correlateKey, entityId);
        if (typeof alarm === "undefined") {
            throw new Error(`Unable to found any alarm with CID ${cid}`);
        }

        return alarm;
    }

    return await db.all("SELECT * FROM alarms");
}

/**
 * @async
 * @function getAlarmsOccurence
 * @description Get all alarms occurence between 2 times
 * @param {!Addon.CallbackHeader} header Callback Header
 * @param {string} [cid] Alarm Correlate ID
 * @param {object} [options]
 * @param {number} [options.time] Occurence time in minute
 * @param {number} [options.severity] Lower severity to check
 * @returns {Promise<void>}
 */
async function getAlarmsOccurence(header, cid, { time, severity = 0 } = {}) {
    dbShouldBeOpen();
    assertCorrelateID(cid);
    if (!is.number(time)) {
        throw new TypeError("time property should be type of number");
    }
    const dateNow = Date.now() / 1000;
    const startDate = (dateNow - time) * 60;

    const alarms = await db.get( // eslint-disable-next-line
        "SELECT COUNT(*) AS result FROM events WHERE type_id=3 AND name=\"update\" AND data=? AND createdAt BETWEEN datetime(?, 'unixepoch') AND datetime(?, 'unixepoch')",
        cid, startDate, dateNow
    );

    return alarms.result;
}

/**
 * @async
 * @function removeAlarm
 * @description Remove one alarm
 * @param {!Addon.CallbackHeader} header Callback Header
 * @param {!string} cid Alarm Correlate ID
 * @returns {Promise<void>}
 */
async function removeAlarm(header, cid) {
    dbShouldBeOpen();
    assertCorrelateID(cid);

    const [entityId, correlateKey] = cid.split("#");
    transact.open(Delete, "alarms", [correlateKey, entityId]);
}

/**
 * @function registerEventType
 * @description Register event type
 * @param {!Addon.CallbackHeader} header Callback Header
 * @param {!string} name event name
 * @returns {Promise<number>}
 */
async function registerEventType(header, name) {
    dbShouldBeOpen();
    if (typeof name !== "string") {
        throw new TypeError("name should be a string");
    }

    const type = await db.get("SELECT id,name FROM events_type WHERE name=?", name);
    if (typeof type === "undefined") {
        const ret = await db.run("INSERT INTO events_type (name) VALUES(?)", name);
        if (!AVAILABLE_TYPES.has(name)) {
            AVAILABLE_TYPES.set(name, ret.lastID);
        }

        return ret.lastID;
    }

    return type.id;
}

/**
 * @function publish
 * @description Publish a new event
 * @param {!Addon.CallbackHeader} header Callback Header
 * @param {!Array} event event
 * @returns {Promise<void>}
 */
async function publish(header, [type, name, data = ""]) {
    if (!AVAILABLE_TYPES.has(type)) {
        throw new Error(`Unknown event with typeName ${type}`);
    }
    if (typeof name !== "string") {
        throw new TypeError("name should be typeof string");
    }

    // const id = AVAILABLE_TYPES.get(type);
    // if (Events.isAwake) {
    //     transact.open(Insert, "events", [id, name, data.toString()]);
    // }
    // else {
    //     setTimeout(async() => {
    //         await db.run("INSERT INTO events (type_id, name, data) VALUES(?, ?, ?)", id, name, data.toString());
    //     }, 100);
    // }

    // Send data to subscribers!
    const subject = `${type}.${name}`;
    if (SUBSCRIBERS.has(subject)) {
        const addons = [...SUBSCRIBERS.get(subject)];
        Promise.all(addons.map(function sendMessage(addonName) {
            return Events.sendMessage(`${addonName}.event`, {
                args: [subject, data],
                noReturn: true
            });
        }));
    }
}

/**
 * @function summaryStats
 * @description Get the global (local) stats for events (alarms, metrics, entities..).
 * @param {!Addon.CallbackHeader} header Callback Header
 * @returns {Promise<void>}
 */
async function summaryStats(header) {
    const stats = await Promise.all([
        db.get("SELECT count(*) AS entity_count FROM entity"),
        db.get("SELECT count(*) AS alarms_count FROM alarms"),
        db.get("SELECT count(*) AS mic_count FROM metric_identity_card")
    ]);

    return Object.assign({}, ...stats);
}

/**
 * @function subscribe
 * @description Subscribe to event
 * @param {!Addon.CallbackHeader} header Callback Header
 * @param {!string} subjectName Subject name
 * @returns {Promise<void>}
 */
async function subscribe(header, subjectName) {
    console.log(`[EVENT] subscribe : ${subjectName}`);
    if (SUBSCRIBERS.has(subjectName)) {
        SUBSCRIBERS.get(subjectName).add(header.from);
    }
    else {
        SUBSCRIBERS.set(subjectName, new Set([header.from]));
    }
}

/**
 * @function populateMetricsInterval
 * @description Metrics populate interval
 * @returns {Promise<void>}
 */
async function populateMetricsInterval() {
    // Handle Metrics DBs transactions
    for (const id of Q_METRICS.ids()) {
        const metrics = [...Q_METRICS.dequeueAll(id)];
        if (metrics.length <= 0) {
            continue;
        }

        const startTime = performance.now();
        const mDB = await openShareDB.open(id);
        try {
            await mDB.run("BEGIN EXCLUSIVE TRANSACTION;");
            await Promise.all(
                metrics.map((metric) => {
                    const [tableName, value, harvestedAt, level = 0] = metric;
                    const epoch = toUnixEpoch(new Date(harvestedAt).getTime());
                    const query = `INSERT INTO "${tableName}" (value, harvestedAt, level) VALUES(?, ?, ?)`;

                    return mDB.run(query, value, epoch, level);
                })
            );
            await mDB.run("COMMIT TRANSACTION;");
        }
        finally {
            openShareDB.close(id);
        }

        const executeTime = (performance.now() - startTime).toFixed(2);
        Events.logger.writeLine(`Transaction to db '${id}' executed in ${executeTime}ms`);
    }
}

// Addon "Start" event listener
Events.on("start", async() => {
    // Create DB Dir
    await mkdir(METRICS_DIR, { recursive: true });

    // Open SQLite DB
    db = await sqlite.open(join(DB_DIR, "events.db"));
    await db.exec(await readFile(join(__dirname, "sql", "events.sql"), "utf-8"));
    await Promise.all([
        registerEventType(void 0, "Addon"),
        registerEventType(void 0, "Metric"),
        registerEventType(void 0, "Alarm")
    ]);

    // Hydrate events type (Memory Map).
    const types = await db.all("SELECT id, name from events_type");
    for (const type of types) {
        AVAILABLE_TYPES.set(type.name, type.id);
    }

    // Create The transaction Manager
    transact = new TransactManager(db, {
        verbose: false,
        interval: POPULATE_INTERVAL_MS
    });
    await transact.loadSubjectsFromFile(join(__dirname, "src", "sqlquery.json"));

    transact.on("alarms.insert", (ts, data) => {
        Events.executeCallback("publish", void 0, ["Alarm", "open", `${data[4]}#${data[3]}`]);
    });

    transact.on("alarms.update", (ts, data, attach) => {
        Events.executeCallback("publish", void 0, ["Alarm", "update", [attach.correlateKey, data[2]]]);
    });

    // Declare root Entity!
    declareEntity(void 0, {
        name: os.hostname(),
        parent: null,
        description: "",
        descriptors: {
            arch: os.arch(),
            platform: os.platform(),
            release: os.release(),
            type: os.type()
        }
    });

    // Force Addon isReady by himself
    await publish(void 0, ["Addon", "ready", "events"]);
    Events.isReady = true;
});

// Addon "Stop" event listener
Events.on("stop", () => {
    Events.isReady = false;
    if (transact !== null) {
        transact.exit();
        transact = null;
    }
    db.close();
});

Events.registerInterval(populateMetricsInterval, POPULATE_INTERVAL_MS);
Events.registerInterval(async() => {
    const evtTypes = await db.all("SELECT name FROM events_type");
    const typesName = evtTypes.map((row) => row.name);

    for (const key of SUBSCRIBERS.keys()) {
        for (const name of typesName) {
            if (!key.includes(name)) {
                SUBSCRIBERS.delete(key);
            }
        }
    }
}, SANITY_INTERVAL_MS);

// Register others callback(s)
Events.registerCallback("register_event_type", registerEventType);
Events.registerCallback("publish", publish);
Events.registerCallback("subscribe", subscribe);
Events.registerCallback("summary_stats", summaryStats);

// Register entity callback(s)
Events.registerCallback("declare_entity", declareEntity);
Events.registerCallback("declare_entity_descriptor", declareEntityDescriptor);
Events.registerCallback("get_descriptors", getDescriptors);
Events.registerCallback("search_entities", searchEntities);
Events.registerCallback("get_entity_by_id", getEntityByID);
Events.registerCallback("remove_entity", removeEntity);

// Register mic callback(s)
Events.registerCallback("declare_mic", declareMetricIdentity);
Events.registerCallback("publish_metric", publishMetric);
Events.registerCallback("get_mic_stats", getMICStats);
Events.registerCallback("pull_mic", pullMIC);
Events.registerCallback("delete_mic_rows", deleteMICRows);
Events.registerCallback("get_mic", getMIC);

// Register alarms callback(s)
Events.registerCallback("create_alarm", createAlarm);
Events.registerCallback("get_alarms", getAlarms);
Events.registerCallback("get_alarms_occurence", getAlarmsOccurence);
Events.registerCallback("remove_alarm", removeAlarm);

// Export "Events" addon for Core
export default Events;
