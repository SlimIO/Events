// Require Node.JS Dependencies
const { mkdir, readdir, readFile } = require("fs").promises;
const { join, extname, basename } = require("path");

// Require Third-party Dependencies
const levelup = require("levelup");
const leveldown = require("leveldown");
const protobuf = require("protocol-buffers");

// Require Internal Dependencies
const Addon = require("@slimio/addon");

// Create Addon!
const Events = new Addon("events");

// CONSTANTS
const DB_DIR_PATH = join(__dirname, "..", "db");
const PROTOTYPE_DIR_PATH = join(__dirname, "..", "prototypes");
const DEFAULT_EVENTS_TYPES = ["alarm", "metric", "log", "error"];

/** @type {levelup.LevelUpBase<levelup.Batch>} */
let db = null;

/** @type {Set<String>} */
const AVAILABLE_TYPES = new Set(DEFAULT_EVENTS_TYPES);

/** @type {Map<String, any>} */
const PROTOTYPES_TYPES = new Map();

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
 * @async
 * @function createDir
 * @param {String} path dbPath
 * @returns {Promise<void>}
 */
async function createDir(path) {
    try {
        await mkdir(path);
    }
    catch (error) {
        if (error.code !== "EEXIST") {
            throw error;
        }
    }
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
async function publishEvent([type, rawBuf]) {
    if (typeof type !== "string") {
        throw new TypeError("type should be typeof string");
    }
    if (!Buffer.isBuffer(rawBuf)) {
        throw new TypeError("rawBuf should be typeof Buffer!");
    }

    const [rType, dest = null] = type.toLowerCase().split("/");
    if (!AVAILABLE_TYPES.has(rType)) {
        throw new Error(`Unknow type ${rType}`);
    }
    const time = Date.now();
    console.log(`[EVENTS] New event. type: ${rType}, destination: ${dest} at ${new Date(time).toString()}`);

    // Open DB
    const db = openDB(dest !== null ? type : rType);

    // Put in DB
    const proto = PROTOTYPES_TYPES.get(rType);
    await db.put(time, rawBuf, { valueEncoding: proto.Event });

    closeDB(db);

    return time;
}

// Event "start" handler
Events.on("start", async() => {
    // Open events db!
    console.log("[EVENTS] Start event triggered!");
    db = openDB("events");

    // Load available Prototypes
    {
        const files = await readdir(PROTOTYPE_DIR_PATH);
        for (const file of files) {
            if (extname(file) !== ".proto") {
                continue;
            }
            try {
                const proto = protobuf(await readFile(join(PROTOTYPE_DIR_PATH, file)));
                PROTOTYPES_TYPES.set(basename(file, ".proto"), proto);
            }
            catch (error) {
                console.log(`[EVENTS] Failed to load prototype ${file} - ${error.toString()}`);
            }
        }
    }

    // Create all default types directory!
    await Promise.all(DEFAULT_EVENTS_TYPES.map((type) => createDir(join(DB_DIR_PATH, type))));

    try {
        /** @type {String} */
        const types = (await db.get("types")).toString();
        for (const type of types.split(",")) {
            AVAILABLE_TYPES.add(type);
        }
    }
    catch (err) {
        // Do nothing...
    }

    // Return if every default types are loaded!
    if (DEFAULT_EVENTS_TYPES.every((eT) => AVAILABLE_TYPES.has(eT) === true)) {
        console.log("[EVENTS] All types already loaded!");

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
    console.log("[EVENTS] All types updated successfully!");
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
