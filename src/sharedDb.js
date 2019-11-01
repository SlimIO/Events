// Require Node.js Dependencies
import { join, dirname } from "path";
import { fileURLToPath } from 'url';

// Require Third-Party Dependencies
import sqlite from "sqlite";

// Node.js CJS constant
const __dirname = dirname(fileURLToPath(import.meta.url));

// CONSTANTS
const METRICS_DIR = join(__dirname, "..", "db", "metrics");

// Symbols
const SymList = Symbol("SymList");

export default class SharedDB {
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
     * @returns {Promise<any>}
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
