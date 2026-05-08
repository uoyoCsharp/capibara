const { promises: fs } = require('node:fs');
const path = require('node:path');

const REMOVABLE = ['dxcompiler.dll', 'dxil.dll'];

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  for (const name of REMOVABLE) {
    const target = path.join(context.appOutDir, name);
    try {
      await fs.unlink(target);
      console.log(`[strip-unused] removed ${name}`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`[strip-unused] could not remove ${name}:`, err.message);
      }
    }
  }
};
