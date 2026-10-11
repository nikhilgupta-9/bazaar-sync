require('dotenv').config({ path: './server/.env' });
const { pool } = require('../config/db');

async function syncArchiveRecords() {
  const records = [
    { symbol: 'BTCUSDT', year: 2024, data_type: 'crypto', record_count: 527040, file_name: 'BTCUSDT_2024_crypto.csv.gz', file_size_bytes: 10949222, gdrive_file_id: '1ZHdSLEvYn_5L3jWo6B4oV55gAY14V-26', gdrive_folder_id: '1decf5m-hFkFizqgnd8eCScwufQNBRn37', gdrive_web_link: 'https://drive.google.com/file/d/1ZHdSLEvYn_5L3jWo6B4oV55gAY14V-26/view?usp=drivesdk' },
    { symbol: 'BTCUSDT', year: 2025, data_type: 'crypto', record_count: 525600, file_name: 'BTCUSDT_2025_crypto.csv.gz', file_size_bytes: 10963046, gdrive_file_id: '19qcrJfT1ayJIrBjrP7vhioWLFUdwaIRL', gdrive_folder_id: '1e4zV9vkqNbJr8kloP0rnJB7fzrVKk9oh', gdrive_web_link: 'https://drive.google.com/file/d/19qcrJfT1ayJIrBjrP7vhioWLFUdwaIRL/view?usp=drivesdk' },
    { symbol: 'BTCUSDT', year: 2026, data_type: 'crypto', record_count: 392111, file_name: 'BTCUSDT_2026_crypto.csv.gz', file_size_bytes: 8030208, gdrive_file_id: '1Vh-566ujJfFzo2-bR8mBU-KFeyfm8P0E', gdrive_folder_id: '1-D4urmb6NbvNXpA00PqdvhdDM9gX-jK9', gdrive_web_link: 'https://drive.google.com/file/d/1Vh-566ujJfFzo2-bR8mBU-KFeyfm8P0E/view?usp=drivesdk' },
    { symbol: 'ETHUSDT', year: 2024, data_type: 'crypto', record_count: 527040, file_name: 'ETHUSDT_2024_crypto.csv.gz', file_size_bytes: 10670796, gdrive_file_id: '1tsAJ_zYOl7ExC2zm-uj1nmD_Rx58xIsx', gdrive_folder_id: '18uwmAU47-N5K-J4wq8jR4mE2Bi-Suj3A', gdrive_web_link: 'https://drive.google.com/file/d/1tsAJ_zYOl7ExC2zm-uj1nmD_Rx58xIsx/view?usp=drivesdk' },
    { symbol: 'ETHUSDT', year: 2025, data_type: 'crypto', record_count: 525600, file_name: 'ETHUSDT_2025_crypto.csv.gz', file_size_bytes: 10815795, gdrive_file_id: '1cr68VH-F4IkVllU7t1CHtKQ6CVK_Y4wo', gdrive_folder_id: '1zBhjdK-HVfwrTA9EhC0yaJFi27OkLCp0', gdrive_web_link: 'https://drive.google.com/file/d/1cr68VH-F4IkVllU7t1CHtKQ6CVK_Y4wo/view?usp=drivesdk' },
    { symbol: 'ETHUSDT', year: 2026, data_type: 'crypto', record_count: 392111, file_name: 'ETHUSDT_2026_crypto.csv.gz', file_size_bytes: 7976857, gdrive_file_id: '1_vJVElow2NIrtsSSNkgTKQGszq4J8ruC', gdrive_folder_id: '1ro4SEjTctYGGWWzdQ9LX95gUaFDZ6IOX', gdrive_web_link: 'https://drive.google.com/file/d/1_vJVElow2NIrtsSSNkgTKQGszq4J8ruC/view?usp=drivesdk' },
  ];

  for (const r of records) {
    await pool.query(`
      INSERT INTO gdrive_archive_records 
      (symbol, year, data_type, record_count, file_name, file_size_bytes, gdrive_file_id, gdrive_folder_id, gdrive_web_link, status, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'archived', NOW())
      ON DUPLICATE KEY UPDATE
      data_type = VALUES(data_type),
      record_count = VALUES(record_count),
      file_name = VALUES(file_name),
      file_size_bytes = VALUES(file_size_bytes),
      gdrive_file_id = VALUES(gdrive_file_id),
      gdrive_folder_id = VALUES(gdrive_folder_id),
      gdrive_web_link = VALUES(gdrive_web_link),
      status = 'archived'
    `, [r.symbol, r.year, r.data_type, r.record_count, r.file_name, r.file_size_bytes, r.gdrive_file_id, r.gdrive_folder_id, r.gdrive_web_link]);
  }

  console.log('✅ Archive records synced for all crypto files!');
  const [rows] = await pool.query("SELECT symbol, year, data_type, record_count, file_name, gdrive_file_id FROM gdrive_archive_records WHERE data_type = 'crypto' ORDER BY symbol, year");
  console.log(rows);
  process.exit(0);
}

syncArchiveRecords().catch(err => {
  console.error(err);
  process.exit(1);
});
