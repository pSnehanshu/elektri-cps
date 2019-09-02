require('dotenv').config();
const Chargepoint = require('./chargepoint');

const cp = new Chargepoint({
    serialno: '123',
});

(async function () {
    try {
        await cp.connect();
        await cp.boot();
    } catch (error) {
        console.error(error);
    }
})();
