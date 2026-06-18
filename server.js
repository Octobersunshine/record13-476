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

function stripVersionPrefix(version) {
  if (!version) return version;
  return version.replace(/^[\^~>=<]*/, '');
}

function parseVersion(versionStr) {
  const cleaned = stripVersionPrefix(versionStr);
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null,
    build: match[5] || null,
    raw: cleaned
  };
}

function comparePrerelease(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const aParts = a.split('.');
  const bParts = b.split('.');
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const aPart = aParts[i];
    const bPart = bParts[i];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    const aIsNum = /^\d+$/.test(aPart);
    const bIsNum = /^\d+$/.test(bPart);
    if (aIsNum && bIsNum) {
      const aNum = parseInt(aPart, 10);
      const bNum = parseInt(bPart, 10);
      if (aNum !== bNum) return aNum - bNum;
    } else if (aIsNum) {
      return -1;
    } else if (bIsNum) {
      return 1;
    } else {
      if (aPart < bPart) return -1;
      if (aPart > bPart) return 1;
    }
  }
  return 0;
}

function compareVersions(a, b) {
  const verA = parseVersion(a);
  const verB = parseVersion(b);
  if (!verA || !verB) return 0;
  if (verA.major !== verB.major) return verA.major - verB.major;
  if (verA.minor !== verB.minor) return verA.minor - verB.minor;
  if (verA.patch !== verB.patch) return verA.patch - verB.patch;
  return comparePrerelease(verA.prerelease, verB.prerelease);
}

function getHighestVersion(versions) {
  if (!versions || versions.length === 0) return null;
  return versions.reduce((highest, current) => {
    return compareVersions(current, highest) > 0 ? current : highest;
  }, versions[0]);
}

function getLowestVersion(versions) {
  if (!versions || versions.length === 0) return null;
  return versions.reduce((lowest, current) => {
    return compareVersions(current, lowest) < 0 ? current : lowest;
  }, versions[0]);
}

function generateFixRecommendation(conflict, strippedVersions) {
  const highest = getHighestVersion(strippedVersions);
  const lowest = getLowestVersion(strippedVersions);
  const entries = conflict.entries;

  const prodEntry = entries.find(e => e.type === 'dependencies');
  const devEntry = entries.find(e => e.type === 'devDependencies');
  const peerEntry = entries.find(e => e.type === 'peerDependencies');

  const highestEntry = entries.find(e => stripVersionPrefix(e.version) === highest);
  const prodVersion = prodEntry ? stripVersionPrefix(prodEntry.version) : null;

  let strategy, reason, recommendedVersion, affectedTypes, impact;

  if (prodEntry && devEntry) {
    const prodStripped = stripVersionPrefix(prodEntry.version);
    const devStripped = stripVersionPrefix(devEntry.version);
    const prodHigher = compareVersions(prodStripped, devStripped) > 0;

    recommendedVersion = highest;
    affectedTypes = ['dependencies', 'devDependencies'];
    strategy = 'unify_to_highest';
    reason = prodHigher
      ? '生产依赖版本更高，建议将开发依赖同步升级到生产版本以保持一致'
      : '开发依赖版本更高，建议评估后将生产依赖升级或降级开发依赖以匹配生产环境';
    impact = prodHigher
      ? '低风险：仅开发环境升级，不影响生产运行'
      : '中风险：生产环境升级需进行兼容性测试';
  } else if (prodEntry && peerEntry) {
    recommendedVersion = highest;
    affectedTypes = ['dependencies', 'peerDependencies'];
    strategy = 'unify_to_highest';
    reason = '生产依赖与对等依赖版本冲突，建议统一到更高版本';
    impact = '高风险：对等依赖变更可能影响宿主环境兼容性，需谨慎评估';
  } else if (devEntry && peerEntry) {
    recommendedVersion = highest;
    affectedTypes = ['devDependencies', 'peerDependencies'];
    strategy = 'unify_to_highest';
    reason = '开发依赖与对等依赖版本冲突，建议统一到更高版本';
    impact = '中风险：对等依赖变更需验证宿主环境兼容性';
  } else {
    recommendedVersion = highest;
    affectedTypes = entries.map(e => e.type);
    strategy = 'unify_to_highest';
    reason = '多类型依赖版本冲突，建议统一到最新版本';
    impact = '中风险：版本跨度较大时需全面测试';
  }

  const alternatives = [];

  if (lowest !== highest) {
    alternatives.push({
      strategy: 'unify_to_lowest',
      recommendedVersion: lowest,
      reason: '降级到最低版本，避免兼容性问题',
      impact: '低风险：可能错过新版本的功能和修复'
    });
  }

  if (prodVersion && prodVersion !== highest) {
    alternatives.push({
      strategy: 'keep_production',
      recommendedVersion: prodVersion,
      reason: '以生产环境版本为准，其他环境同步',
      impact: '低风险：确保生产环境稳定性优先'
    });
  }

  alternatives.push({
    strategy: 'keep_both',
    recommendedVersion: null,
    reason: '如果确实需要不同版本（如测试兼容性），可保留当前状态',
    impact: '潜在风险：可能导致依赖解析不确定，打包体积增大'
  });

  return {
    recommendedVersion: `^${recommendedVersion}`,
    recommendedStrippedVersion: recommendedVersion,
    strategy,
    reason,
    impact,
    affectedTypes,
    changes: entries.map(e => ({
      type: e.type,
      current: e.version,
      recommended: `^${recommendedVersion}`,
      action: stripVersionPrefix(e.version) === recommendedVersion ? 'keep' : 'update'
    })),
    alternatives
  };
}

