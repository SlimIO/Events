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
let db = null;
let interval = null;

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

// QUEUES
const metricsQueue = new QueueMap();

// Create EVENTS Addon!
const Events = new Addon("events");

async function declareEntityDescriptor(entityId, key, value) {
    dbShouldBeOpen();

    const row = db.prepare(
        "SELECT value FROM entity_descriptor WHERE entity_id=? AND key=?"
    ).get(entityId, key);

    if (typeof row !== "undefined") {
        if (value !== row.value) {
            db.prepare(
                "UPDATE entity_descriptor SET value=? AND updatedAt=now() WHERE entity_id=? AND key=?"
            ).run(row.value, entityId, key);
        }

        return;
    }

    // Insert descriptor!
    db.prepare(
        "INSERT INTO entity_descriptor (entity_id, key, value) VALUES (@entityId, @key, @value)"
    ).run({ entityId, key, value });
}

async function getEntityOID(entityId) {
    dbShouldBeOpen();
    if (typeof entityId !== "number") {
        throw new TypeError("entityId should be typeof number!");
    }

    const row = db.prepare("SELECT oid FROM entity_oids WHERE entity_id=?").get(entityId);
    if (typeof row === "undefined") {
        throw new Error(`Unable to found any OID for entity id ${entityId}`);
    }

    return row.oid;
}

async function declareEntity(entity) {
    dbShouldBeOpen();
    assertEntity(entity);
    let row;
    const { name, parent = 1, description = null, descriptors = {} } = entity;

    if (parent === null) {
        row = db.prepare("SELECT id, description FROM entity WHERE name=? AND parent IS NULL").get(name);
    }
    else {
        row = db.prepare("SELECT id, description FROM entity WHERE name=? AND parent=?").get([name, parent]);
    }
    if (typeof row !== "undefined") {
        if (description !== row.description) {
            db.prepare("UPDATE entity SET description=? WHERE id=?").run(description, row.id);
        }

        for (const [key, value] of Object.entries(descriptors)) {
            declareEntityDescriptor(row.id, key, value).catch(console.error);
        }

        return row.id;
    }

    // Else, create a new row for the entity!
    const { lastInsertRowid } = db.prepare(
        "INSERT INTO entity (uuid, name, parent, description) VALUES(uuid(), @name, @parent, @description)"
    ).run({ name, parent, description });

    const oid = parent === null ? "1." : `${await getEntityOID(parent)}${lastInsertRowid}.`;
    db.prepare(
        "INSERT INTO entity_oids (entity_id, oid) VALUES(@rowid, @oid)"
    ).run({ rowid: lastInsertRowid, oid });

    for (const [key, value] of Object.entries(descriptors)) {
        declareEntityDescriptor(lastInsertRowid, key, value).catch(console.error);
    }

    return lastInsertRowid;
}

async function removeEntity(entityId) {
    dbShouldBeOpen();
    if (typeof entityId !== "number") {
        throw new TypeError("entityId should be typeof number");
    }

    const row = db.prepare("SELECT id FROM entity WHERE id=?").get(entityId);
    if (typeof row !== "undefined") {
        db.prepare("DELETE FROM entity WHERE id=?").run(entityId);
    }
}

async function declareMetricIdentity(mic) {
    dbShouldBeOpen();
    assertMIC(mic);
    const {
        name,
        description: desc = "",
        unit,
        interval = 5,
        max = null,
        entityId
    } = mic;

    const row = db.prepare(
        "SELECT id, description, sample_interval as interval FROM metric_identity_card WHERE name=? AND entity_id=?"
    ).get([name, entityId]);
    if (typeof row !== "undefined") {
        if (row.description !== desc || row.interval !== interval) {
            db.prepare(
                "UPDATE metric_identity_card SET description=@desc AND interval=@interval WHERE id=@id"
            ).run({ desc, interval, id: row.id });
        }

        return row.id;
    }

    const { lastInsertRowid } = db.prepare( // eslint-disable-next-line
        "INSERT INTO metric_identity_card (name, description, sample_unit, sample_interval, sample_max_value, entity_id) VALUES (@name, @desc, @unit, @interval, @max, @entityId)"
    ).run({ name, desc, unit, interval, max, entityId });

    // Create the Metrics DB file!
    const mDB = new sqlite(join(METRICS_DIR, `${lastInsertRowid}.db`));
    mDB.exec("CREATE TABLE IF NOT EXISTS \"metrics\" (\"value\" INTEGER NOT NULL, \"harvestedAt\" REAL NOT NULL);");
    mDB.close();

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

    console.log(`Enqueue new metric for mic ${micId} with value ${value}`);
    metricsQueue.enqueue(micId, [value, harvestedAt]);
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

    for (const id of metricsQueue.ids()) {
        console.log(`Handle metric(s) with id ${id}`);
        const mDB = new sqlite(join(METRICS_DIR, `${id}.db`));
        const stmt = mDB.prepare("INSERT INTO metrics VALUES(?, ?)");

        const createMany = mDB.transaction((metrics) => {
            for (const metric of metrics) {
                stmt.run(metric);
            }
        });
        createMany([...metricsQueue.dequeueAll(id)]);
        mDB.close();
    }
}

Events.on("start", async() => {
    console.log("[EVENTS] Start event triggered!");
    await createDirectory(DB_DIR);
    await createDirectory(METRICS_DIR);

    db = new sqlite(join(DB_DIR, "events.db"));
    db.exec(await readFile(join(ROOT, "sql", "events.sql"), "utf8"));
    db.function("uuid", () => uuidv4());
    db.function("now", () => Date.now());

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

Events.on("stop", () => {
    if (interval !== null) {
        clearDriftless(interval);
        interval = null;
    }
});

// Register metric callback(s)
Events.registerCallback("declare_entity", declareEntity);
Events.registerCallback("declare_entity_descriptor", declareEntityDescriptor);
Events.registerCallback("remove_entity", removeEntity);
Events.registerCallback("get_entity_oid", getEntityOID);
Events.registerCallback("declare_mic", declareMetricIdentity);
Events.registerCallback("publish_metric", publishMetric);

// Register alarms callback(s)
Events.registerCallback("create_alarm", createAlarm);
Events.registerCallback("get_alarms", getAlarms);
Events.registerCallback("remove_alarms", removeAlarms);

// Export addon
module.exports = Events;
