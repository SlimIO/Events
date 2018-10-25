/**
 * @type {WeakMap<QueueMap, Map<String|Number, any[]>>}
 */
const Queues = new WeakMap();

/**
 * @class QueueMap
 */
class QueueMap {

    /**
     * @constructor
     */
    constructor() {
        Queues.set(this, new Map());
    }

    /**
     * @method enqueue
     * @param {!String|Number|Symbol} id key identifier
     * @param {*} value value to enqueue
     * @returns {void}
     */
    enqueue(id, value) {
        const q_ = Queues.get(this);
        if (q_.has(id)) {
            q_.get(id).push(value);
        }
        else {
            q_.set(id, [value]);
        }
    }

    /**
     * @method dequeue
     * @param {!String|Number|Symbol} id key identifier
     * @returns {any}
     */
    dequeue(id) {
        const q_ = Queues.get(this);
        if (!q_.has(id)) {
            return null;
        }

        const arrRef = q_.get(id);
        if (arrRef.length === 0) {
            return null;
        }

        return arrRef.shift();
    }

    /**
     * @method dequeueAll
     * @param {!String|Number|Symbol} id key identifier
     * @returns {Iterator<any>}
     */
    *dequeueAll(id) {
        const q_ = Queues.get(this);
        if (!q_.has(id)) {
            throw new Error(`Unknow queue id ${id}`);
        }

        const arrRef = q_.get(id);
        let len = arrRef.length;
        while (len--) {
            yield arrRef.shift();
        }
    }

    /**
     * @method ids
     * @returns {String[]}
     */
    ids() {
        return [...Queues.get(this).keys()];
    }

    /**
     * @method idLength
     * @param {any} id id
     * @returns {Number}
     */
    idLength(id) {
        return Queues.get(this).get(id).length;
    }

}

module.exports = QueueMap;
