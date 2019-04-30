// Require Node.js Dependencies
const { join } = require("path");
const { readFile } = require("fs").promises;
const os = require("os");

// Require Third-Party Dependencies
const sqlite = require("sqlite");
const hyperid = require("hyperid");
const Addon = require("@slimio/addon");
const timer = require("@slimio/timer");
const is = require("@slimio/is");
const Queue = require("@slimio/queue");
const { assertEntity, assertMIC, assertAlarm, assertCorrelateID, createDirectory } = require("@slimio/utils");
const TransactManager = require("@slimio/sqlite-transaction");

// CONSTANTS
const DB_DIR = join(__dirname, "db");
const METRICS_DIR = join(DB_DIR, "metrics");
const POPULATE_INTERVAL_MS = 5000;
const SANITY_INTERVAL_MS = 60000;
const ENTITY_IDENTIFIER = new Set(["name", "id", "parent"]);
const { Insert, Update, Delete } = TransactManager.Actions;

// GLOBALS
let db = null;
let interval = null;
let sanity = null;

/**
 * @type {TransactManager}
 */
let transact = null;

// QUEUES & MAPS
const Q_METRICS = new Queue();

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
 * @desc Get one or all descriptors of a given entity
 * @param {*} header Callback Header
 * @param {!Number} entityId entityId
 * @param {String=} key descriptor key
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
 * @desc Declare a new entity
 * @param {*} header Callback Header
 * @param {*} entity entity
 * @returns {Promise<Number>}
 */
