// Require Dependencies
const Addon = require("@slimio/addon");

// Create Addon!
const Events = new Addon("events");

/**
 * @async
 * @func publish
 * @desc Publish a new event/message
 * @param {!String} body event body
 * @return {Promise<void>}
 */
async function publish(body) {
    setImmediate(() => {
        process.stdout.write(`${body}\n`);
    });
}
Events.registerCallback(publish);

// Handle events!
Events.on("init", () => {
    console.log("events addon initialized");
});

// Export addon
module.exports = Events;
