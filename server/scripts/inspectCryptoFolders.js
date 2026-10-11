require('dotenv').config({ path: './server/.env' });
const { getDriveClient, listDriveFiles } = require('../services/googleDriveService');

async function inspectDriveFolders() {
  try {
    const drive = await getDriveClient();
    const rootId = '1bHf18SyIES1hdnXl7Z7d4x5g_j7mOOmt';
    
    // List folders in root
    const rootItems = await listDriveFiles({ folderId: rootId, pageSize: 100 });
    console.log('=== ROOT FOLDER CONTENTS ===');
    for (const item of rootItems.files) {
      console.log((item.isFolder ? '[FOLDER]' : '[FILE]') + ' ' + item.name + ' (ID: ' + item.id + ')');
    }

    const bitcoinFolder = rootItems.files.find(f => f.name.toLowerCase() === 'bitcoin');
    const cryptoFolder = rootItems.files.find(f => f.name.toLowerCase() === 'crypto');

    if (bitcoinFolder) {
      console.log('\n=== BITCOIN FOLDER CONTENTS (ID: ' + bitcoinFolder.id + ') ===');
      const bItems = await listDriveFiles({ folderId: bitcoinFolder.id, pageSize: 100 });
      for (const item of bItems.files) {
        console.log('  ' + (item.isFolder ? '[FOLDER]' : '[FILE]') + ' ' + item.name + ' (ID: ' + item.id + ')');
        if (item.isFolder) {
          const subItems = await listDriveFiles({ folderId: item.id, pageSize: 100 });
          for (const sub of subItems.files) {
            console.log('    ' + (sub.isFolder ? '[FOLDER]' : '[FILE]') + ' ' + sub.name + ' (ID: ' + sub.id + ')');
            if (sub.isFolder) {
              const subSub = await listDriveFiles({ folderId: sub.id, pageSize: 100 });
              for (const ss of subSub.files) {
                console.log('      ' + (ss.isFolder ? '[FOLDER]' : '[FILE]') + ' ' + ss.name + ' (ID: ' + ss.id + ')');
              }
            }
          }
        }
      }
    }

    if (cryptoFolder) {
      console.log('\n=== CRYPTO FOLDER CONTENTS (ID: ' + cryptoFolder.id + ') ===');
      const cItems = await listDriveFiles({ folderId: cryptoFolder.id, pageSize: 100 });
      for (const item of cItems.files) {
        console.log('  ' + (item.isFolder ? '[FOLDER]' : '[FILE]') + ' ' + item.name + ' (ID: ' + item.id + ')');
        if (item.isFolder) {
          const subItems = await listDriveFiles({ folderId: item.id, pageSize: 100 });
          for (const sub of subItems.files) {
            console.log('    ' + (sub.isFolder ? '[FOLDER]' : '[FILE]') + ' ' + sub.name + ' (ID: ' + sub.id + ')');
            if (sub.isFolder) {
              const subSub = await listDriveFiles({ folderId: sub.id, pageSize: 100 });
              for (const ss of subSub.files) {
                console.log('      ' + (ss.isFolder ? '[FOLDER]' : '[FILE]') + ' ' + ss.name + ' (ID: ' + ss.id + ')');
              }
            }
          }
        }
      }
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
inspectDriveFolders();
