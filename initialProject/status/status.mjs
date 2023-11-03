import http from 'http';
import { shellExec } from './shellExec.mjs';

const timeStart = new Date().getTime();

const Status = {
  GREEN: 'green',
  YELLOW: 'yellow',
  RED: 'red',
};

const supervisorStatusToStatus = {
  STOPPED: Status.GREY,
  STARTING: Status.YELLOW,
  RUNNING: Status.GREEN,
  BACKOFF: Status.RED,
  STOPPING: Status.YELLOW,
  EXITED: Status.RED,
  FATAL: Status.RED,
  UNKNOWN: Status.RED,
};

const processStatusToMessage = (name, status) => {
  if (status === Status.GREEN) return `${name} process is running`;
  if (status === Status.YELLOW) return `${name} process is having issues`;
  if (status === Status.RED) return `${name} process has failed to start`;
  return `${name} process is stopped`;
};

const getSupervisorStatus = async (name, process) => {
  let status = Status.RED;
  let isPending = true;

  const processStatus = (await shellExec(`supervisorctl status ${process}`)).stdout || '';
  if (!processStatus.includes('ERROR')) {
    const supervisorStatus = processStatus.split(' ').filter((item) => !!item.trim())[1];
    status = supervisorStatusToStatus[supervisorStatus] || Status.RED;
    isPending = status === Status.RED;
  }

  return {
    status,
    isPending,
    message: processStatusToMessage(name, status),
  };
};

const getWWWStatus = async () => {
  try {
    const wwwResponse = (await shellExec('curl http://localhost')).stdout;
    if (wwwResponse?.includes('html')) return { status: Status.GREEN, message: '' };
    return { status: Status.RED, message: 'Astro is not responding' };
  } catch {
    return { status: Status.RED, message: 'Failed to query Astro status' };
  }
};

const getStatus = async () => {
  // First see if supervisor has started www
  const wwwProcessStatus = await getSupervisorStatus('Astro', 'www');
  let wwwStatus = {
    identifier: 'www',
    name: 'Astro',
    description: 'Astro website',
    ...wwwProcessStatus,
  };

  // Then check if site is running
  if (wwwProcessStatus.status === Status.GREEN) {
    wwwStatus = { ...wwwStatus, ...(await getWWWStatus()) };
  }

  // Exception... Don't show red until some time has passed
  const belowYellowThreshold = (new Date().getTime() - timeStart) / 1000 < 30;
  if (wwwStatus.status === Status.RED && belowYellowThreshold) {
    wwwStatus.status = Status.YELLOW;
    wwwStatus.message = 'Waiting for Astro...';
  }

  const status = {
    diploiStatusVersion: 1,
    items: [wwwStatus],
  };

  return status;
};

const requestListener = async (req, res) => {
  res.writeHead(200);
  res.end(JSON.stringify(await getStatus()));
};

const server = http.createServer(requestListener);
server.listen(3000, '0.0.0.0');

console.log('🌎  Status Server Started ' + new Date().toISOString());

const podReadinessLoop = async () => {
  const status = await getStatus();
  let allOK = !status.items.find((s) => s.status !== Status.GREEN);
  if (allOK) {
    await shellExec('touch /tmp/pod-ready');
  } else {
    await shellExec('rm -f /tmp/pod-ready');
  }
  setTimeout(() => {
    podReadinessLoop();
  }, 5000 + (allOK ? 1 : 0) * 5000);
};
podReadinessLoop();
