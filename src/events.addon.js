// Require NodeJS Dependencies
const { readFile } = require("fs").promises;
const { join } = require("path");

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

async function declareEntityDescriptor(entityId, key, value) {
    if (!Events.isReady) {
        throw new Error("Events Addon is not yet ready!");
    }

    db.prepare("INSERT INTO entity_descriptor (entity_id, key, value) VALUES (@id, @key, @value)")
        .run({ id: entityId, key, value });
}

async function declareEntity(entity) {
    if (!Events.isReady) {
        throw new Error("Events Addon is not yet ready!");
    }
    assertEntity(entity);
    const { name, parent, description, descriptors = {} } = entity;

    // If the entity exist, then return the id
    const row = db.prepare("SELECT id FROM entity WHERE name=@name").get({ name });
    if (typeof row !== "undefined") {
        for (const [key, value] of Object.entries(descriptors)) {
            declareEntityDescriptor(row.id, key, value).catch(console.error);
        }

        return row.id;
    }

    // Else, create a new row for the entity!
    const stmt = db.prepare(
        "INSERT INTO entity(uuid, name, parent, description) VALUES(uuid(), @name, @parent, @description)"
    );

    const RowID = stmt.run({ name, parent, description }).lastInsertROWID;
    for (const [key, value] of Object.entries(descriptors)) {
        declareEntityDescriptor(row.id, key, value).catch(console.error);
    }

    return RowID;
}

async function removeEntity(entityId) {

}

async function getEntityOID(entityName) {

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

    Events.ready();
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
