const shortid = require('shortid');
const WebSocketClient = require('websocket').client;

class ChargePoint {
    constructor(cpfile = {}) {
        this.callResultHandlers = {};
        this.callHandlers = {};

        this.uids = [];
        this.sessions = [];

        if (cpfile.serialno) {
            this.serialno = cpfile.serialno;
        }

        // Parameters of the cp
        this.params = cpfile.params || {};

        // Whether the cp has been accepted by the beackend. Can be set by sending BootNotification
        this.accepted = false;

        // The status of the cp. Available/Occupied
        this.status = 'Available';

        // Setting meter value (wh)
        this.meterValue = cpfile.meterValue || 0;

        // Setting brand and model
        this.brand = cpfile.brand;
        this.model = cpfile.model;
    }

    getParam(param) {
        return this.params[param];
    }
    setParam(param, val) {
        if (param) {
            this.params[param] = val;
        }
        return val;
    }

    connect(reconnect = false) {
        return new Promise((resolve, reject) => {
            console.log('Trying to connect...');

            //var key = Buffer.from(process.env.KEY, 'hex').toString();
            //var basicAuth = Buffer.from(`${this.serialno}:${key}`).toString('base64');
            var url = `${process.env.BACKENDURL}/${this.serialno}`;

            this.client = new WebSocketClient();
            this.client.connect(url, 'ocpp1.6', null, {
                //Authorization: `Basic ${basicAuth}`,
            });

            this.client.on('connectFailed', async (error) => {
                console.error('Connection Error: ' + error.toString());
                reject(error);

                if (reconnect) {
                    console.error(`Unable to connect to backend. Will retry after ${reconnect}s`)
                    setTimeout(() => {
                        // Reconnecting
                        this.connect(reconnect)
                            .then(() => resolve())
                            .catch(err => console.error('Unable to connect to backend. Retrying...'));
                    }, reconnect * 1000);
                }
            });

            this.client.on('connect', connection => {
                console.log(`CP #${this.serialno} has successfuly connected to the backend`);

                this.connection = connection;

                connection.on('error', (error) => {
                    console.error("Connection Error: " + error.toString());
                });
                connection.on('close', async () => {
                    console.error('Websocket Connection Closed');
                    this.connection = null;
                    try {
                        await this.connect(5);
                        await this.boot();
                    } catch (error) {
                        console.error('Unable to connect to backend. Retrying...');
                    }
                });
                connection.on('message', (message) => {
                    const msg = JSON.parse(message.utf8Data);
                    const type = msg[0];
                    const id = msg[1];

                    console.log('Received a msg', msg);

                    // Look for handlers to handle the message
                    if (type == 2) { // This is a CALL message
                        const action = msg[2];
                        const fn = this.callHandlers[action];

                        // Check if handlers are registered for the call
                        if (typeof fn == 'function') {
                            fn(msg[3], this.callRespond(msg));
                        }
                    } else { // This is either a CALLRESULT or a CALLERROR message
                        // Check if callbacks are registered for the response
                        if (this.callResultHandlers[id]) {
                            if (!Array.isArray(this.callResultHandlers[id])) {
                                this.callResultHandlers[id] = [this.callResultHandlers[id]];
                            }
                            this.callResultHandlers[id].forEach(handlers => {
                                // Get the correct handler based on the message type
                                let cb = null; // This message may be invalid (Neither CALLRESULT nor CALLERROR)
                                let args = msg;

                                if (type == 3) { // CALLRESULT
                                    cb = handlers.success;
                                    args = msg[2]; // Only passing the payload
                                } else if (type == 4) { // CALLERROR
                                    cb = handlers.error;
                                    args = {
                                        code: msg[2],
                                        message: msg[3],
                                        info: msg[4],
                                    };
                                }

                                typeof cb == 'function' && cb(args);
                            });

                            // After all response handled, removed the handlers
                            delete this.callResultHandlers[id];
                        }
                    }
                });
                resolve();
            });
        });
    }

    send(action = 'Heartbeat', payload = {}) {
        return new Promise((resolve, reject) => {
            if (!this.connection) {
                return reject('Connection with the backend has not yet been established.\nPlease connect to the backend first.');
            }
            /*if (!this.accepted && action != 'BootNotification') {
                return reject('Charge-point has not yet been accepted by the backend.\nPlease send BootNotification first and then retry.');
            }*/
            const msgTypeId = 2;
            const uniqueId = 'msg_' + shortid.generate();
            const msg = JSON.stringify([msgTypeId, uniqueId, action, payload]);

            this.connection.sendUTF(msg);
            console.log('Sent a msg', msg);
            this.registerCall(uniqueId, resolve);
        });
    }

    callRespond(msg) {
        const self = this;

        function respond() {
            this.success = function (payload = {}) {
                if (!self.connection) {
                    return self.io.cps_emit('err', 'Connection with the backend has not yet been established.\nPlease connect to the backend first.');
                }

                var response = JSON.stringify([3, msg[1], payload]);
                self.connection.sendUTF(response);
                console.log('Sent a message', response);
            }

            this.error = function () {

            }
        }

        return new respond;
    }

    // Handle Calls
    on(action, cb) {
        // Finally add the callback
        this.callHandlers[action] = cb;
    }

    registerCall(id, cb, err_cb) {
        // Create entry if new ID
        if (!this.callResultHandlers[id]) {
            this.callResultHandlers[id] = [];
        }
        // Check if it is array, if not make it one
        if (!Array.isArray(this.callResultHandlers[id])) {
            this.callResultHandlers[id] = [this.callResultHandlers[id]];
        }

        // Finally push the callback
        this.callResultHandlers[id].push({
            success: cb,
            error: err_cb,
        });
    }

    async boot() {
        try {
            var retry = 10000;
            console.log('Sending BootNotification...');

            var data = await this.send('BootNotification', {
                chargePointModel: this.model,
                chargePointVendor: this.brand,
            });

            if (data.status == 'Accepted') {
                this.accepted = true;
                console.log('Charge point has been accepted');
                this.startHeartbeat(parseFloat(data.interval || 90) * 1000);
            }
            else if (data.status == 'Rejected') {
                this.accepted = false;
                retry = parseFloat(data.interval || (retry / 1000)) * 1000;
                console.error(`Charge-point has been rejected by the backend.\nRetying after ${retry / 1000}s...`);
                setTimeout(() => this.boot(), retry);
            }
        } catch (err) {
            console.error(err);
            console.log(`Will resend BootNotification after ${retry / 1000}s...`);
            this.accepted = false;
            setTimeout(() => this.boot(), retry);
        };
    }

    /**
     * Send heartbeat and possibily continue sending afterwards
     * @param {Number} resendAfter Miliseconds after which resend another heartbeat request. -1 for no resend.
     */
    async startHeartbeat(resendAfter = -1) {
        try {
            var msg = await this.send('Heartbeat');
            if (resendAfter >= 0) {
                setTimeout(() => this.startHeartbeat(resendAfter), resendAfter);
            }
        } catch (err) {
            console.error(err);
        }
    }

    setStatus(status, connectorId = 0) {
        return new Promise((resolve, reject) => {
            this.status = status;
            this.send('StatusNotification', {
                connectorId,
                errorCode: 'NoError',
                status,
            }).then(msg => {
                console.error(`CP status has been set to ${this.status}`)
                resolve();
            }).catch(err => reject(err));
        });
    }
}

module.exports = ChargePoint;
