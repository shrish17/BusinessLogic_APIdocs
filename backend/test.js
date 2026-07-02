const http = require('http');

async function testRateLimit() {
  console.log('Sending 15 rapid requests to the server...');
  for (let i = 1; i <= 15; i++) {
    http.get('http://127.0.0.1:3001/api/users', (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        console.log(`Request #${i}: HTTP Status = ${res.statusCode}`);
        if (res.statusCode === 429) {
          console.log(`Blocked Response JSON: ${data}`);
        }
      });
    });
    // Sleep 10ms to stagger requests slightly but trigger the rate limiter
    await new Promise(r => setTimeout(r, 10));
  }
}
testRateLimit();