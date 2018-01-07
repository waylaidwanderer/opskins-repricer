const bluebird = require('bluebird');
const OPSkinsAPI = require('@opskins/api');

bluebird.promisifyAll(OPSkinsAPI.prototype);

class OPAccount {
    constructor(manager, apiKey) {
        this.manager = manager;
        this.apiKey = apiKey;
        this.opskins = new OPSkinsAPI(apiKey);
    }

    async start() {
        await this.resumePriceEdits();
        await this.resumeListItems();
    }

    async resumeListItems() {
        const lastCheck = await this.manager.redis.get(`waylaidwanderer:opskins-repricer:${this.apiKey}:list-items:last-check`);
        let msToWait = 0;
        const checkInterval = 10 * 60 * 1000;
        if (lastCheck && Date.now() - parseInt(lastCheck) < 60 * 60 * 1000) {
            msToWait = checkInterval - (Date.now() - parseInt(lastCheck));
        }
        console.log(`Starting next OPSkins item listing in ${msToWait / 1000} seconds.`);
        setTimeout(async () => {
            setInterval(async () => {
                await this.listItems();
                await this.manager.redis.set(`waylaidwanderer:opskins-repricer:${this.apiKey}:list-items:last-check`, Date.now());
            }, checkInterval);
            if (msToWait < 60000) {
                await this.listItems();
                await this.manager.redis.set(`waylaidwanderer:opskins-repricer:${this.apiKey}:list-items:last-check`, Date.now());
            }
        }, msToWait);
    }

    async resumePriceEdits() {
        const lastCheck = await this.manager.redis.get(`waylaidwanderer:opskins-repricer:${this.apiKey}:price-edits:last-check`);
        let msToWait = 0;
        const checkInterval = 60 * 60 * 1000;
        if (lastCheck && Date.now() - parseInt(lastCheck) < 60 * 60 * 1000) {
            msToWait = checkInterval - (Date.now() - parseInt(lastCheck));
        }
        console.log(`Starting next OPSkins price edits in ${msToWait / 1000} seconds.`);
        setTimeout(async () => {
            setInterval(async () => {
                await this.repriceItems();
                await this.manager.redis.set(`waylaidwanderer:opskins-repricer:${this.apiKey}:price-edits:last-check`, Date.now());
            }, checkInterval);
            if (msToWait < 60000) {
                await this.repriceItems();
                await this.manager.redis.set(`waylaidwanderer:opskins-repricer:${this.apiKey}:price-edits:last-check`, Date.now());
            }
        }, msToWait);
    }

    async listItems() {
        const tag = `[${this.apiKey}][List Items]`;
        const inventory = (await this.opskins.getInventoryAsync()).items;
        console.log(`${tag} Inventory loaded with ${inventory.length} total items.`);
        let items;
        let pricelist;
        let lowestPrices;
        // eslint-disable-next-line no-restricted-syntax
        for (const appId of this.manager.appIds) {
            items = inventory.filter(item => item.appid === appId);
            if (items.length === 0) {
                console.log(`${tag}[${appId}] No items to list.`);
                continue;
            }
            if (!pricelist) {
                // eslint-disable-next-line no-await-in-loop
                pricelist = await this.manager.getCachedPricelist();
            }
            if (!lowestPrices) {
                // eslint-disable-next-line no-await-in-loop
                lowestPrices = await this.manager.getCachedLowestPrices();
            }
            if (!pricelist || !lowestPrices) {
                console.log(`${tag} Couldn't fetch pricelist. Aborting completely.`);
                return;
            }
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const name = item.name.trim();
                if (!(name in pricelist[item.appid])) {
                    console.log(`${tag}[${appId}] ${name} not found in pricelist.`);
                    continue;
                }
                items[i].avg_price_7_days_cents = parseInt(pricelist[item.appid][name].price);
                items[i].lowest_price = name in lowestPrices[item.appid] ? parseInt(lowestPrices[item.appid][name].price) : null;
            }
            const itemsChunked = global.chunkArray(items, 500);
            console.log(`${tag}[${appId}] ${items.length} items will be listed in ${itemsChunked.length} chunks.`);
            // eslint-disable-next-line no-restricted-syntax
            for (const itemsChunk of itemsChunked) {
                const itemsToList = {};
                // eslint-disable-next-line no-restricted-syntax
                for (const item of itemsChunk) {
                    let priceToUse = item.avg_price_7_days_cents;
                    if (!priceToUse) {
                        continue;
                    }
                    if (item.lowest_price) {
                        priceToUse = Math.max(item.avg_price_7_days_cents, item.lowest_price);
                    }
                    itemsToList[item.id.toString()] = Math.round(priceToUse * 1.1);
                }
                try {
                    // eslint-disable-next-line no-await-in-loop
                    await this.opskins.editPricesAsync(itemsToList);
                    console.log(`${tag}[${appId}] Successfully listed ${Object.keys(itemsToList).length} items on OPSkins.`);
                } catch (err) {
                    console.log(`${tag}[${appId}] Error listing ${Object.keys(itemsToList).length} items on OPSkins: ${err}`);
                }
            }
        }
    }

    async repriceItems(page = 1) {
        const lowestPrices = await this.manager.getCachedLowestPrices();
        if (!lowestPrices) return Promise.resolve();
        const tag = `[${this.apiKey}][Reprice OPSkins Listings]`;
        let totalPages;
        let listings;
        try {
            [totalPages, listings] = await this.getSalesAsync({
                page,
                type: OPSkinsAPI.SaleStatus.OnSale,
            });
        } catch (err) {
            if (err.toString() !== 'Error: No matching sales were found on your account.') {
                console.log(`${tag} Error fetching sales from OPSkins: ${err}`);
            }
            console.log(`${tag} No items to reprice at this time.`);
            return Promise.resolve();
        }
        const priceEditsArray = [];
        listings.forEach((listing) => {
            const now = Math.floor(Date.now() / 1000);
            const secondsSinceUpdate = now - listing.last_updated;
            // check if listing is older than 12 hours
            if (secondsSinceUpdate < 12 * 60 * 60) return;
            // if item has not sold for a day, lower the price regardless of the current lowest price, otherwise skip it
            if (now - listing.list_time <= 24 * 60 * 60 && (listing.name in lowestPrices[listing.appid])) {
                const currentLowestPrice = lowestPrices[listing.appid][listing.name].price;
                if (listing.price <= currentLowestPrice) return;
            }
            // reduce price by 1%
            let priceToUse = Math.round(listing.price * 0.99);
            if (priceToUse === listing.price) {
                priceToUse -= 1;
            }
            if (priceToUse === 0) return;
            priceEditsArray.push({
                id: listing.id,
                price: priceToUse,
            });
        });
        console.log(`${tag} Repricing ${priceEditsArray.length} items.`);
        const chunks = global.chunkArray(priceEditsArray, 500);
        chunks.forEach(async (chunk) => {
            const priceEdits = {};
            chunk.forEach((priceEdit) => {
                priceEdits[priceEdit.id] = priceEdit.price;
            });
            try {
                await this.opskins.editPricesAsync(priceEdits);
            } catch (err) {
                console.log(`${tag} Error editing prices for some items on OPSkins: ${err}`);
            }
        });
        if (page === totalPages) return Promise.resolve();
        return this.repriceItems(page + 1);
    }

    getSalesAsync(req) {
        return new Promise((resolve, reject) => {
            this.opskins.getSales(req, (err, totalPages, sales) => {
                if (err) return reject(err);
                return resolve([totalPages, sales]);
            });
        });
    }
}

module.exports = OPAccount;
