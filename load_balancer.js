const express = require('express');
const { fork } = require('child_process');
const os = require('os');
const path = require('path');
const http = require('http');

const app = express();

const servers = [];
const serverStatus = new Map(); // Map to track server status (true: busy, false: idle)

// Function to start a new server instance
function startServer(port) {
    const serverProcess = fork(path.join(__dirname, 'server.js'), [port.toString()]); // Correct path to server.js
    serverProcess.port = port;
    servers.push(serverProcess);
    serverStatus.set(port, false); // Mark the server as idle initially
    console.log(`Server started on port ${port}`);
}

// Function to stop a server instance
function stopServer(serverProcess) {
    const index = servers.indexOf(serverProcess);
    if (index !== -1) {
        serverProcess.kill();
        const port = serverProcess.port;
        servers.splice(index, 1);
        serverStatus.delete(port);
        console.log(`Server stopped on port ${port}`);
    }
}

// Function to scale servers based on CPU usage and server status
function scaleServers() {
    const cpus = os.cpus().length;

    // Count the number of busy servers
    const busyServers = Array.from(serverStatus.values()).filter(status => status).length;

    // Start a new server if all servers are busy and the number of servers is less than CPU cores
    if (busyServers === servers.length && servers.length < cpus) {
        const port = 5000 + servers.length;
        startServer(port);
    }

    // Stop idle servers to free up resources, but ensure at least one server remains
    servers.forEach(serverProcess => {
        const port = serverProcess.port;
        if (!serverStatus.get(port) && servers.length > 1) { // Check if there's more than one server instance
            stopServer(serverProcess);
        }
    });
}

// Middleware to handle requests
app.use((req, res) => {
    // Find an idle server or start a new server if all servers are busy
    const idleServer = Array.from(serverStatus.keys()).find(port => !serverStatus.get(port));
    
    if (idleServer) {
        serverStatus.set(idleServer, true); // Mark the server as busy
        const { method, url, headers, body } = req;
        const options = {
            hostname: 'localhost',
            port: idleServer,
            path: url,
            method: method,
            headers: headers
        };

        const proxyReq = http.request(options, proxyRes => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res, { end: true });
            serverStatus.set(idleServer, false); // Mark the server as idle after request completion
        });

        req.pipe(proxyReq, { end: true });
    } else {
        res.status(500).send('No servers available.');
    }
});

// Start initial server instance
const INITIAL_PORT = 5000;
startServer(INITIAL_PORT);

// Start load balancer
const PORT = 8080;
app.listen(PORT, () => {
    console.log(`Load balancer running on port ${PORT}`);
});

// Start periodical check for server status and scale servers
setInterval(scaleServers, 5000); // Adjust the interval as needed
