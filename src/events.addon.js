// Require Node.JS Dependencies
const { join } = require("path");

// Require Third-party Dependencies
const levelup = require("levelup");
const leveldown = require("leveldown");

// Require Internal Dependencies
const Addon = require("@slimio/addon");

// Create Addon!
const Events = new Addon("events");

// Globals var
const DB_DIR_PATH = join(__dirname, "..", "db");

/** @type {levelup.LevelUpBase<levelup.Batch>} */
let db = null;

/** @type {Set<String>} */
const AVAILABLE_TYPES = new Set();

const DEFAULT_EVENTS_TYPES = ["alarm", "metric", "log", "error"];

/**
 * @async
 * @func openDB
 * @desc Open level database handler
 * @param {!String} name dbname
 * @returns {levelup.LevelUpBase<levelup.Batch>}
 */
function openDB(name) {
    return levelup(leveldown(join(DB_DIR_PATH, name)), { createIfMissing: true });
}

/**
 * @func closeDB
 * @desc Close level database handler
 * @param {levelup.LevelUpBase<levelup.Batch>} db db handler!
 * @returns {void}
 */
function closeDB(db) {
    if (db.isOpen()) {
        db.close();
    }
    db = null;
}

/**
 * @typedef {Object} registerEventOptions
 * @property {Boolean=} dump
 * @property {Boolean=} storeLocally
 */

/**
 * @async
 * @func registerEventType
 * @desc Register a new event type
 * @param {!String} name event name
 * @param {registerEventOptions=} options event options
 * @return {Promise<String>}
 */
async function registerEventType(name, options = {}) {
    if (name === "events") {
        return "Event type name 'events' is INVALID!";
    }
    if (AVAILABLE_TYPES.has(name)) {
        return `Event type with name ${name} is already registered!`;
    }
    AVAILABLE_TYPES.add(name);
    const { storeLocally = true } = options;

    if (storeLocally === true) {
        const types = [...AVAILABLE_TYPES].join(",");
        await db.put("types", types);
    }

    return null;
}

/**
 * @async
 * @func publishEvent
 * @desc Publish a new event!
 * @param {!String} type event type
 * @param {!Buffer} rawBuf buffer
 * @return {Promise<Number>}
 */
async function publishEvent(type, rawBuf) {
    const [rType, dest = null] = type.split(".");
    const time = Date.now();

    return time;
}

// Event "start" handler
Events.on("start", async() => {
    // Open events db!
    db = openDB("events");

    try {
        /** @type {String} */
        const types = (await db.get("types")).toString();
        for (const type of types.split(",")) {
            AVAILABLE_TYPES.add(type);
        }
    }
    catch (error) {
        // Do nothing...
    }

    // Return if every default types are loaded!
    if (DEFAULT_EVENTS_TYPES.every((eT) => AVAILABLE_TYPES.has(eT) === true)) {
        console.log("EVENTS: All default types are loaded successfully!");

        return;
    }

    /** @type {registerEventOptions} */
    const defaultRegisterOption = { storeLocally: false };

    // Setup all default types!
    await Promise.all([
        registerEventType("alarm", defaultRegisterOption),
        registerEventType("metric", defaultRegisterOption),
        registerEventType("log", defaultRegisterOption),
        registerEventType("error", defaultRegisterOption)
    ]);

    //
    await db.put("types", [...AVAILABLE_TYPES].join(","));
});

// Event "stop" handler
Events.on("stop", () => {
    closeDB(db);
});

// Register addon callback(s)
Events.registerCallback("register_event_type", registerEventType);
Events.registerCallback("publish_event", publishEvent);

// Export addon
module.exports = Events;
