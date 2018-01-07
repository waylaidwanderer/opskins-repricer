const bluebird = require('bluebird');
const redis = require('redis');
const OPSkinsAPI = require('@opskins/api');

bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(OPSkinsAPI.prototype);

class Manager {
    constructor(appIds) {
        this.appIds = appIds;
        this.opskins = new OPSkinsAPI();
        this.redis = redis.createClient();
    }

    async getCachedLowestPrices() {
        const tag = '[Cache Lowest Prices]';
        const cachedLowestPrices = await this.redis.getAsync('opskins:lowestprices/v1');
        if (cachedLowestPrices) {
            try {
                return JSON.parse(cachedLowestPrices);
            } catch (err) {
                console.log(`${tag} Error parsing JSON for lowest prices.`);
            }
        }
        const prices = {};
        const pricesPromises = [];
        this.appIds.forEach(appId => pricesPromises.push(new Promise(async (resolve ,reject) => {
            try {
                prices[appId] = await this.opskins.getLowestPricesAsync(appId);
                console.log(`${tag} Fetched new lowest prices for ${appId}.`);
                resolve();
            } catch (err) {
                console.log(`${tag} Error caching lowest prices for ${appId}: ${err.toString()}`);
                reject();
            }
        })));
        await Promise.all(pricesPromises);
        await this.redis.setexAsync('opskins:lowestprices/v1', 30 * 60, JSON.stringify(prices));
        console.log(`${tag} Lowest prices saved.`);
        return prices;
    }
}

module.exports = Manager;
