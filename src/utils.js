function twoDigits(field) {
    return `0${field}`.slice(-2);
}

function toUnixEpoch(timestamp) {
    const _d = new Date(timestamp);

    const group1 = `${_d.getFullYear()}-${twoDigits(_d.getMonth() + 1)}-${twoDigits(_d.getDay())}`;
    const group2 = `${twoDigits(_d.getHours())}:${twoDigits(_d.getMinutes())}:${twoDigits(_d.getSeconds())}`;

    return `${group1} ${group2}`;
}

module.exports = { toUnixEpoch };
