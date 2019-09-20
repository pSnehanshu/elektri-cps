require('dotenv').config();
const Chargepoint = require('./chargepoint');
const connectors = require(process.env.CONNECTORS_FILE);

const cp = new Chargepoint({
    serialno: process.env.SERIALNO,
    brand: process.env.BRAND,
    model: process.env.MODEL,
});

var meterValuesInterval = 0;

// Handling RemoteStartTransaction
cp.on('RemoteStartTransaction', async function (msg, res) {
    try {
        var { connectorId, idTag } = msg;
        console.log(msg);
        res.success({
            status: 'Accepted',
        });

        // set to preparing
        //var data = await cp.setStatus('Available', connectorId);

        var data = await cp.send('Authorize', { idTag });
        if (data.idTagInfo.status == 'Accepted') {
            // set to preparing
            //var data = await cp.setStatus('Occupied', connectorId);

            console.log(connectorId, idTag);

            var data = await cp.send('StartTransaction', {
                connectorId, idTag,
                meterStart: 0,
                timestamp: new Date,
            });

            if (data.idTagInfo.status == 'Accepted') {
                console.log(`StartTransaction was accepted by backend. txId ${data.transactionId}`);
                
                // Should send meter values periodically
                var value = 0;
                meterValuesInterval = setInterval(() => {
                    cp.send('MeterValues', {
                        connectorId,
                        transactionId: data.transactionId,
                        meterValue: [
                            {
                                timestamp: new Date,
                                sampledValue: [
                                    {
                                        value: (value + 10).toString(),
                                        context: 'Sample.Periodic',
                                        format: 'Raw',
                                        measurand: 'Energy.Active.Import.Register',
                                        location: 'Outlet',
                                        unit: 'Wh',
                                    },
                                ],
                            }
                        ],
                    }).then(() => {}).catch(() => {}); // Nothing to do
                }, 60000);
            } else {
                console.error(`StartTransaction was NOT accepted by backend. txId ${data.transactionId}`);
            }
        }
    } catch (error) {
        console.error(error);
    }
});

cp.on('RemoteStopTransaction', async function (msg, res) {
    try {
        var { transactionId } = msg;
        res.success({
            status: 'Accepted',
        });

        var data = await cp.send('StopTransaction', {
            meterStop: 12,
            timestamp: new Date,
            transactionId,
            reason: 'Remote',
        });

        if (data.idTagInfo.status == 'Accepted') {
            console.log(`StopTransaction was accepted by backend. txId ${transactionId}`);
            clearInterval(meterValuesInterval);
        } else {
            console.error(`StopTransaction was NOT accepted by backend. txId ${transactionId}`);
        }
    } catch (error) {
        console.error(error);
    }
});

// Reservation logic
cp.on('ReserveNow', function (msg, res) {
    console.log('Reservation created. ID: ', msg.reservationId);

    // Logic to record reservation

    res.success({
        status: 'Accepted',
    });
});

cp.on('CancelReservation', function (msg, res) {
    console.log('Reservation cancelled. ID: ', msg.reservationId);

    // Logic to verify reservation

    res.success({
        status: 'Accepted',
    });
});

// Configurations
cp.on('ChangeConfiguration', function (msg, res) {
    res.success({
        status: 'Accepted',
    });
});
cp.on('GetConfiguration', function (msg, res) {
    var keys = msg.key;
    var responseKeys = keys.map(k => ({ key: k, readonly: false, value: 'dummy_value' }));
    res.success({
        configurationKey: responseKeys,
        unknownKey: [],
    });
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
