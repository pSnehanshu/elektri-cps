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

        // Handling RemoteStartTransaction
        cp.on('RemoteStartTransaction', async function (msg, res) {
            try {
                var { connectorId, idTag } = msg;
                res.success({
                    status: 'Accepted',
                });

                // set to preparing
                var data = await cp.setStatus('Available', connectorId);

                var data = await cp.send('Authorize', { idTag });
                if (data.idTagInfo.status == 'Accepted') {
                    // set to preparing
                    var data = await cp.setStatus('Occupied', connectorId);

                    var data = await cp.send('StartTransaction', {
                        connectorId, idTag,
                        meterStart: 0,
                        timestamp: new Date,
                    });

                    if (data.idTagInfo.status == 'Accepted') {
                        console.log(`StartTransaction was accepted by backend. txId ${data.transactionId}`);
                    } else {
                        console.error('StartTransaction was NOT accepted by backend');
                    }
                }
            } catch (error) {
                console.error(error);
            }
        });

        // Set status notification
        connectors.forEach((connector, i) => {
            cp.send('StatusNotification', {
                connectorId: i + 1,
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
