/** @type {import('../play.pokemonshowdown.com/src/client-main').PSConfig} */
var Config = Config || {};

/* version */ Config.version = "0";

Config.bannedHosts = ['cool.jit.su', 'pokeball-nixonserver.rhcloud.com'];

Config.whitelist = [
	'wikipedia.org'

	// The full list is maintained outside of this repository so changes to it
	// don't clutter the commit log. Feel free to copy our list for your own
	// purposes; it's here: https://play.pokemonshowdown.com/config/config.js

	// If you would like to change our list, simply message Zarel on Smogon or
	// Discord.
];

// `defaultserver` specifies the server to use when the domain name in the
// address bar is `Config.routes.client`.
Config.defaultserver = {
 id: 'server-pokemondnd-xyz',
 protocol: 'https',
 host: 'server.pokemondnd.xyz',
 port: 443,
 httpport: 443,
 altport: 0,
 prefix: '/showdown',
 registered: false
};

Config.roomsFirstOpenScript = function () {
};

Config.customcolors = {
	'zarel': 'aeo'
};
/*** Begin automatically generated configuration ***/
Config.version = "0.11.4 (static-www)";

Config.routes = {
	root: 'server.pokemondnd.xyz',
	client: 'server.pokemondnd.xyz',
	dex: 'dex.pokemonshowdown.com',
	replays: 'replay.pokemonshowdown.com',
	users: 'pokemonshowdown.com/users',
	teams: 'teams.pokemonshowdown.com',
};
/*** End automatically generated configuration ***/

// --- Custom overrides for deployment ---
// Point login queries (action.php) at the official login server so we don't need a local action.php
// and avoid 405 errors from https://www.pokemondnd.xyz/~~server-pokemondnd-xyz/action.php
// We use the server's own id so challstr/auth flow remains consistent with our custom server.
Config.loginserver = 'play.pokemonshowdown.com';
Config.loginserverid = 'server-pokemondnd-xyz';
// Ensure explicit server definition (harmless when client route matches)
Config.server = Config.defaultserver;
// Use the server host as login proxy endpoint (works even if www is static-only)
// If you later proxy this path on www, you can switch to a same-origin '/login-proxy'.
Config.loginProxy = 'https://server.pokemondnd.xyz/login-proxy';
// Force resource/sprite host to www (static asset domain) so images don't request from battle server
Config.resourceprefix = 'https://www.pokemondnd.xyz/';
// Some UI elements use Dex.fxPrefix for tiny icons (gender etc); ensure it aligns
Config.fxprefix = Config.resourceprefix + 'fx/';
// Override routes.client AFTER autogen so Dex.resourcePrefix picks up the www host for static assets
// Keep server connection pointing to battle host via Config.server
if (Config.routes) {
	// Keep static assets (Dex.resourcePrefix) on www; server connection uses Config.server above
	Config.routes.client = 'www.pokemondnd.xyz';
	Config.routes.root = 'www.pokemondnd.xyz';
}
