const bluebird = require('bluebird');
const redis = require('redis');
const OPSkinsAPI = require('@opskins/api');

const OPAccount = require('./OPAccount');

bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(OPSkinsAPI.prototype);

class Manager {
    constructor(settings) {
        this.appIds = settings.app_ids;
        this.opskins = new OPSkinsAPI();
        this.redis = redis.createClient(settings.redis);

        settings.accounts.forEach(async (apiKey) => {
            const account = new OPAccount(this, apiKey);
            await account.start();
        });
    }

    async getCachedPricelist() {
        const tag = '[Cache Pricelist]';
        const cachedPricelist = await this.redis.getAsync('waylaidwanderer:opskins-repricer:pricelist/v1');
        if (cachedPricelist) {
            try {
                return JSON.parse(cachedPricelist);
            } catch (err) {
                console.log(`${tag} Error parsing JSON for pricelist. Fetching new pricelist.`);
            }
        }
        const prices = {};
        const pricesPromises = [];
        this.appIds.forEach(appId => pricesPromises.push(new Promise(async (resolve, reject) => {
            try {
                const appPrices = await this.opskins.getPriceListAsync(appId);
                console.log(`${tag} Fetched new pricelist for ${appId}.`);
                Object.keys(appPrices).forEach((key) => {
                    // calculate 7 day avg price
                    const item = appPrices[key];
                    const dates = Object.keys(item).reverse();
                    let totalPrice = 0;
                    const count = Math.min(dates.length, 7);
                    for (let i = 0; i < count; i++) {
                        totalPrice += item[dates[i]].price;
                    }
                    item.price = totalPrice / count;
                    appPrices[key] = item;
                });
                prices[appId] = appPrices;
                resolve();
            } catch (err) {
                console.log(`${tag} Error caching pricelist for ${appId}: ${err}`);
                reject();
            }
        })));
        try {
            await Promise.all(pricesPromises);
        } catch (err) {
            return null;
        }
        await this.redis.setexAsync('waylaidwanderer:opskins-repricer:pricelist/v1', 6 * 60 * 60, JSON.stringify(prices));
        console.log(`${tag} Pricelist saved.`);
        return prices;
    }

    async getCachedLowestPrices() {
        const tag = '[Cache Lowest Prices]';
        const cachedLowestPrices = await this.redis.getAsync('waylaidwanderer:opskins-repricer:lowestprices/v1');
        if (cachedLowestPrices) {
            try {
                return JSON.parse(cachedLowestPrices);
            } catch (err) {
                console.log(`${tag} Error parsing JSON for lowest prices. Fetching new lowest prices.`);
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
                console.log(`${tag} Error caching lowest prices for ${appId}: ${err}`);
                reject();
            }
        })));
        try {
            await Promise.all(pricesPromises);
        } catch (err) {
            return null;
        }
        await this.redis.setexAsync('waylaidwanderer:opskins-repricer:lowestprices/v1', 30 * 60, JSON.stringify(prices));
        console.log(`${tag} Lowest prices saved.`);
        return prices;
    }
}

module.exports = Manager;
