"use strict";

// Require Node.js Dependencies
const { join } = require("path");

// Require Third-Party Dependencies
const sqlite = require("sqlite");

// CONSTANTS
const METRICS_DIR = join(__dirname, "..", "db", "metrics");

// Symbols
const SymList = Symbol("SymList");

class SharedDB {
    /**
     * @class SharedDB
     */
    constructor() {
        Object.defineProperty(this, SymList, {
            value: new Map()
        });
    }

    /**
     * @async
     * @function open
     * @memberof SharedDB#
     * @param {!string} name metrics db name
     * @returns {Promise<void>}
     */
    async open(name) {
        const conn = await sqlite.open(join(METRICS_DIR, `${name}.db`));

        if (this[SymList].has(name)) {
            this[SymList].get(name).count++;
        }
        else {
            this[SymList].set(name, { conn, count: 1 });
        }

        return conn;
    }

    /**
     * @function close
     * @memberof SharedDB#
     * @param {!string} name metrics db name
     * @returns {void}
     */
    close(name) {
        if (!this[SymList].has(name)) {
            return;
        }

        const map = this[SymList].get(name);
        map.count--;
        if (map.count === 0) {
            map.conn.close();
            this[SymList].delete(name);
        }
    }
}

module.exports = SharedDB;
