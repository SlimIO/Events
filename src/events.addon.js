// Require NodeJS Dependencies
const { readFile } = require("fs").promises;
const { join } = require("path");
const os = require("os");

// Require Third-Party Dependencies
const Addon = require("@slimio/addon");
const sqlite = require("better-sqlite3");
const { createDirectory } = require("@slimio/utils");
const uuidv4 = require("uuid/v4");
const { setDriftlessInterval, clearDriftless } = require("driftless");

// Require Internal Dependencies
const { assertEntity, assertMIC } = require("./asserts");
const QueueMap = require("./queue");

// CONSTANTS
const ROOT = join(__dirname, "..");
const DB_DIR = join(ROOT, "db");
const METRICS_DIR = join(DB_DIR, "metrics");

// GLOBALS
let db = null;
let interval = null;

/**
 * @typedef Transaction
 * @param {String} action Action name (insert, update, select, remove)
 * @param {String} name Group name
 * @param {any[]} data Data to push
 */

/**
 * @const wTransac
 * @desc Transaction table that contains all SQL query actions
 * @type {Transaction[]}
 */
const wTransac = [];

// Prepared stmt of SQL Query
const SQLQUERY = {
    descriptor: {
        select: "SELECT value FROM entity_descriptor WHERE entity_id=? AND key=?",
        update: "UPDATE entity_descriptor SET value=? AND updatedAt=now() WHERE entity_id=? AND key=?",
        insert: "INSERT INTO entity_descriptor (entity_id, key, value) VALUES (?, ?, ?)"
    },
    entity: {
        update: "UPDATE entity SET description=? WHERE id=?",
        delete: "DELETE FROM entity WHERE id=?"
    },
    mic: {
        update: "UPDATE metric_identity_card SET description=? AND sample_interval=? WHERE id=?"
    }
};

// QUEUES
const Q_METRICS = new QueueMap();

/**
 * @function dbShouldBeOpen
 * @desc check if the event DB is open (shortcut method).
 * @return {void}
 */
function dbShouldBeOpen() {
    if (db === null) {
        throw new Error("Events Addon is not yet ready!");
    }
}

// Create EVENTS Addon!
const Events = new Addon("events");

/**
 * @async
 * @function declareEntityDescriptor
 * @desc Declare one descriptor for a given entity!
 * @param {!Number} entityId entityId
 * @param {!String} key descriptor key
 * @param {!String} value descriptor value
 * @returns {Promise<void>}
 */
async function declareEntityDescriptor(entityId, key, value) {
    dbShouldBeOpen();
    const row = SQLQUERY.descriptor.select.get(entityId, key);

    if (typeof row !== "undefined") {
        if (value !== row.value) {
            wTransac.push({ action: "update", name: "descriptor", data: [row.value, entityId, key] });
        }
    }
    else {
        wTransac.push({ action: "insert", name: "descriptor", data: [entityId, key, value] });
    }
}

/**
 * @async
 * @function declareEntity
 * @desc Declare a new entity
 * @param {*} entity entity
 * @returns {Promise<Number>}
 */
async function declareEntity(entity) {
    dbShouldBeOpen();
    assertEntity(entity);
    const { name, parent = 1, description = null, descriptors = {} } = entity;

    let row;
    if (parent === null) {
        row = db.prepare("SELECT id, description FROM entity WHERE name=? AND parent IS NULL").get(name);
    }
    else {
        row = db.prepare("SELECT id, description FROM entity WHERE name=? AND parent=?").get([name, parent]);
    }

    if (typeof row !== "undefined") {
        if (description !== row.description) {
            wTransac.push({ action: "update", name: "entity", data: [description, row.id] });
        }

        setImmediate(() => {
            for (const [key, value] of Object.entries(descriptors)) {
                declareEntityDescriptor(row.id, key, value);
            }
        });

        return row.id;
    }

    // Else, create a new row for the entity!
    const { lastInsertRowid } = db.prepare(
        "INSERT INTO entity (uuid, name, parent, description) VALUES(uuid(), @name, @parent, @description)"
    ).run({ name, parent, description });
    if (typeof lastInsertRowid !== "number") {
        throw new Error("Failed to insert new entity!");
    }

    setImmediate(() => {
        for (const [key, value] of Object.entries(descriptors)) {
            declareEntityDescriptor(lastInsertRowid, key, value);
        }
    });

    return lastInsertRowid;
}

/**
 * @async
 * @function removeEntity
 * @desc Remove an entity by his id!
 * @param {!Number} entityId entityId
 * @returns {Promise<void>}
 */
async function removeEntity(entityId) {
    dbShouldBeOpen();
    if (typeof entityId !== "number") {
        throw new TypeError("entityId should be typeof number");
    }

    wTransac.push({ action: "delete", name: "entity", data: [entityId] });
}

/**
 * @async
 * @function declareMetricIdentity
 * @desc Remove an entity by his id!
 * @param {*} mic MetricIdentityCard
 * @returns {Promise<Number>}
 */
