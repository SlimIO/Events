// Require Node.JS Dependencies
const { mkdir } = require("fs").promises;

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

module.exports = {
    createDir
};
