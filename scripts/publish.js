const packageJson = require('../package.json');
const buildTime = new Date().getTime();
const path = require('path');

const { spawn } = require('child_process');

const {
  ECR_REPO,
  BRANCH,
  BUILD_NUMBER,
  SERVICE = 'cht-user-management'
} = process.env;

const getBranchVersions = () => {
  if (BRANCH === 'main' || BRANCH.replace('v', '') === packageJson.version) {
    return [`${packageJson.version}`, 'latest'];
  }
  return [`${packageJson.version}-${BRANCH}.${BUILD_NUMBER}`];
};

const getRepo = () => {
  return ECR_REPO || 'medicmobile';
};

const getVersions = () => {
  if (BRANCH) {
    return getBranchVersions();
  }
  return [`${packageJson.version}-dev.${buildTime}`];
};

const getImageTags = (serviceName) => {
  const versions = getVersions();
  const tags = versions.map(version => version.replace(/\/|_/g, '-'));
  return tags.map(tag => `${getRepo()}/${serviceName}:${tag}`);
};

const dockerCommand = (args) => {
  console.log('docker', ...args);

  return new Promise((resolve, reject) => {
    const proc = spawn('docker', args);
    proc.on('error', (err) => reject(err));

    let err = '';
    let data = '';

    proc.stdout.on('data', (chunk) => {
      chunk = chunk.toString();
      console.log(chunk);
      data += chunk;
    });
    proc.stderr.on('data', (chunk) => {
      chunk = chunk.toString();
      console.error(chunk);
      err += chunk;
    });

    proc.on('close', (exitCode) => {
      exitCode ? reject(err || `Closed with exit code ${exitCode}`) : resolve(data);
    });
  });
};

(async () => {
  let dockerfilePath;
  let serviceName;

  if (SERVICE === 'cht-user-management-worker') {
    dockerfilePath = 'Dockerfile.worker';
    serviceName = 'cht-user-management-worker';
  } else {
    dockerfilePath = 'Dockerfile';
    serviceName = 'cht-user-management';
  }

  const tags = getImageTags(serviceName);
  const fullDockerfilePath = path.join(__dirname, '..', dockerfilePath);
  const tagFlags = tags.map(tag => ['-t', tag]).flat();
  const dockerBuildParams = [
    'build',
    '-f',
    fullDockerfilePath,
    ...tagFlags,
    '.'
  ];

  await dockerCommand(dockerBuildParams);
  for (const tag of tags) {
    await dockerCommand(['push', tag]);
  }
})();
