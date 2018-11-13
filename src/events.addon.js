// Require NodeJS Dependencies
const { join } = require("path");
const { readFile } = require("fs").promises;
const os = require("os");

// Require Third-Party Dependencies
const Addon = require("@slimio/addon");
const sqlite = require("sqlite");
const uuid = require("uuid/v4");
const { createDirectory } = require("@slimio/utils");
const timer = require("@slimio/timer");

// Require Internal Dependencies
const { assertEntity, assertMIC, assertAlarm, assertCorrelateID } = require("./asserts");
const QueueMap = require("./queues");

// CONSTANTS
const ROOT = join(__dirname, "..");
const DB_DIR = join(ROOT, "db");
const METRICS_DIR = join(DB_DIR, "metrics");
const POPULATE_INTERVAL_MS = 5000;
const SANITY_INTERVAL_MS = 60000;

// GLOBALS
let db = null;
let interval = null;
let sanity = null;

/**
 * @const QueryTransac
 * @desc Transaction table that contains all SQL query actions
 * @type {Transaction[]}
 */
const QueryTransac = [];

// Prepared stmt of SQL Query
const SQLQUERY = require("./sqlquery.json");

// QUEUES & MAPS
const Q_METRICS = new QueueMap();

/** @type {Map<String, Number>} */
const AVAILABLE_TYPES = new Map([
    ["Addon", 1],
    ["Alarm", 2],
    ["Metric", 3]
]);

/** @type {Map<String, Set<String>>} */
const SUBSCRIBERS = new Map();

/**
 * @func dbShouldBeOpen
 * @desc The database should be open
 * @return {void}
 */
function dbShouldBeOpen() {
    if (db === null) {
        throw new Error("Events database not open!");
    }
}

// Create EVENTS Addon!
const Events = new Addon("events");

/**
 * @async
 * @function declareEntityDescriptor
 * @desc Declare one descriptor for a given entity!
 * @param {*} header Callback Header
 * @param {!Number} entityId entityId
 * @param {!Array} KeyValue descriptor key
 * @returns {Promise<void>}
 */
async function declareEntityDescriptor(header, entityId, [key, value]) {
    dbShouldBeOpen();
    const row = await db.get(
        "SELECT value FROM entity_descriptor WHERE entity_id=? AND key=?", entityId, key);

    if (typeof row !== "undefined") {
        if (value !== row.value) {
            QueryTransac.push({ action: "update", name: "descriptor", data: [row.value, entityId, key] });
        }
    }
    else {
        QueryTransac.push({ action: "insert", name: "descriptor", data: [entityId, key, value] });
    }
}

/**
 * @async
 * @function declareEntity
 * @desc Declare a new entity
 * @param {*} header Callback Header
 * @param {*} entity entity
 * @returns {Promise<Number>}
 */
