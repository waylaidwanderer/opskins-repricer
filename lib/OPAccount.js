const bluebird = require('bluebird');
const OPSkinsAPI = require('@opskins/api');

bluebird.promisifyAll(OPSkinsAPI.prototype);

class OPAccount {
    constructor(redis, apiKey) {
        this.redis = redis;
        this.opskins = new OPSkinsAPI(apiKey);
    }
}

module.exports = OPAccount;
