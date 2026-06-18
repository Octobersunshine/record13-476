const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const HOST = 'localhost';

function readPackageJson() {
  const packagePath = path.join(__dirname, 'package.json');
  try {
    const rawData = fs.readFileSync(packagePath, 'utf8');
    return JSON.parse(rawData);
  } catch (error) {
    return null;
  }
}

function formatDependencies(deps, type) {
  if (!deps) return [];
  return Object.entries(deps).map(([name, version]) => ({
    name,
    version,
    type
  }));
}

function sendResponse(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data, null, 2));
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    sendResponse(res, 204, {});
    return;
  }

  if (req.method !== 'GET') {
    sendResponse(res, 405, { error: 'Method Not Allowed', message: 'Only GET requests are supported' });
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  const packageData = readPackageJson();
  if (!packageData) {
    sendResponse(res, 500, { error: 'Internal Server Error', message: 'Failed to read package.json' });
    return;
  }

  switch (pathname) {
    case '/api/dependencies':
    case '/api/deps': {
      const dependencies = formatDependencies(packageData.dependencies, 'dependencies');
      const devDependencies = formatDependencies(packageData.devDependencies, 'devDependencies');
      const peerDependencies = formatDependencies(packageData.peerDependencies, 'peerDependencies');
      const optionalDependencies = formatDependencies(packageData.optionalDependencies, 'optionalDependencies');

      const allDependencies = [
        ...dependencies,
        ...devDependencies,
        ...peerDependencies,
        ...optionalDependencies
      ];

      sendResponse(res, 200, {
        project: {
          name: packageData.name,
          version: packageData.version,
          description: packageData.description
        },
        summary: {
          total: allDependencies.length,
          dependencies: dependencies.length,
          devDependencies: devDependencies.length,
          peerDependencies: peerDependencies.length,
          optionalDependencies: optionalDependencies.length
        },
        dependencies: allDependencies
      });
      break;
    }

    case '/api/dependencies/prod':
    case '/api/deps/prod': {
      const dependencies = formatDependencies(packageData.dependencies, 'dependencies');
      sendResponse(res, 200, {
        type: 'dependencies',
        count: dependencies.length,
        packages: dependencies
      });
      break;
    }

    case '/api/dependencies/dev':
    case '/api/deps/dev': {
      const devDependencies = formatDependencies(packageData.devDependencies, 'devDependencies');
      sendResponse(res, 200, {
        type: 'devDependencies',
        count: devDependencies.length,
        packages: devDependencies
      });
      break;
    }

    case '/health':
    case '/': {
      sendResponse(res, 200, {
        status: 'ok',
        service: 'package-dependency-api',
        version: packageData.version || '1.0.0',
        endpoints: {
          'GET /api/dependencies': 'List all dependencies (all types)',
          'GET /api/deps': 'Alias for /api/dependencies',
          'GET /api/dependencies/prod': 'List only production dependencies',
          'GET /api/deps/prod': 'Alias for /api/dependencies/prod',
          'GET /api/dependencies/dev': 'List only development dependencies',
          'GET /api/deps/dev': 'Alias for /api/dependencies/dev',
          'GET /health': 'Health check endpoint'
        }
      });
      break;
    }

    default: {
      sendResponse(res, 404, {
        error: 'Not Found',
        message: `Endpoint ${pathname} does not exist`,
        availableEndpoints: [
          '/',
          '/health',
          '/api/dependencies',
          '/api/dependencies/prod',
          '/api/dependencies/dev'
        ]
      });
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log('========================================');
  console.log('  Package Dependency API Server');
  console.log('========================================');
  console.log(`  Server running at: http://${HOST}:${PORT}`);
  console.log('');
  console.log('  Available endpoints:');
  console.log('  GET /                           - API info');
  console.log('  GET /health                     - Health check');
  console.log('  GET /api/dependencies           - All dependencies');
  console.log('  GET /api/dependencies/prod      - Production dependencies only');
  console.log('  GET /api/dependencies/dev       - Development dependencies only');
  console.log('========================================');
  console.log('  Press Ctrl+C to stop the server');
  console.log('========================================');
});