async function declareMetricIdentity(mic) {
    dbShouldBeOpen();
    assertMIC(mic);
    const { name, description: desc = "", unit, interval = 5, max = null, entityId } = mic;

    const row = db.prepare(
        "SELECT id, description, sample_interval as interval FROM metric_identity_card WHERE name=? AND entity_id=?"
    ).get([name, entityId]);
    if (typeof row !== "undefined") {
        if (row.description !== desc || row.interval !== interval) {
            wTransac.push({ action: "update", name: "mic", data: [desc, interval, row.id] });
        }

        return row.id;
    }

    const { lastInsertRowid } = db.prepare( // eslint-disable-next-line
        "INSERT INTO metric_identity_card (name, description, sample_unit, sample_interval, sample_max_value, entity_id) VALUES (@name, @desc, @unit, @interval, @max, @entityId)"
    ).run({ name, desc, unit, interval, max, entityId });

    // Create the Metrics DB file!
    setImmediate(() => {
        const mDB = new sqlite(join(METRICS_DIR, `${lastInsertRowid}.db`));
        mDB.pragma("auto_vacuum = 1");
        mDB.exec("CREATE TABLE IF NOT EXISTS \"metrics\" (\"value\" INTEGER NOT NULL, \"harvestedAt\" DATE NOT NULL);");
        mDB.close();
    });

    return lastInsertRowid;
}

async function publishMetric(micId, value, harvestedAt = Date.now()) {
    dbShouldBeOpen();
    if (typeof micId !== "number") {
        throw new TypeError("metric micId should be typeof number!");
    }
    if (typeof value !== "number") {
        throw new TypeError("metric value should be typeof number!");
    }

    // console.log(`Enqueue new metric for mic ${micId} with value ${value}`);
    Q_METRICS.enqueue(micId, [value, harvestedAt]);
}

async function createAlarm() {

}

async function getAlarms() {

}

async function removeAlarms() {

}

/**
 * @function populateMetricsInterval
 * @desc Metrics populate interval
 * @returns {Promise<void>}
 */
async function populateMetricsInterval() {
    console.log("Publisher interval triggered!");

    // Handle waiting transactions!
    console.time("wTransac");
    if (wTransac.length > 0) {
        db.transaction(() => {
            const tTransacArr = wTransac.splice(0, wTransac.length);
            while (tTransacArr.length > 0) {
                const ts = tTransacArr.pop();
                SQLQUERY[ts.name][ts.action].run(ts.data);
            }
        })();
    }
    console.timeEnd("wTransac");

    // Handle Metrics DBs transactions
    console.time("metrics_transaction");
    for (const id of Q_METRICS.ids()) {
        const metrics = [...Q_METRICS.dequeueAll(id)];
        if (metrics.length <= 0) {
            continue;
        }

        const mDB = new sqlite(join(METRICS_DIR, `${id}.db`), {
            fileMustExist: true,
            timeout: 100
        });
        const stmt = mDB.prepare("INSERT INTO metrics VALUES(?, ?)");

        console.time(`run_transact_${id}`);
        mDB.transaction((metrics) => {
            for (const metric of metrics) {
                stmt.run(metric);
            }
        })();
        console.timeEnd(`run_transact_${id}`);
        mDB.close();
    }
    console.timeEnd("metrics_transaction");
}

// Addon "Start" event listener
Events.on("start", async() => {
    console.log("[EVENTS] Start event triggered!");
    await createDirectory(DB_DIR);
    await createDirectory(METRICS_DIR);

    db = new sqlite(join(DB_DIR, "events.db"));
    db.exec(await readFile(join(ROOT, "sql", "events.sql"), "utf8"));
    db.function("uuid", () => uuidv4());
    db.function("now", () => Date.now());

    // Prepare Available SQLQuery
    for (const groupName of Object.values(SQLQUERY)) {
        for (const queryName of Object.keys(groupName)) {
            groupName[queryName] = db.prepare(groupName[queryName]);
        }
    }

    console.log("[EVENTS] Declare root entity!");
    // Declare root Entity!
    declareEntity({
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

    setImmediate(() => Events.ready());
    await Events.once("ready");

    interval = setDriftlessInterval(populateMetricsInterval, 5000);
});

// Addon "Stop" event listener
Events.on("stop", () => {
    if (interval !== null) {
        clearDriftless(interval);
        interval = null;
    }
    db.close();
});

// Register metric callback(s)
Events.registerCallback("declare_entity", declareEntity);
Events.registerCallback("declare_entity_descriptor", declareEntityDescriptor);
Events.registerCallback("remove_entity", removeEntity);
Events.registerCallback("declare_mic", declareMetricIdentity);
Events.registerCallback("publish_metric", publishMetric);

// Register alarms callback(s)
Events.registerCallback("create_alarm", createAlarm);
Events.registerCallback("get_alarms", getAlarms);
Events.registerCallback("remove_alarms", removeAlarms);

// Export "Events" addon for Core
module.exports = Events;
