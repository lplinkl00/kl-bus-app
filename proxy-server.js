/**
 * CORS Anywhere Proxy Server
 * 
 * This server acts as a proxy to add CORS headers to requests,
 * allowing the frontend to make requests to APIs that don't support CORS.
 * 
 * Usage:
 *   npm run proxy
 * 
 * The server will run on http://localhost:8080
 * 
 * To use it, prefix your API URL with: http://localhost:8080/
 * Example: http://localhost:8080/https://maps.googleapis.com/maps/api/directions/json?...
 */

const cors_proxy = require('cors-anywhere');

// Listen on a specific host via the HOST environment variable
const host = process.env.HOST || '0.0.0.0';
// Listen on a specific port via the PORT environment variable
const port = process.env.PORT || 8080;

cors_proxy.createServer({
  originWhitelist: [], // Allow all origins
  requireHeader: ['origin', 'x-requested-with'],
  removeHeaders: ['cookie', 'cookie2'],
  // Optional: Add rate limiting
  // checkRateLimit: (origin) => {
  //   // Implement your rate limiting logic here
  //   return null; // Allow request
  // },
}).listen(port, host, function() {
  console.log('Running CORS Anywhere on ' + host + ':' + port);
  console.log('');
  console.log('To use the proxy, prefix your API URL with:');
  console.log('  http://localhost:' + port + '/');
  console.log('');
  console.log('Example:');
  console.log('  http://localhost:' + port + '/https://maps.googleapis.com/maps/api/directions/json?...');
  console.log('');
  console.log('Press Ctrl+C to stop the server.');
});

