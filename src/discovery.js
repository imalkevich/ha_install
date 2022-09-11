const axios = require('axios');
const axiosRetry = require('axios-retry');
const find = require('local-devices');
const https = require('https');

axiosRetry(axios, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay
});

class Discovery {
    constructor(discoveryConfiguration) {
        this._discoveryConfiguration = discoveryConfiguration;
    }

    async discover() {
        const discoverPromise = new Promise((resolve, reject) => {
            find().then(async (devices) => {
                let discoveryInfo = null;

                for (const device of [...devices, {name: 'test', ip: '83.96.25.123'}, {name: 'test', ip: '83.96.25.124'}]) {
                    const { name, ip } = device;
                    const appUrl = `${this._discoveryConfiguration.protocol}//${ip}:${this._discoveryConfiguration.port}${this._discoveryConfiguration.path}`;
                    console.log(`Scanning ${name} - IP ${ip}, url - ${appUrl}`);

                    try {
                        const { data: discoveryResponse } = await axios.get(appUrl, {
                            headers: {
                                'Accept': 'application/json'
                            },
                            timeout: 5 * 1000,
                            httpsAgent: new https.Agent({
                                rejectUnauthorized: false
                            })
                        });

                        console.info(`Software is detected on IP ${ip} - ${JSON.stringify(discoveryResponse)}`);
                        discoveryInfo = {
                            name, 
                            ip,
                            port: this._discoveryConfiguration.port,
                            appUrl: `${this._discoveryConfiguration.protocol}//${ip}:${this._discoveryConfiguration.port}`
                        };
                        break;
                    } catch(error) {
                        const { response, message } = error;
                        console.warn(`No software is detected on IP ${ip} - response: ${JSON.stringify(response)} (${message})`);
                    }
                }

                resolve(discoveryInfo);
            });
        });

        const result = await discoverPromise;

        return result;
    }
}

module.exports = {
    Discovery
};