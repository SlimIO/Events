/**
 * @function twoDigits
 * @param {number | string} field field
 * @returns {string}
 */
export function twoDigits(field) {
    return `0${field}`.slice(-2);
}

/**
 * @function toUnixEpoch
 * @param {!number} timestamp
 * @returns {string}
 */
export function toUnixEpoch(timestamp) {
    const _d = new Date(timestamp);

    const group1 = `${_d.getFullYear()}-${twoDigits(_d.getMonth() + 1)}-${twoDigits(_d.getUTCDate())}`;
    const group2 = `${twoDigits(_d.getHours())}:${twoDigits(_d.getMinutes())}:${twoDigits(_d.getSeconds())}`;

    return `${group1} ${group2}`;
}
