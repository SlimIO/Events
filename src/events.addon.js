// Require Node.JS Dependencies
const { readdir, readFile } = require("fs").promises;
const { join, extname, basename } = require("path");

// Require Third-party Dependencies
const levelup = require("levelup");
const leveldown = require("leveldown");
const protobuf = require("protocol-buffers");
const is = require("@slimio/is");

// Require Internal Dependencies
const Addon = require("@slimio/addon");
const { createDir } = require("./utils");

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
    // eslint-disable-next-line
    db = null;
}

/**
 * @async
 * @func publishEvent
 * @desc Publish a new event!
 * @param {!String} type event type name (name/destination)
 * @param {!Buffer} rawBuf raw payload buffer
 * @return {Promise<Number>}
 *
 * @throws {Error}
 */
async function publishEvent([type, rawBuf]) {
    if (!is.string(type)) {
        throw new TypeError("type should be typeof string");
    }
    if (!is.buffer(rawBuf)) {
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
    // TODO: Improve file loading with a Promise.all
    const files = (await readdir(PROTOTYPE_DIR_PATH)).filter((fileName) => extname(fileName) === ".proto");
    for (const file of files) {
        try {
            const proto = protobuf(await readFile(join(PROTOTYPE_DIR_PATH, file)));
            PROTOTYPES_TYPES.set(basename(file, ".proto"), proto);
        }
        catch (error) {
            console.log(`[EVENTS] Failed to load prototype ${file} - ${error.toString()}`);
        }
    }

    // Create all default types directory!
    await Promise.all(DEFAULT_EVENTS_TYPES.map((type) => createDir(join(DB_DIR_PATH, type))));
});

// Event "stop" handler
Events.on("stop", () => {
    closeDB(db);
});

// Register addon callback(s)
Events.registerCallback("publish_event", publishEvent);

// Export addon
module.exports = Events;
