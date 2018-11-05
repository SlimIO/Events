// Require NodeJS Dependencies
const { join } = require("path");
const { readFile } = require("fs").promises;
const os = require("os");

// Require Third-Party Dependencies
const Addon = require("@slimio/addon");
const sqlite3 = require("sqlite3");
const { createDirectory } = require("@slimio/utils");
const timer = require("@slimio/timer");

// CONSTANTS
const ROOT = join(__dirname, "..");
const DB_DIR = join(ROOT, "db");
const METRICS_DIR = join(DB_DIR, "metrics");
const POPULATE_INTERVAL_MS = 1000;

// GLOBALS
let db = null;
let interval = null;

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
}

/**
 * @async
 * @function declareEntity
 * @desc Declare a new entity
 * @param {*} entity entity
 * @returns {Promise<Number>}
 */
async function declareEntity(entity) {
}

/**
 * @async
 * @function removeEntity
 * @desc Remove an entity by his id!
 * @param {!Number} entityId entityId
 * @returns {Promise<void>}
 */
async function removeEntity(entityId) {
}

/**
 * @async
 * @function declareMetricIdentity
 * @desc Remove an entity by his id!
 * @param {*} mic MetricIdentityCard
 * @returns {Promise<Number>}
 */
async function declareMetricIdentity(mic) {
}

/**
 * @async
 * @function publishMetric
 * @desc Publish a new metric (to be queue for population).
 * @param {!Number} micId MetricIdentityCard ID
 * @param {!Number} value Metric value
 * @param {Number=} harvestedAt Metric harvested timestamp
 * @returns {Promise<void>}
 */
async function publishMetric(micId, value, harvestedAt = Date.now()) {

}

/**
 * @async
 * @function createAlarm
 * @desc Create a new Alarm
 * @param {*} alarm Alarm Object
 * @returns {Promise<void>}
 */
async function createAlarm(alarm) {
}

/**
 * @async
 * @function createAlarm
 * @desc Get all or one alarms
 * @param {String=} cid Alarm Correlate ID
 * @returns {Promise<void>}
 */
async function getAlarms(cid) {
}

/**
 * @async
 * @function removeAlarm
 * @desc Remove one alarm
 * @param {!String} cid Alarm Correlate ID
 * @returns {Promise<void>}
 */
async function removeAlarm(cid) {

}

/**
 * @function populateMetricsInterval
 * @desc Metrics populate interval
 * @returns {Promise<void>}
 */
async function populateMetricsInterval() {
    console.log("Publisher interval triggered!");
}

// Addon "Start" event listener
Events.on("start", async() => {
    console.log("[EVENTS] Start event triggered!");
    await createDirectory(DB_DIR);
    await createDirectory(METRICS_DIR);

    db = new sqlite3.Database(join(DB_DIR, "events.db"));
    db.serialize(async function createTable() {
        db.run(await readFile(join(ROOT, "sql", "events.sql")));
    });

    // Declare root Entity!
    // declareEntity({
    //     name: os.hostname(),
    //     parent: null,
    //     description: "",
    //     descriptors: {
    //         arch: os.arch(),
    //         platform: os.platform(),
    //         release: os.release(),
    //         type: os.type()
    //     }
    // });

    setImmediate(() => Events.ready());
    await Events.once("ready");

    interval = timer.setInterval(populateMetricsInterval, POPULATE_INTERVAL_MS);
});

// Addon "Stop" event listener
Events.on("stop", () => {
    timer.clearInterval(interval);
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
Events.registerCallback("remove_alarm", removeAlarm);

// Export "Events" addon for Core
module.exports = Events;
