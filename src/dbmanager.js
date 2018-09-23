// Require NodeJS Dependencies
const { readdir, readFile } = require("fs").promises;
const { join, basename, extname } = require("path");

// Require Third-party Dependencies
const levelup = require("levelup");
const leveldown = require("leveldown");
const protobuf = require("protocol-buffers");
const is = require("@slimio/is");

// Require Internal Dependencies
const { createDir } = require("./utils");

// CONSTANTS
const DB_DIR_PATH = join(__dirname, "..", "db");
const PROTOTYPE_DIR_PATH = join(__dirname, "..", "prototypes");

/**
 * @class DBManager
 */
class DBManager {

    /**
     * @static
     * @method open
     * @desc Open level database handler
     * @param {!String} name dbname
     * @returns {levelup.LevelUpBase<levelup.Batch>}
     */
    static open(name) {
        return levelup(leveldown(join(DB_DIR_PATH, name)), { createIfMissing: true });
    }

    /**
     * @static
     * @method close
     * @desc Close level database handler
     * @param {levelup.LevelUpBase<levelup.Batch>} db db handler!
     * @returns {void}
     */
    static close(db) {
        if (db.isOpen()) {
            db.close();
        }
        // eslint-disable-next-line
        db = null;
    }

    /**
     * @constructor
     * @param {!Array<String>} defaultTypes default events types
     * @throws {TypeError}
     */
    constructor(defaultTypes = []) {
        if (!is.array(defaultTypes)) {
            throw new TypeError("defaultTypes argument should be instanceof Array prototype");
        }
        this.prototypes = new Map();
        this.defaultTypes = new Set(defaultTypes);
    }

    /**
     * @async
     * @method loadPrototypes
     * @desc Load available local prototypes
     * @memberof DBManager#
     * @returns {Promise<void>}
     */
    async loadPrototypes() {
        // TODO: Improve file loading with a Promise.all
        const files = (await readdir(PROTOTYPE_DIR_PATH)).filter((fileName) => extname(fileName) === ".proto");
        for (const file of files) {
            try {
                const proto = protobuf(await readFile(join(PROTOTYPE_DIR_PATH, file)));
                this.prototypes.set(basename(file, ".proto"), proto);
            }
            catch (error) {
                console.log(`[EVENTS] Failed to load prototype ${file} - ${error.toString()}`);
            }
        }
    }

    /**
     * @async
     * @method createDBDirectories
     * @desc Create default events db directories
     * @memberof DBManager#
     * @returns {Promise<void>}
     */
    async createDBDirectories() {
        return Promise.all(
            [...this.defaultTypes].map((type) => createDir(join(DB_DIR_PATH, type)))
        );
    }

}

module.exports = DBManager;
