const CONFIGURATION = require('../Config.json');
const discovery = require('./discovery');
const installer = require('./installer');

class Orchestrator {
    constructor() {

    }

    async install() {
        // Check Home Assistant exists and listening on some port
        const homeAssistantDiscoveryApp = new discovery.Discovery(CONFIGURATION.discovery.homeAssistant);
        const haResult = await homeAssistantDiscoveryApp.discover();

        if (!haResult) {
            throw new Error('No Home Assistant found, please before proceeding install it following the url https://www.home-assistant.io/installation/');
        }

        console.log(`Home Assistant has been detected: ${JSON.stringify(haResult)}`);

        const haConfig = {
            url: haResult.appUrl + '/', // add leading / as it is important for authentication
            wsUrl: `ws://${haResult.ip}:${haResult.port}/api/websocket`,
            ...CONFIGURATION.homeAssistant
        };

        // Install add-on 
        // CONFIGURATION.addons
        const installerApp = new installer.Installer(haConfig);
        const adminUiInstallResult = await installerApp.install();

        if (!adminUiInstallResult.success) {
            throw new Error(`Failed to install Admin UI add-on - ${adminUiInstallResult.message}`);
        }

        // Figure out app url for Admin UI
        const adminUiDiscoveryApp = new discovery.Discovery(CONFIGURATION.discovery.adminUi);
        const adminUiResult = await adminUiDiscoveryApp.discover();

        if (!adminUiResult) {
            throw new Error(`Admin UI hasn't been installed or started properly, please contact support to get the issue resolved`);
        }

        console.log(`Admin UI has been detected: ${JSON.stringify(adminUiResult)}`);

        return {
            haConfig,
            adminUi: adminUiResult
        };
    }
}

module.exports = {
    Orchestrator
};