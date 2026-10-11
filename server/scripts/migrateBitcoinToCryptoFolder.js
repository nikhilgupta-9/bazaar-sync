// server/scripts/migrateBitcoinToCryptoFolder.js
require('dotenv').config({ path: './server/.env' });
const { getDriveClient, ensureSubFolder, listDriveFiles } = require('../services/googleDriveService');
const { pool } = require('../config/db');

async function migrateBitcoinFolders() {
    console.log('================================================================');
    console.log('🔄 [GOOGLE DRIVE CRYPTO FOLDER UNIFICATION MIGRATION]');
    console.log('================================================================');

    const drive = await getDriveClient();
    const rootId = '1bHf18SyIES1hdnXl7Z7d4x5g_j7mOOmt';

    // 1. Find root folders
    const rootList = await listDriveFiles({ folderId: rootId, pageSize: 100 });
    const bitcoinFolder = rootList.files.find(f => f.isFolder && f.name.toLowerCase() === 'bitcoin');
    const cryptoFolder = rootList.files.find(f => f.isFolder && f.name.toLowerCase() === 'crypto');

    if (!cryptoFolder) {
        console.error('❌ Crypto folder not found under root!');
        process.exit(1);
    }
    console.log(`✅ Target Crypto Folder found: "${cryptoFolder.name}" (ID: ${cryptoFolder.id})`);

    if (!bitcoinFolder) {
        console.log('ℹ️ Bitcoin folder does not exist at root. Checking existing files...');
    } else {
        console.log(`📁 Source Bitcoin Folder found: "${bitcoinFolder.name}" (ID: ${bitcoinFolder.id})`);
    }

    // 2. Map year folders in crypto folder
    const cryptoYearFolders = await listDriveFiles({ folderId: cryptoFolder.id, pageSize: 100 });
    const yearFolderMap = {};
    for (const item of cryptoYearFolders.files) {
        if (item.isFolder) {
            yearFolderMap[item.name] = item.id;
        }
    }

    // Ensure 2023, 2024, 2025, 2026 year folders exist in crypto folder
    for (const yr of ['2023', '2024', '2025', '2026']) {
        if (!yearFolderMap[yr]) {
            console.log(`Creating year folder "${yr}" under crypto folder...`);
            const yId = await ensureSubFolder(yr, cryptoFolder.id);
            yearFolderMap[yr] = yId;
        }
        console.log(`Year ${yr} folder in crypto: ID ${yearFolderMap[yr]}`);
    }

    // 3. If Bitcoin folder exists, find all files inside its year subfolders and move them
    if (bitcoinFolder) {
        const bYearFolders = await listDriveFiles({ folderId: bitcoinFolder.id, pageSize: 100 });
        for (const bYear of bYearFolders.files) {
            if (bYear.isFolder) {
                const yr = bYear.name;
                const targetYearFolderId = yearFolderMap[yr];
                
                // Ensure BTCUSDT folder exists under targetYearFolderId
                const btcTargetFolderId = await ensureSubFolder('BTCUSDT', targetYearFolderId);
                console.log(`\nTarget BTCUSDT folder for year ${yr}: ID ${btcTargetFolderId}`);

                // List files in bitcoin/<year>
                const bFiles = await listDriveFiles({ folderId: bYear.id, pageSize: 100 });
                for (const file of bFiles.files) {
                    if (!file.isFolder) {
                        console.log(`Moving file "${file.name}" (ID: ${file.id}) from Bitcoin/${yr} to crypto/${yr}/BTCUSDT...`);
                        
                        // Move file in Google Drive: add new parent, remove old parent
                        await drive.files.update({
                            fileId: file.id,
                            addParents: btcTargetFolderId,
                            removeParents: bYear.id,
                            fields: 'id, name, parents, webViewLink',
                            supportsAllDrives: true,
                        });
                        console.log(`✅ File moved successfully!`);

                        // Update in database gdrive_archive_records
                        await pool.query(`
                            UPDATE gdrive_archive_records
                            SET gdrive_folder_id = ?, data_type = 'crypto', status = 'archived'
                            WHERE gdrive_file_id = ? OR file_name = ?
                        `, [btcTargetFolderId, file.id, file.name]);
                    }
                }
            }
        }

        // 4. Trash the old root Bitcoin folder
        console.log(`\n🗑️ Trashing empty/superseded root Bitcoin folder (ID: ${bitcoinFolder.id})...`);
        try {
            await drive.files.update({
                fileId: bitcoinFolder.id,
                requestBody: { trashed: true },
                supportsAllDrives: true,
            });
            console.log(`✅ Successfully removed redundant root Bitcoin folder from Google Drive!`);
        } catch (delErr) {
            console.warn(`Could not trash Bitcoin folder:`, delErr.message);
        }
    }

    // 5. Verify database records for all crypto files
    console.log('\n=== UPDATING & VERIFYING DATABASE ARCHIVE RECORDS ===');
    await pool.query(`UPDATE gdrive_archive_records SET data_type = 'crypto' WHERE data_type = 'bitcoin' OR symbol IN ('BTCUSDT', 'ETHUSDT', 'SOLUSDT')`);
    
    const [allRecords] = await pool.query(
        "SELECT id, symbol, year, data_type, file_name, gdrive_file_id, gdrive_folder_id FROM gdrive_archive_records WHERE data_type = 'crypto' ORDER BY symbol, year"
    );
    console.log('Current Crypto Database Archive Records:', allRecords);

    console.log('\n✨ Migration Complete! Only 1 unified "crypto" folder remains on Google Drive.');
    process.exit(0);
}

migrateBitcoinFolders().catch(err => {
    console.error('Migration error:', err);
    process.exit(1);
});
