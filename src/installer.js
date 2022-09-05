const axios = require('axios');
const axiosRetry = require('axios-retry');
const FormData = require('form-data');
const WebSocket = require('ws');

axiosRetry(axios, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay
});

class Installer {
    constructor(haConfig, addOns) {
        this.haConfig = haConfig;
        this.addOns = addOns;

        this._websocket = null;
        this._commandId = 0;

        this._promisesById = {};
    }

    async install() {
        const access_token = await this.login();

        if (!access_token) {
            throw new Error('Failed to authenticate in Home Assistant');
        }

        this._websocket = await this.setupWebsocket(access_token);

        console.log('Connected to Home Assistant websocket');

        for (const addOn of this.addOns) {
            const installedAddOn = await this._checkAddOnInstalled(addOn.url);

            if (installedAddOn) {
                console.log(`${installedAddOn.name} from ${installedAddOn.url} is already installed`);

                const startAddon = await this._checkAddonStarted(installedAddOn.slug);

                if (!startAddon) {
                    console.error(`Failed to start add-on ${installedAddOn.name} from ${installedAddOn.url}`);
                }

                continue;
            }

            const { result: repositoriesResult } = await this._getRepositories();

            const repository = repositoriesResult?.find((r) => r.url === addOn.url);

            if (!repository) {
                console.log(`Adding add-on repository ${addOn.url} ...`);

                const { success } = await this._addRepository(addOn.url);

                if (success) {
                    console.log(`Adding add-on repository ${addOn.url} has been configured`);
                } else {
                    throw new Error(`Failed to add add-on repository ${addOn.url}`);
                }
            } else {
                console.log(`Add-on repository ${addOn.url} is already configured`);
            }

            const { result: storeResult } = await this._getStore();

            const addOnToInstall = storeResult?.addons?.find((a) => a.url?.startsWith(addOn.url));

            if (!addOnToInstall) {
                throw new Error(`Failed to find add-on from ${addOn.url}`);
            }

            console.log(`Installing add-on ${addOnToInstall.name} from ${addOnToInstall.url} ...`);

            const { success: installSuccess, error: installError } = await this._installAddon(addOnToInstall.slug);

            if (installSuccess) {
                console.log(`Add-on ${addOnToInstall.name} has been installed`);
            } else if (installError.message === '') {
                console.log(`Installation of add-on ${addOnToInstall.name} hasn't indicated success, but it might take some time for the system to update`);

                let installed = false;
                for (let attempt = 0; attempt <= 12; attempt++) {
                    console.log(`Wait for 5 sec and check add-on installation status again (attempt #${attempt + 1}) ...`);
                    await this._delay(5 * 1000);

                    const confirmAddOnInstalled = await this._checkAddOnInstalled(addOn.url);

                    if (confirmAddOnInstalled) {
                        console.success(`${confirmAddOnInstalled.name} from ${confirmAddOnInstalled.url} is installed`);

                        installed = true;
                        break;
                    }
                }

                if (installed) {
                    console.log(`Starting add-on ${installedAddOn.name}`);

                    const startAddon = await this._checkAddonStarted(installedAddOn.slug);

                    if (!startAddon) {
                        console.error(`Failed to start add-on ${installedAddOn.name} from ${installedAddOn.url}`);
                    }

                } else {
                    console.error(`Add-on ${addOnToInstall.name} from ${addOnToInstall.url} wasn't installed ...`);
                }
            } else {
                console.error(`Failed to install add-on ${addOnToInstall.name}: ${installError.message}`);
            }
        }

        console.log(`${this.addOns.length} add-on(s) processed`);
    }

    async login() {
        try {
            const { data: flowResponse } = await axios.post(`${this.haConfig.url}auth/login_flow`, {
                client_id: this.haConfig.url,
                handler: ['homeassistant', null],
                redirect_uri: `${this.haConfig.url}?auth_callback=1`
            });

            console.log(`Got auth flow_id: ${flowResponse.flow_id}`);

            const { data: flowAuthResponse } = await axios.post(`${this.haConfig.url}auth/login_flow/${flowResponse.flow_id}`, {
                client_id: this.haConfig.url,
                username: this.haConfig.username,
                password: this.haConfig.password
            });

            console.log(`Flow auth result: ${flowAuthResponse.result}`);

            const formData = new FormData();
            formData.append('client_id', this.haConfig.url);
            formData.append('code', flowAuthResponse.result);
            formData.append('grant_type', 'authorization_code');

            const { data: authTokenResponse } = await axios.post(`${this.haConfig.url}auth/token`, formData, {
                headers: formData.getHeaders()
            });

            console.log(`Auth token: ${authTokenResponse.access_token}`);

            return authTokenResponse.access_token;
        } catch (err) {
            console.log(`Error during login: ${JSON.stringify(err)}`);
        }

        return null;
    }

