// Require Node.JS Dependencies
const {
    mkdir
} = require("fs").promises;
const { join } = require("path");

// Require Third-party Dependencies
const levelup = require("levelup");
const leveldown = require("leveldown");

// Require Internal Dependencies
const Addon = require("@slimio/addon");

// Create Addon!
const Events = new Addon("events");

// Globals var
const dbDirectory = join(__dirname, "db");

/** @type {levelup.LevelUpBase<levelup.Batch>} */
let db = null;

/** @type {levelup.LevelUpBase<levelup.Batch>} */
let history = null;

/** @type {Set<String>} */
const availableTypes = new Set();

/**
 * @func openDB
 * @desc Open level database handler
 * @param {!String} name dbname
 * @returns {levelup.LevelUpBase<levelup.Batch>}
 */
function openDB(name) {
    return levelup(leveldown(join(dbDirectory, name)));
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
    if (availableTypes.has(name)) {
        return `Event type with name ${name} is already registered!`;
    }
    availableTypes.add(name);
    const {
        dump = false,
        storeLocally = true
    } = options;

    if (storeLocally === true) {
        const types = [...availableTypes].join(",");
        await db.put("types", types);
    }

    return null;
}

/**
 * @async
 * @func add
 * @desc Add (publish) a new event!
 * @param {!String} type event type
 * @param {!String} body event body
 * @return {Promise<void>}
 */
async function add(type, body) {
    setImmediate(() => {
        process.stdout.write(`${body}\n`);
    });
}

// Event "init" handler
Events.on("init", async() => {
    console.log("events addon initialized");

    // Create root DB directory
    await mkdir(dbDirectory);
});

// Event "start" handler
Events.on("start", async() => {
    history = openDB("history");
    db = openDB("events");

    try {
        /** @type {String} */
        const types = await db.get("types");
        for (const type of types.split(",")) {
            availableTypes.add(type);
        }
    }
    catch {
        // Do nothing!
    }

    /** @type {registerEventOptions} */
    const defaultRegisterOption = { storeLocally: false };

    // Setup all default type!
    await Promise.all([
        registerEventType("alarm", defaultRegisterOption),
        registerEventType("metric", defaultRegisterOption),
        registerEventType("log", defaultRegisterOption),
        registerEventType("error", { dump: true, ...defaultRegisterOption })
    ]);

    const types = [...availableTypes].join(",");
    await db.set("types", types);
});

// Event "stop" handler
Events.on("stop", () => {
    closeDB(db);
    closeDB(history);
});

// Register addon callback(s)
Events.registerCallback(add);
Events.registerCallback(registerEventType);

// Export addon
module.exports = Events;
