// Require Node.js dependencies
const { EventEmitter } = require("events");
const { readFile } = require("fs").promises;
const { extname } = require("path");

// Require Third-party Dependencies
const uuid = require("uuid/v4");
const timer = require("@slimio/timer");

// CONSTANTS
const DEFAULT_INTERVAL_MS = 5000;
const ACTIONS = new Set(["insert", "update", "delete"]);
const TRANSACT = Symbol("TRANSACT");

/** @typedef {(String|Symbol)} Subject */

/**
 * @typedef {Object} Actions
 * @property {String} insert
 * @property {String} delete
 * @property {String} update
 */

/**
 * @typedef {Object} Transaction
 * @property {Number} index
 * @property {Actions} action
 * @property {Subject} subject
 * @property {Number} openAt Transaction Creation timestamp
 * @property {any[]} data
 */

/**
 * @class TransactManager
 * @extends EventEmitter
 *
 * @property {*} db SQLite DB ref
 * @property {Number} timer Interval Timer ID
 * @property {Map<String, Actions>} subjects
 * @property {Map<String, Transaction>} transactions
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
        /** @type {Map<String, Actions>} */
        this.subjects = new Map();

        /** @type {Map<String, Transaction>} */
        this.transactions = new Map();

        Reflect.defineProperty(this, TRANSACT, {
            enumerable: false,
            value: []
        });

        // Create the Transaction interval
        const intervalMs = typeof options.interval === "number" ? options.interval : DEFAULT_INTERVAL_MS;
        this.timer = timer.setInterval(async() => {
            /** @type {String[]} */
            const qtArr = this[TRANSACT];

            // If there is no open transaction (then, just return)
            if (qtArr.length === 0) {
                return;
            }

            let tLen = qtArr.length;
            while (tLen--) {
                const transactId = qtArr.shift();
                const { subject, action, data } = this.transactions.get(transactId);

                const SQLQuery = this.subjects.get(subject)[action];
                this.db.run(SQLQuery, ...data);
                this.transactions.delete(transactId);
            }

            console.log("All transactions completed successfully!");
        }, intervalMs);
    }

    /**
     * @property {Number} size
     * @desc Size of open transactions
     */
    get size() {
        return this.transactions.size;
    }

    /**
     * @version 0.1.0
     *
     * @async
     * @method loadSubjectsFromFile
     * @desc Load subjects from a .JSON file
     * @memberof TransactManager#
     * @param {!String} fileLocation file location on the local disk
     * @returns {Promise<void>}
     *
     * @throws {TypeError}
     * @throws {Error}
     */
    async loadSubjectsFromFile(fileLocation) {
        if (typeof fileLocation !== "string") {
            throw new TypeError("fileLocation should be typeof string!");
        }
        if (extname(fileLocation) !== ".json") {
            throw new Error("Only JSON file are supported!");
        }

        const buf = await readFile(fileLocation);
        const query = JSON.parse(buf.toString());

        for (const [subject, actions] of Object.entries(query)) {
            this.registerSubject(subject, actions);
        }
    }

    /**
     * @version 0.1.0
     *
     * @method registerSubject
     * @desc Add a new transaction subject
     * @memberof TransactManager#
     * @param {!Subject} name subject name
     * @param {!Actions} actions available actions for the given subject
     * @returns {TransactManager}
     *
     * @throws {TypeError}
     *
     * @example
     * const transact = new TransactManager(db);
     * transact.registerSubject("alarm", {
     *     insert: "INSERT INTO ...",
     *     delete: "DELETE FROM alarms WHERE cid = ?"
     * });
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
        const tSub = this.subjects.get(subject);
        if (!Reflect.has(tSub, action)) {
            throw new Error(`Action with name ${action} is not defined on subject ${subject}`);
        }

        // Generate transactId
        const transactId = uuid();
        const openAt = Date.now();

        const index = this[TRANSACT].push(transactId);
        this.transactions.set(transactId, {
            action, subject, data, index, openAt
        });

        return transactId;
    }

    /**
     * @version 0.1.0
     *
     * @method close
     * @desc Close a given transaction by ID
     * @memberof TransactManager#
     * @param {!String} transactId transaction id
     * @returns {Boolean}
     *
     * @throws {Error}
     */
    close(transactId) {
        if (!this.transactions.has(transactId)) {
            return false;
        }

        const { index } = this.transactions.get(transactId);
        if (transactId !== this[TRANSACT][index]) {
            throw new Error("Invalid transactionId index!");
        }
        this[TRANSACT].splice(index, 1);

        return true;
    }

    /**
     * @method exit
     * @desc Exit and liberate all ressources of the TransactionManager (timer etc..)
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
