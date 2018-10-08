// Require SlimIO.is
const is = require("@slimio/is");

function assertEntity(entity) {
    if (!is.plainObject(entity)) {
        throw new TypeError("entity should be a plainObject!");
    }
    if (!is.string(entity.name)) {
        throw new TypeError("entity.name property should be typeof string");
    }
    if (!is.nullOrUndefined(entity.description) && !is.string(entity.description)) {
        throw new TypeError("entity.description property should be typeof string");
    }
    if (!is.nullOrUndefined(entity.parent) && !is.number(entity.parent)) {
        throw new TypeError("entity.parent property should be typeof number");
    }
    if (!is.nullOrUndefined(entity.descriptors) && !is.plainObject(entity.descriptors)) {
        throw new TypeError("entity.descriptors should be a plainObject!");
    }
}

function assertMIC(mic) {
    if (!is.plainObject(mic)) {
        throw new TypeError("mic should be a plainObject!");
    }
    if (!is.string(mic.name)) {
        throw new TypeError("mic.name property should be typeof string");
    }
    if (!is.number(mic.entity_id)) {
        throw new TypeError("mic.entity_id property should be typeof number");
    }
    if (!is.nullOrUndefined(mic.description) && !is.string(mic.description)) {
        throw new TypeError("mic.description property should be typeof string");
    }
}

module.exports = {
    assertEntity,
    assertMIC
};
