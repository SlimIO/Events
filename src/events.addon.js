// Require NodeJS Dependencies
const { readFile } = require("fs").promises;
const { join } = require("path");

// Require Third-Party Dependencies
const Addon = require("@slimio/addon");
const sqlite = require("better-sqlite3");
const { createDirectory } = require("@slimio/utils");

// CONSTANTS
const ROOT = join(__dirname, "..");
const DB_DIR = join(ROOT, "db");
let db;

// Create EVENTS Addon!
const Events = new Addon("events");

async function registerIdentity() {
    // Do things..
}

async function publishMetricIdentity() {
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
    // db = new sqlite(join(DB_DIR, "events.db"));
    // db.exec(await readFile(join(ROOT, "sql", "events.sql"), "utf8"));

    const metricsTest = new sqlite(join(DB_DIR, "metric.sql"));
    metricsTest.exec(await readFile(join(ROOT, "sql", "metric.sql"), "utf8"));

    Events.emit("ready");
});

// Register addon callback(s)
Events.registerCallback("register_identity", registerIdentity);
Events.registerCallback("publish_mic", publishMetricIdentity);
Events.registerCallback("publish_alarm", publishAlarm);
Events.registerCallback("publish_metric", publishMetric);

// Export addon
module.exports = Events;
