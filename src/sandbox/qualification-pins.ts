/** Observed macOS compatibility identity; changes require the real negative suite. */
export const qualificationPins = {
  platform: 'darwin', architecture: 'arm64', os: '24.6.0',
  lock: '27101405527f2152175bf4c3eb42d31d23527b7beb490372a01f5d05367ee16f',
  node: '3200fbd9f7fd4410426dd541e10d1ab829d3472f270d743c7fabd1696c03fe32',
  bash: 'b46e8d4eac541d79f77000550b4254b47599df8dd8c52cc5b0f37cca1c3b02d4',
  backend: 'cbd6ab1e5a359afe9ed93b33dc65b5cd7544d364ed284542878505671ae7f83e',
  compiler: 'e21d4fc6cc0f0c86c77e2de5cd09064895aee4ef3c308b4759979393b7d23fcb',
};
export const ripgrepSha256 = 'a95906967134d19589fb57c4d4780b7dcf3ed0f5d846ea45e77e37c9e7af311c';
/** Linux arm64 identity under active qualification; unknown hosts still fail closed. */
export const linuxQualificationPins = {
  platform: 'linux', architecture: 'arm64', os: '7.0.14-orbstack-00380-ga7e0a2dc9535',
  lock: qualificationPins.lock, compiler: qualificationPins.compiler,
  node: 'd0b9f94a9771bba3c30a54f0aee622fa0bee37be684cc1df6da2d3448606d98d',
  bash: 'af955ef55333c8fc9c5aa50df91ad1a629d9a79a9afa125cd5e9629585f78015',
  backend: 'ae27935781511400c65ebcc0b4669775d602f46251b8707c947a1ac1b160c1c8',
  networkFilter: 'b8aede0b23007a1cc849cac4fac5a7270d77b856d91ad0eeb84e01c6019b9eb1',
  srtSeccomp: '9ace43a76dab5650b5e544230814eaaac8f2136f4a40c2f6069f0631fee230e1',
  socat: '8bce608454b1f027e42ad6d9e49935dfad44605da7f7f138b06a0f36b38d6025',
};
export const linuxRipgrepSha256 = '51407f46525cf368f99011044fae7aa00912dce6467731f97bb7cf423e2bd702';
