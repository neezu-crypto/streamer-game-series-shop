const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.resolve(__dirname, '../catalog/stickers.json');
const targetDirectory = path.resolve(__dirname, 'catalog');
const targetPath = path.join(targetDirectory, 'stickers.json');

fs.mkdirSync(targetDirectory, { recursive: true });
fs.copyFileSync(sourcePath, targetPath);
console.log('Synced catalog/stickers.json into the Functions package.');
