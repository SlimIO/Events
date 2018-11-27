// Require Node.js dependencies
const { EventEmitter } = require("events");

// Require Third-party Dependencies
const uuid = require("uuid/v4");
const timer = require("@slimio/timer");

// CONSTANTS
const DEFAULT_INTERVAL_MS = 5000;
const ACTIONS = new Set(["insert", "update", "delete"]);

/**
 * @typedef {(String|Symbol)} Subject
 */

/**
 * @class TransactManager
 * @extends EventEmitter
 *
 * @property {*} db SQLite DB ref
 * @property {Number} timer Interval Timer ID
 */
class TransactManager extends EventEmitter {
    /**
     * @constructor
     * @param {*} db SQLite db
     * @param {Object} [options] options object
     * @param {Number} [options.interval=5000] Transaction Interval
     */
    constructor(db, options = Object.create(null)) {
        super();
        this.db = db;
        /** @type {Map<String, any>} */
        this.subjects = new Map();

        // Create the Transaction interval
        const intervalMs = typeof options.interval === "number" ? options.interval : DEFAULT_INTERVAL_MS;
        this.timer = timer.setInterval(() => {
            console.log("execute transaction!");
        }, intervalMs);
    }

    /**
     * @version 0.1.0
     *
     * @method registerSubject
     * @desc Add a new transaction subject
     * @memberof TransactManager#
     * @param {!Subject} name subject name
     * @param {*} actions available actions for the given subject
     * @returns {TransactManager}
     *
     * @throws {TypeError}
     *
     * @example
     * const transact = new TransactManager(db);
     * transact
     *  .registerSubject("alarm")
     *  .registerSubject("entity");
     */
    registerSubject(name, actions) {
        const tName = typeof name;
        if (tName !== "string" && tName !== "symbol") {
            throw new TypeError("name should be typeof string or symbol");
        }
        if (!this.subjects.has(name)) {
            this.subjects.set(name, actions);
        }

        return this;
    }

    /**
     * @version 0.1.0
     *
     * @method open
     * @memberof TransactManager#
     * @param {!String} action action name
     * @param {!Subject} subject subject
     * @param {any[]} data data to be publish
     * @returns {String}
     *
     * @throws {Error}
     */
    open(action, subject, data) {
        if (!ACTIONS.has(action)) {
            throw new Error(`Unknown action ${action}`);
        }
        if (!this.subjects.has(subject)) {
            throw new Error(`Unknown subject with name ${subject}`);
        }

        // Generate transactId
        const transactId = uuid();

        return transactId;
    }

    /**
     * @method exit
     * @memberof TransactManager#
     * @returns {void}
     */
    exit() {
        if (typeof this.timer === "number") {
            timer.clearInterval(this.timer);
        }
    }
}

// Actions Enumeration
TransactManager.Actions = Object.freeze({
    Insert: "insert",
    Update: "update",
    Delete: "delete"
});

module.exports = TransactManager;
