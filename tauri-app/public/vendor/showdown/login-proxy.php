<?php
// Simple login proxy: forwards form data to official login server to avoid CORS.
// Persists upstream cookies per-browser-session so `upkeep` can keep you logged in.
// Expects same POST fields that the PS client normally sends (act, name, pass, challstr, etc.)
// Returns raw response body from upstream.

// CORS: reflect origin and allow credentials for XHR/fetch with credentials: 'include'
$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '*';
header('Access-Control-Allow-Origin: ' . $origin);
header('Vary: Origin');
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Method Not Allowed";
    exit;
}

// Maintain a server-side cookie jar per browser session so loginserver cookies persist across requests.
if (session_status() !== PHP_SESSION_ACTIVE) {
    // Secure session cookie flags and SameSite=None to allow cross-site requests with credentials
    ini_set('session.use_strict_mode', '1');
    $cookieParams = [
        'lifetime' => 0,
        'path' => '/',
        'domain' => '', // current host
        'secure' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'httponly' => true,
        'samesite' => 'None',
    ];
    if (PHP_VERSION_ID >= 70300) {
        session_set_cookie_params($cookieParams);
    } else {
        // Best effort for older PHP: cannot set samesite directly
        ini_set('session.cookie_secure', $cookieParams['secure'] ? '1' : '0');
        ini_set('session.cookie_httponly', '1');
        ini_set('session.cookie_path', '/');
        // Some hosts support appending "; SameSite=None" via ini, but it's non-standard pre-7.3
    }
    session_start();
}
$cookieJar = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'ps_loginproxy_' . session_id() . '.cookie';

$targetBase = 'https://play.pokemonshowdown.com';
$serverId = 'server-pokemondnd-xyz';
$target = $targetBase . '/~~' . rawurlencode($serverId) . '/action.php';

// Build context for POST
$postFields = $_POST; // relies on standard application/x-www-form-urlencoded form submission

// Fallback: if raw input but no parsed POST (edge case of different content-type)
if (!$postFields) {
    parse_str(file_get_contents('php://input'), $postFields);
}

$ch = curl_init($target);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($postFields));
// Set a short timeout to fail fast
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);
// Forward a user-agent for traceability
curl_setopt($ch, CURLOPT_USERAGENT, 'PS-LoginProxy/1.0 (+server-pokemondnd-xyz)');
// Persist upstream cookies in a per-session jar so that `upkeep` can find your login
curl_setopt($ch, CURLOPT_COOKIEJAR, $cookieJar);
curl_setopt($ch, CURLOPT_COOKIEFILE, $cookieJar);

$response = curl_exec($ch);
$err = curl_error($ch);
$code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);

header('Content-Type: text/plain; charset=utf-8');
if ($response === false) {
    http_response_code(502);
    echo 'Proxy error: ' . $err;
    exit;
}
// Pass through upstream status if useful (normally 200)
if ($code && $code !== 200) {
    http_response_code($code);
}
echo $response;
