const fs = require('fs');

if (!fs.existsSync('./settings.js')) {
    console.log('settings.js is missing. Please rename settings.example.js to settings.js.');
    process.exit();
}

const settings = require('./settings');

const Manager = require('./lib/Manager');

global.chunkArray = (arr, length) => {
    const sets = [];
    const chunks = arr.length / length;
    for (let i = 0, j = 0; i < chunks; i++, j += length) {
        sets[i] = arr.slice(j, j + length);
    }
    return sets;
};

// eslint-disable-next-line no-new
new Manager(settings);
