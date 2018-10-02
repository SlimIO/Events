// Require NodeJS Dependencies
const { readFile } = require("fs").promises;
const { join } = require("path");
const { hostname } = require("os");

// Require Third-Party Dependencies
const Addon = require("@slimio/addon");
const sqlite = require("better-sqlite3");
const { createDirectory } = require("@slimio/utils");
const uuidv5 = require("uuid/v5");

// CONSTANTS
const ROOT = join(__dirname, "..");
const DB_DIR = join(ROOT, "db");
let db = null;

// Create EVENTS Addon!
const Events = new Addon("events");

async function declareIdentity(entity) {
    if (db === null || !db.open) {
        throw new Error("Events DB not open!");
    }

    const stmt = db.prepare(
        "INSERT INTO entity(uuid, name, parent, description) VALUES(uuid(@name), @name, @parent, @description)"
    );
    stmt.run({
        name: entity.name,
        parent: entity.parent,
        description: entity.description
    });
    // Do things..
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
    db.register(function uuid(name) {
        return uuidv5(hostname(), name);
    });

    Events.emit("ready");
});

// Register addon callback(s)
Events.registerCallback("declare_identity", declareIdentity);
Events.registerCallback("declare_mic", declareMetricIdentity);
Events.registerCallback("publish_alarm", publishAlarm);
Events.registerCallback("publish_metric", publishMetric);

// Export addon
module.exports = Events;
