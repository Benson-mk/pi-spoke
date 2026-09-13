if (process.env.PI_SPOKE_LIVE !== '1') {
  console.error('BLOCKED: live inference requires explicit PI_SPOKE_LIVE=1 and configured test credentials.');
} else {
  console.error('NOT RUN: live provider acceptance fixtures are not implemented yet.');
}
process.exitCode = 1;