    async setupWebsocket(access_token) {
        console.log('Setting up websocket');
        const commandPromise = new Promise((resolve, reject) => {
            const ws = new WebSocket(this.haConfig.wsUrl);

            ws.on('open', () => {
                console.log('Websocket is opened');
            });

            ws.on('error', (err) => {
                console.log(`Websocket error occurred: ${err}`);
            });

            ws.on('message', async (data) => {
                const message = JSON.parse(data);
                const { type } = message;

                if (type === 'auth_required') {
                    console.log('Websocket authentication ...');
                    await this._sendCommand(ws, {
                        type: 'auth',
                        access_token
                    });
                } else if (type === 'auth_ok') {
                    console.log('Websocket authenticated');
                    resolve(ws);
                } else {
                    this._receiveCommand(message);
                }
            });
        });

        const websocket = await commandPromise;

        if (!websocket) {
            throw new Error('Error setting up websocket');
        }

        return websocket;
    }

    _getCommandId() {
        this._commandId += 1;

        return this._commandId;
    };

    async _sendCommand(ws, command) {
        const { id } = command;

        const commandPromise = new Promise((resolve, reject) => {
            if (id) {
                this._promisesById[id] = resolve;
            }

            ws.send(JSON.stringify(command));

            if (!id) {
                resolve(true);
            }
        });

        const result = await commandPromise;

        return result;
    }

    _receiveCommand(data) {
        const { id, type } = data;

        if (this._promisesById[id]) {
            console.debug(`Found callback handler by id: ${id}`);
            const handler = this._promisesById[id];
            this._promisesById[id] = null;
            handler(data);
        } else {
            console.debug('No callback handler found');
        }
    }

    async _checkAddOnInstalled(repository) {
        const { result: addAddonsResult } = await this._getAddOns();

        const installedAddOn = addAddonsResult?.addons?.find((a) => a.url?.startsWith(repository));

        return installedAddOn;
    }

    async _checkAddonStarted(slug) {
        const { result: addonInfoResult } = await this._getAddonInfo(slug);

        let started = false;
        if (addonInfoResult?.state !== 'started') {
            const { result: validateOptionsResult } = await this._validateAddonOptions(slug);

            if (!validateOptionsResult?.valid) {
                console.error(`Add-on options are not valid - add-on is not started ...`);

                return false;
            }

            const { success: startSuccess } = await this._startAddon(slug);

            if (!startSuccess) {
                console.log(`Failed to start add-on ...`);

                return false;
            }

            for (let attempt = 0; attempt <= 12; attempt++) {
                console.log(`Waiting for 5 sec to check add-on state (attempt #${attempt + 1}) ...`);
                await this._delay(5 * 1000);

                const { result: addonConfirmInfoResult } = await this._getAddonInfo(slug);

                if (addonConfirmInfoResult?.state === 'started') {
                    console.log(`Add-on has started`);

                    started = true;
                    break;
                } else {
                    console.warn(`Add-on is in the following state: ${addonConfirmInfoResult?.state}`);
                }
            }

            if (!started) {
                console.log(`Add-on failed to start`);
            }
        } else {
            console.log(`Add-on is already running`);

            started = true;
        }

        return started;
    }

    async _getAddOns() {
        const addOnsResult = await this._sendCommand(this._websocket, {
            id: this._getCommandId(),
            type: 'supervisor/api',
            method: 'GET',
            endpoint: '/addons'
        });

        return addOnsResult;
    }

    async _getRepositories() {
        const repositoriesResult = await this._sendCommand(this._websocket, {
            id: this._getCommandId(),
            type: 'supervisor/api',
            method: 'GET',
            endpoint: '/store/repositories'
        });

        return repositoriesResult;
    }

    async _addRepository(repository) {
        const addRepositoryResult = await this._sendCommand(this._websocket, {
            id: this._getCommandId(),
            type: 'supervisor/api',
            method: 'POST',
            endpoint: '/store/repositories',
            data: {
                repository
            }
        });

        return addRepositoryResult;
    }

    async _getStore() {
        const storeResult = await this._sendCommand(this._websocket, {
            id: this._getCommandId(),
            type: 'supervisor/api',
            method: 'GET',
            endpoint: '/store'
        });

        return storeResult;
    }

    async _installAddon(slug) {
        const installAddonResult = await this._sendCommand(this._websocket, {
            id: this._getCommandId(),
            type: 'supervisor/api',
            method: 'POST',
            endpoint: `/addons/${slug}/install`
        });

        return installAddonResult;
    }

    async _getAddonInfo(slug) {
        const addonInfoResult = await this._sendCommand(this._websocket, {
            id: this._getCommandId(),
            type: 'supervisor/api',
            method: 'GET',
            endpoint: `/addons/${slug}/info`
        });

        return addonInfoResult;
    }

    async _validateAddonOptions(slug) {
        const result = await this._sendCommand(this._websocket, {
            id: this._getCommandId(),
            type: 'supervisor/api',
            method: 'POST',
            endpoint: `/addons/${slug}/options/validate`
        });

        return result;
    }

    async _startAddon(slug) {
        const result = await this._sendCommand(this._websocket, {
            id: this._getCommandId(),
            type: 'supervisor/api',
            method: 'POST',
            endpoint: `/addons/${slug}/start`
        });

        return result;
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = {
    Installer
};