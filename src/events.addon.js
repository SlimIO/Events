// Require NodeJS Dependencies
const { readFile } = require("fs").promises;
const { join } = require("path");
const os = require("os");

// Require Third-Party Dependencies
const Addon = require("@slimio/addon");
const is = require("@slimio/is");
const sqlite = require("better-sqlite3");
const { createDirectory } = require("@slimio/utils");
const uuidv4 = require("uuid/v4");

// Require Internal Dependencies
const { assertEntity } = require("./asserts");

// CONSTANTS
const ROOT = join(__dirname, "..");
const DB_DIR = join(ROOT, "db");
let db = null;

// Create EVENTS Addon!
const Events = new Addon("events");
Events.catch((err) => {
    console.error(err);
});

async function declareEntityDescriptor(entityId, key, value) {
    if (!Events.isReady) {
        throw new Error("Events Addon is not yet ready!");
    }

    const row = db.prepare(
        "SELECT value FROM entity_descriptor WHERE entity_id=? AND key=?"
    ).get(entityId, key);

    if (typeof row !== "undefined") {
        if (value !== row.value) {
            db.prepare(
                "UPDATE entity_descriptor SET value=? WHERE entity_id=? AND key=?"
            ).run(row.value, entityId, key);
        }

        return;
    }

    // Insert descriptor!
    db.prepare(
        "INSERT INTO entity_descriptor VALUES (@entityId, @key, @value)"
    ).run({ entityId, key, value });
}

async function getEntityOID(entityId) {
    if (!Events.isReady) {
        throw new Error("Events Addon is not yet ready!");
    }
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
    if (!Events.isReady) {
        throw new Error("Events Addon is not yet ready!");
    }
    assertEntity(entity);
    const { name, parent = 1, description, descriptors = {} } = entity;

    // If the entity exist, then return the id
    const row = db.prepare("SELECT id, description FROM entity WHERE name=? AND parent=?").get([name, parent]);
    if (typeof row !== "undefined") {
        if (description !== row.description) {
            db.prepare("UPDATE entity SET description=? WHERE id=?").run(row.id);
        }

        for (const [key, value] of Object.entries(descriptors)) {
            declareEntityDescriptor(row.id, key, value).catch(console.error);
        }

        return row.id;
    }

    // Else, create a new row for the entity!
    const { lastInsertROWID } = db.prepare(
        "INSERT INTO entity (uuid, name, parent, description) VALUES(uuid(), @name, @parent, @description)"
    ).run({ name, parent, description });

    const oid = parent === null ? "1." : `${await getEntityOID(parent)}${lastInsertROWID}.`;
    db.prepare(
        "INSERT INTO entity_oids VALUES(@rowid, @oid)"
    ).run({ rowid: lastInsertROWID, oid });

    for (const [key, value] of Object.entries(descriptors)) {
        declareEntityDescriptor(lastInsertROWID, key, value).catch(console.error);
    }

    return lastInsertROWID;
}

async function removeEntity(entityId) {

}

async function declareMetricIdentity() {
    // Do things..
}

async function publishAlarm() {
    // Do things..
}

async function publishMetric() {
    // Do things..
}

// Event "start" handler
Events.on("start", async() => {
    console.log("[EVENTS] Start event triggered!");
    await createDirectory(DB_DIR);
    db = new sqlite(join(DB_DIR, "events.db"));
    db.exec(await readFile(join(ROOT, "sql", "events.sql"), "utf8"));
    db.register(function uuid() {
        return uuidv4();
    });

    setImmediate(() => {
        Events.ready();
    });
    await Events.once("ready");

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
});

// Register addon callback(s)
Events.registerCallback("declare_entity", declareEntity);
Events.registerCallback("declare_entity_descriptor", declareEntityDescriptor);
Events.registerCallback("remove_entity", removeEntity);
Events.registerCallback("get_entity_oid", getEntityOID);

Events.registerCallback("declare_mic", declareMetricIdentity);
Events.registerCallback("publish_alarm", publishAlarm);
Events.registerCallback("publish_metric", publishMetric);

// Export addon
module.exports = Events;
