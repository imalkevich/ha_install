# ha_install
HA automated add-on installation

What this application is doing:
1. Tries to find running Home Assistant installation in local network
1. Tries to install Home Assistant add-on
1. Tries to discover installed Home Assistant add-on

If there is something wrong detected along the way - the process should throw an unhandled exception with the details.

Upon successful completion the application will return Home Assistant add-on application url, which later can be used to create Long Lived Access Token in Home Assistant.

**IMPORTANT** `addonUrl` in `Config.json` should be replaced with the Admin UI once we have Admin UI repository set up.