async function declareEntity(header, entity) {
    dbShouldBeOpen();
    assertEntity(entity);
    const { name, parent = 1, description = null, descriptors = {} } = entity;

    /** @type {{id: Number, description: String}} */
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
        hyperid()(), name, parent, description
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
 * @desc Search one or many entities by matching search options
 * @param {*} header Callback Header
 * @param {Object} searchOptions search Options
 * @returns {Promise<Number>}
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
 * @desc Remove an entity by his id!
 * @param {*} header Callback Header
 * @param {!Number} entityId entityId
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
 * @desc Remove an entity by his id!
 * @param {*} header Callback Header
 * @param {*} mic MetricIdentityCard
 * @returns {Promise<Number>}
 */
async function declareMetricIdentity(header, mic) {
    dbShouldBeOpen();
    // console.log(mic);
    assertMIC(mic);
    const { name, description: desc = "", unit, interval = 5, max = null, entityId } = mic;

    const query = "SELECT id, description, sample_interval as interval FROM metric_identity_card WHERE name=? AND entity_id=?";
    const row = await db.get(query, name, entityId);

    async function createMetricDB(id) {
        // console.time(`run_create_metric_table_${id}`);
        const mDB = await sqlite.open(join(METRICS_DIR, `${header.from}.db`));
        await mDB.exec(
            `CREATE TABLE IF NOT EXISTS "${id}" ("value" INTEGER NOT NULL, "harvestedAt" DATE NOT NULL);`);
        mDB.close();
        // console.timeEnd(`run_create_metric_table_${id}`);
    }

    if (typeof row !== "undefined") {
        if (row.description !== desc || row.interval !== interval) {
            transact.open(Update, "mic", [desc, interval, row.id]);
        }
        // Create Metrics table
        setImmediate(() => {
            createMetricDB(row.id);
        });

        return row.id;
    }

    const { lastID } = await db.run( // eslint-disable-next-line
        "INSERT INTO metric_identity_card (name, description, sample_unit, sample_interval, sample_max_value, entity_id) VALUES (?, ?, ?, ?, ?, @entityId)",
        name, desc, unit, interval, max, entityId);

    // Create Metrics table
    setImmediate(() => {
        createMetricDB(lastID);
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

    // console.log(`Enqueue new metric for mic ${micId} with value ${value}`);
    Q_METRICS.enqueue(header.from, [micId, value, harvestedAt]);
}

/**
 * @async
 * @function getMIC
 * @desc Get a metric identity card from DB.
 * @param {*} header Callback Header
 * @param {!Number} micId MetricIdentityCard ID
 * @returns {Promise<Object>}
 */
async function getMIC(header, micId) {
    dbShouldBeOpen();
    if (typeof micId !== "number") {
        throw new TypeError("metric micId should be typeof number!");
    }

    return await db.get("SELECT * FROM metric_identity_card WHERE id=?", micId);
}

/**
 * @async
 * @function createAlarm
 * @desc Create a new Alarm
 * @param {*} header Callback Header
 * @param {*} alarm Alarm Object
 * @returns {Promise<Boolean>}
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
            hyperid()(), message, severity, correlateKey, entityId
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
 * @desc Get all alarms occurence between 2 times
 * @param {*} header Callback Header
 * @param {String=} cid Alarm Correlate ID
 * @param {Number=} time Occurence time in minute
 * @param {Number=} severity Lower severity to check
 * @returns {Promise<void>}
 */
async function getAlarmsOccurence(header, cid, { time, severity = 0 }) {
    console.log(`[EVENT] getAlarmsOccurence of : ${cid}`);
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
    console.log(alarms);

    return alarms.result;
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
    transact.open(Delete, "alarms", [correlateKey, entityId]);
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
        throw new TypeError("name should be typeof string");
    }

    const id = AVAILABLE_TYPES.get(type);
    if (Events.isAwake) {
        transact.open(Insert, "events", [id, name, data.toString()]);
    }
    else {
        setTimeout(async() => {
            await db.run("INSERT INTO events (type_id, name, data) VALUES(?, ?, ?)", id, name, data.toString());
        }, 100);
    }

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
 * @function subscribe
 * @desc Subscribe to event
 * @param {*} header Callback Header
 * @param {!String} subjectName Subject name
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
 * @desc Metrics populate interval
 * @returns {Promise<void>}
 */
async function populateMetricsInterval() {
    console.log("Publisher interval triggered!");

    // Handle Metrics DBs transactions
    for (const id of Q_METRICS.ids()) {
        const metrics = [...Q_METRICS.dequeueAll(id)];
        if (metrics.length <= 0) {
            continue;
        }

        console.time(`run_transact_${id}`);
        const mDB = await sqlite.open(join(METRICS_DIR, `${id}.db`));
        await mDB.run("BEGIN EXCLUSIVE TRANSACTION;");
        await Promise.all(metrics.map((metric) => mDB.run(`INSERT INTO "${metric[0]}" VALUES(?, ?)`, metric[1], metric[2])));
        await mDB.run("COMMIT TRANSACTION;");
        mDB.close();
        console.timeEnd(`run_transact_${id}`);
    }
}

// Addon "Start" event listener
Events.on("start", async() => {
    console.log("[EVENTS] Start event triggered!");
    // Create DB Dir
    await createDirectory(DB_DIR);
    await createDirectory(METRICS_DIR);

    // Open SQLite DB
    db = await sqlite.open(join(DB_DIR, "events.db"));
    await db.exec(await readFile(join(__dirname, "sql", "events.sql"), "utf-8"));
    await registerEventType(void 0, "Addon");
    await registerEventType(void 0, "Metric");
    await registerEventType(void 0, "Alarm");

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

    // Setup intervals
    interval = timer.setInterval(populateMetricsInterval, POPULATE_INTERVAL_MS);
    sanity = timer.setInterval(async() => {
        console.log("[Events] Health interval triggered");

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
});

// Addon "Stop" event listener
Events.on("stop", () => {
    Events.isReady = false;
    if (transact !== null) {
        transact.exit();
        transact = null;
    }

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
Events.registerCallback("get_descriptors", getDescriptors);
Events.registerCallback("search_entities", searchEntities);
Events.registerCallback("get_entity_by_id", getEntityByID);
Events.registerCallback("remove_entity", removeEntity);
Events.registerCallback("declare_mic", declareMetricIdentity);
Events.registerCallback("publish_metric", publishMetric);
Events.registerCallback("get_mic", getMIC);


// Register alarms callback(s)
Events.registerCallback("create_alarm", createAlarm);
Events.registerCallback("get_alarms", getAlarms);
Events.registerCallback("get_alarms_occurence", getAlarmsOccurence);
Events.registerCallback("remove_alarm", removeAlarm);

// Export "Events" addon for Core
module.exports = Events;
