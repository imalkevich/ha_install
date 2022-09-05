const CONFIGURATION = require('../Config.json');
const installer = require('./installer');

const installerApp = new installer.Installer(CONFIGURATION.homeAssistant, CONFIGURATION.addons);
installerApp.install();
