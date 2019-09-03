require('dotenv').config();
const Chargepoint = require('./chargepoint');

const cp = new Chargepoint({
    serialno: process.env.SERIALNO,
    brand: process.env.BRAND,
    model: process.env.MODEL,
});

(async function () {
    try {
        await connect();
    } catch (error) {
        console.error(error);
    }
})();

async function connect() {
    try {
        await cp.connect();
        return await cp.boot();
    } catch (error) {
        console.error(error);
        setTimeout(connect, 5000);
    }
}