function detectConflicts(allDependencies) {
  const grouped = {};
  for (const dep of allDependencies) {
    if (!grouped[dep.name]) {
      grouped[dep.name] = [];
    }
    grouped[dep.name].push(dep);
  }

  const conflicts = [];
  for (const [name, entries] of Object.entries(grouped)) {
    if (entries.length <= 1) continue;

    const uniqueVersions = [...new Set(entries.map(e => e.version))];
    if (uniqueVersions.length <= 1) continue;

    const uniqueStrippedVersions = [...new Set(entries.map(e => stripVersionPrefix(e.version)))];
    const severity = uniqueStrippedVersions.length > 1 ? 'high' : 'low';

    const conflictBase = {
      package: name,
      severity,
      reason: severity === 'high'
        ? `Major version mismatch: ${uniqueStrippedVersions.join(' vs ')}`
        : `Version prefix mismatch: ${uniqueVersions.join(' vs ')}`,
      entries,
      versions: uniqueVersions,
      strippedVersions: uniqueStrippedVersions
    };

    const fix = generateFixRecommendation(conflictBase, uniqueStrippedVersions);

    conflicts.push({
      ...conflictBase,
      fix
    });
  }

  return conflicts;
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

      const conflicts = detectConflicts(allDependencies);

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
          optionalDependencies: optionalDependencies.length,
          conflicts: conflicts.length
        },
        conflicts,
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

    case '/api/dependencies/conflicts':
    case '/api/deps/conflicts': {
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

      const conflicts = detectConflicts(allDependencies);

      const highRiskCount = conflicts.filter(c => c.fix && c.fix.impact && c.fix.impact.includes('高风险')).length;
      const mediumRiskCount = conflicts.filter(c => c.fix && c.fix.impact && c.fix.impact.includes('中风险')).length;
      const lowRiskCount = conflicts.filter(c => c.fix && c.fix.impact && c.fix.impact.includes('低风险')).length;

      const packagesNeedUpdate = conflicts.filter(c => {
        return c.fix && c.fix.changes && c.fix.changes.some(ch => ch.action === 'update');
      }).length;

      const recommendedChanges = [];
      for (const conflict of conflicts) {
        if (conflict.fix && conflict.fix.changes) {
          for (const change of conflict.fix.changes) {
            if (change.action === 'update') {
              recommendedChanges.push({
                package: conflict.package,
                type: change.type,
                current: change.current,
                recommended: change.recommended
              });
            }
          }
        }
      }

      const overallRecommendation = conflicts.length > 0 ? (
        highRiskCount > 0
          ? '存在高风险冲突，建议优先处理对等依赖相关的版本不一致问题'
          : mediumRiskCount > 0
            ? '存在中等风险冲突，建议逐步统一版本，生产环境升级前需充分测试'
            : '冲突风险较低，可按推荐版本逐步统一以保持依赖整洁'
      ) : '无版本冲突，依赖状态良好';

      sendResponse(res, 200, {
        hasConflicts: conflicts.length > 0,
        conflictCount: conflicts.length,
        highSeverityCount: conflicts.filter(c => c.severity === 'high').length,
        lowSeverityCount: conflicts.filter(c => c.severity === 'low').length,
        riskSummary: {
          highRisk: highRiskCount,
          mediumRisk: mediumRiskCount,
          lowRisk: lowRiskCount
        },
        overallRecommendation,
        packagesNeedUpdate,
        recommendedChanges,
        conflicts
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
          'GET /api/dependencies': 'List all dependencies (all types) with conflict detection',
          'GET /api/deps': 'Alias for /api/dependencies',
          'GET /api/dependencies/prod': 'List only production dependencies',
          'GET /api/deps/prod': 'Alias for /api/dependencies/prod',
          'GET /api/dependencies/dev': 'List only development dependencies',
          'GET /api/deps/dev': 'Alias for /api/dependencies/dev',
          'GET /api/dependencies/conflicts': 'Detect version conflicts across dependency types',
          'GET /api/deps/conflicts': 'Alias for /api/dependencies/conflicts',
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
          '/api/dependencies/dev',
          '/api/dependencies/conflicts'
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
  console.log('  GET /api/dependencies           - All dependencies + conflict detection');
  console.log('  GET /api/dependencies/prod      - Production dependencies only');
  console.log('  GET /api/dependencies/dev       - Development dependencies only');
  console.log('  GET /api/dependencies/conflicts - Version conflict detection only');
  console.log('========================================');
  console.log('  Press Ctrl+C to stop the server');
  console.log('========================================');
});
