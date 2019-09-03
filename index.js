require('dotenv').config();
const Chargepoint = require('./chargepoint');
const connectors = require(process.env.CONNECTORS_FILE);

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
        await cp.boot();

        // Set status notification
        connectors.forEach((connector, i) => {
            cp.send('StatusNotification', {
                connectorId: i+1,
                errorCode: 'NoError',
                status: 'Available',
                info: JSON.stringify({
                    level: connector.level,
                    type: connector.type,
                    throughput: connector.throughput,
                    ctype: connector.ctype,
                }),
            }).then(msg => {
                console.log('StatusNotification successful', msg);
            }).catch(err => {
                console.error('StatusNotification error:', err.message);
            });
        });

    } catch (error) {
        console.error(error);
        setTimeout(connect, 5000);
    }
}
