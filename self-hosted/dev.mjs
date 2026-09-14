process.env.SPENTON_DEPLOYMENT_MODE='self-hosted';
process.env.SPENTON_LOCAL_ACCOUNTS='1';
await import('../tools/dev.mjs');