async function declareEntity(header, entity) {
    dbShouldBeOpen();
    assertEntity(entity);
    const { name, parent = 1, description = null, descriptors = {} } = entity;

    let row;
    if (parent === null) {
        row = await db.get("SELECT id, description FROM entity WHERE name=? AND parent IS NULL", name);
    }
    else {
        row = await db.get("SELECT id, description FROM entity WHERE name=? AND parent=?", name, parent);
    }

    if (typeof row !== "undefined") {
        if (description !== row.description) {
            QueryTransac.push({ action: "update", name: "entity", data: [description, row.id] });
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
        uuid(), name, parent, description
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
 * @function removeEntity
 * @desc Remove an entity by his id!
 * @param {*} header Callback Header
 * @param {!Number} entityId entityId
 * @returns {Promise<void>}
 */
async function removeEntity(header, entityId) {
    dbShouldBeOpen();
    if (typeof entityId !== "number") {
        throw new TypeError("entityId should be typeof number");
    }

    QueryTransac.push({ action: "delete", name: "entity", data: [entityId] });
}

/**
 * @async
 * @function declareMetricIdentity
 * @desc Remove an entity by his id!
 * @param {*} header Callback Header
 * @param {*} mic MetricIdentityCard
 * @returns {Promise<Number>}
 */
async function declareMetricIdentity(header, mic) {
    dbShouldBeOpen();
    assertMIC(mic);
    const { name, description: desc = "", unit, interval = 5, max = null, entityId } = mic;

    const row = await db.get(
        "SELECT id, description, sample_interval as interval FROM metric_identity_card WHERE name=? AND entity_id=?",
        name, entityId);

    if (typeof row !== "undefined") {
        if (row.description !== desc || row.interval !== interval) {
            QueryTransac.push({ action: "update", name: "mic", data: [desc, interval, row.id] });
        }

        return row.id;
    }

    const { lastID } = await db.run( // eslint-disable-next-line
        "INSERT INTO metric_identity_card (name, description, sample_unit, sample_interval, sample_max_value, entity_id) VALUES (?, ?, ?, ?, ?, @entityId)",
        name, desc, unit, interval, max, entityId);

    // Create the Metrics DB file!
    setImmediate(async() => {
        const mDB = await sqlite.open(join(METRICS_DIR, `${lastID}.db`));
        await mDB.exec(
            "CREATE TABLE IF NOT EXISTS \"metrics\" (\"value\" INTEGER NOT NULL, \"harvestedAt\" DATE NOT NULL);");
        mDB.close();
    });

    return lastID;
}

/**
 * @async
 * @function publishMetric
 * @desc Publish a new metric (to be queue for population).
 * @param {*} header Callback Header
 * @param {!Number} micId MetricIdentityCard ID
 * @param {!Array} metricValue metric Array value
 * @returns {Promise<void>}
 */
async function publishMetric(header, micId, [value, harvestedAt = Date.now()]) {
    dbShouldBeOpen();
    if (typeof micId !== "number") {
        throw new TypeError("metric micId should be typeof number!");
    }
    if (typeof value !== "number") {
        throw new TypeError("metric value should be typeof number!");
    }

    console.log(`Enqueue new metric for mic ${micId} with value ${value}`);
    Q_METRICS.enqueue(micId, [value, harvestedAt]);
}

/**
 * @async
 * @function createAlarm
 * @desc Create a new Alarm
 * @param {*} header Callback Header
 * @param {*} alarm Alarm Object
 * @returns {Promise<void>}
 */
async function createAlarm(header, alarm) {
    dbShouldBeOpen();
    assertAlarm(alarm);
    console.log(alarm);
    const { message, severity, correlateKey, entityId } = alarm;

    const row = await db.get(
        "SELECT * FROM alarms WHERE correlate_key=? AND entity_id=?", correlateKey, entityId);

    if (typeof row === "undefined") {
        QueryTransac.push({ action: "insert", name: "alarms", data: [uuid(), message, severity, correlateKey, entityId] });
    }
    else {
        console.log(row.id);
        QueryTransac.push({ action: "update", name: "alarms", data: [message, severity, row.occurence + 1, row.id] });
    }
    console.log(`Alarm created : ${entityId}${correlateKey}`);
    console.log(`Occurence : ${row.occurence + 1}`);
}

/**
 * @async
 * @function createAlarm
 * @desc Get all or one alarms
 * @param {*} header Callback Header
 * @param {String=} cid Alarm Correlate ID
 * @returns {Promise<void>}
 */
async function getAlarms(header, cid) {
    dbShouldBeOpen();
    if (typeof cid === "string") {
        assertCorrelateID(cid);
        const [entityId, correlateKey] = cid.split("#");

        const alarm = db.get(
            "SELECT * FROM alarms WHERE correlate_key=? AND entity_id=?", correlateKey, entityId);
        if (typeof alarm === "undefined") {
            throw new Error(`Unable to found any alarm with CID ${cid}`);
        }

        return alarm;
    }

    return await db.all("SELECT * FROM alarms");
}

/**
 * @async
 * @function removeAlarm
 * @desc Remove one alarm
 * @param {*} header Callback Header
 * @param {!String} cid Alarm Correlate ID
 * @returns {Promise<void>}
 */
async function removeAlarm(header, cid) {
    dbShouldBeOpen();
    assertCorrelateID(cid);

    const [entityId, correlateKey] = cid.split("#");
    QueryTransac.push({ action: "delete", name: "alarms", data: [correlateKey, entityId] });
}

/**
 * @function registerEventType
 * @desc Register event type
 * @param {*} header Callback Header
 * @param {!String} name event name
 * @returns {Promise<Number>}
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
 * @desc Publish a new event
 * @param {*} header Callback Header
 * @param {!Array} event event
 * @returns {Promise<void>}
 */
async function publish(header, [type, name, data = ""]) {
    if (!AVAILABLE_TYPES.has(type)) {
        throw new Error(`Unknown event with typeName ${type}`);
    }
    if (typeof name !== "string") {
        throw new Error("name should be typeof string");
    }
    if (typeof data !== "string") {
        throw new Error("data should be typeof string");
    }
    const id = AVAILABLE_TYPES.get(type);

    QueryTransac.push({ action: "insert", name: "events", data: [id, name, data] });

    // Send data to subscribers!
    const subject = `${type}.${name}`;
    if (SUBSCRIBERS.has(subject)) {
        const addons = [...SUBSCRIBERS.get(subject)];
        Promise.all(addons.map((addonName) => {
            return Events.sendMessage(`${addonName}.event`, {
                args: [subject, data],
                noReturn: true
            });
        }));
    }
}

/**
 * @function subscribe
 * @desc Subscribe to event
 * @param {*} header Callback Header
 * @param {!String} subjectName Subject name
 * @returns {Promise<void>}
 */
async function subscribe(header, subjectName) {
    if (SUBSCRIBERS.has(subjectName)) {
        SUBSCRIBERS.get(subjectName).add(header.from);
    }
    else {
        SUBSCRIBERS.set(subjectName, new Set([header.from]));
    }
}

/**
 * @function populateMetricsInterval
 * @desc Metrics populate interval
 * @returns {Promise<void>}
 */
async function populateMetricsInterval() {
    console.log("Publisher interval triggered!");

    // Handle waiting transactions!
    console.time("QueryTransac");
    if (QueryTransac.length > 0) {
        const pTransac = [];
        const tTransacArr = QueryTransac.splice(0, QueryTransac.length);
        while (tTransacArr.length > 0) {
            const ts = tTransacArr.pop();
            console.log(SQLQUERY[ts.name][ts.action], ...ts.data),
            pTransac.push(db.run(SQLQUERY[ts.name][ts.action], ...ts.data));
        }

        await Promise.all(pTransac);
    }
    console.timeEnd("QueryTransac");

    // Handle Metrics DBs transactions
    console.time("metrics_transaction");
    for (const id of Q_METRICS.ids()) {
        const metrics = [...Q_METRICS.dequeueAll(id)];
        if (metrics.length <= 0) {
            continue;
        }

        console.time(`run_transact_${id}`);
        const mDB = await sqlite.open(join(METRICS_DIR, `${id}.db`));
        await Promise.all(metrics.map((metric) =>
            mDB.run("INSERT INTO metrics VALUES(?, ?)", metric[0], metric[1])
        ));
        console.timeEnd(`run_transact_${id}`);
        mDB.close();
    }
    console.timeEnd("metrics_transaction");
}

/**
 * @function sanityInterval
 * @desc Events sanity interval
 * @returns {Promise<void>}
 */
async function sanityInterval() {
    console.log("HEALTH SANITY INTERVAL!");
}

// Addon "Start" event listener
Events.on("start", async() => {
    console.log("[EVENTS] Start event triggered!");
    await createDirectory(DB_DIR);
    await createDirectory(METRICS_DIR);

    db = await sqlite.open(join(DB_DIR, "events.db"));
    await db.exec(await readFile(join(ROOT, "sql", "events.sql"), "utf-8"));
    await registerEventType(void 0, "Addon");
    await registerEventType(void 0, "Metric");
    await registerEventType(void 0, "Alarm");

    const types = await db.all("SELECT id, name from events_type");
    for (const type of types) {
        AVAILABLE_TYPES.set(type.name, type.id);
    }

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
    // Events.isReady = true;
    Events.ready();

    interval = timer.setInterval(populateMetricsInterval, POPULATE_INTERVAL_MS);
    sanity = timer.setInterval(sanityInterval, SANITY_INTERVAL_MS);
});

// Addon "Stop" event listener
Events.on("stop", () => {
    Events.isReady = false;
    timer.clearInterval(interval);
    timer.clearInterval(sanity);
    db.close();
});

// Register event callback(s)
Events.registerCallback("register_event_type", registerEventType);
Events.registerCallback("publish", publish);
Events.registerCallback("subscribe", subscribe);

// Register metric callback(s)
Events.registerCallback("declare_entity", declareEntity);
Events.registerCallback("declare_entity_descriptor", declareEntityDescriptor);
Events.registerCallback("remove_entity", removeEntity);
Events.registerCallback("declare_mic", declareMetricIdentity);
Events.registerCallback("publish_metric", publishMetric);

// Register alarms callback(s)
Events.registerCallback("create_alarm", createAlarm);
Events.registerCallback("get_alarms", getAlarms);
Events.registerCallback("remove_alarm", removeAlarm);

// Export "Events" addon for Core
module.exports = Events;
