// Require Node.JS Dependencies
const { join } = require("path");

// Require Third-party Dependencies
const is = require("@slimio/is");

// Require Internal Dependencies
const Addon = require("@slimio/addon");
const DBManager = require("./dbmanager");

// Create EVENTS Addon!
const Events = new Addon("events");
const Manager = new DBManager(["alarm", "metric", "log", "error"]);

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
    if (!Manager.defaultTypes.has(rType)) {
        throw new Error(`Unknow type ${rType}`);
    }
    const time = Date.now();
    console.log(`[EVENTS] New event. type: ${rType}, destination: ${dest} at ${new Date(time).toString()}`);

    // Open DB
    const db = DBManager.open(dest !== null ? type : rType);

    // Put in DB
    const proto = Manager.prototypes.get(rType);
    await db.put(time, rawBuf, { valueEncoding: proto.Event });

    DBManager.close(db);

    return time;
}

// Event "start" handler
Events.on("start", async() => {
    console.log("[EVENTS] Start event triggered!");
    await Promise.all(
        Manager.createDBDirectories(),
        Manager.loadPrototypes()
    );
    console.log("[EVENTS] Successfully loaded!");
});

// Register addon callback(s)
Events.registerCallback("publish_event", publishEvent);

// Export addon
module.exports = Events;
