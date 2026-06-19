const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'bustrack.db');
const db = new sqlite3.Database(dbPath);

// Helper function to run DB queries as promises
const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

async function initDb() {
  console.log('Initializing database at:', dbPath);

  // Enable foreign keys
  await dbRun('PRAGMA foreign_keys = ON;');

  // 1. Users Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      password TEXT NOT NULL,
      role TEXT CHECK(role IN ('admin', 'driver', 'passenger')) NOT NULL
    );
  `);
  await dbRun('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);');

  // 2. Buses Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS buses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bus_number TEXT UNIQUE NOT NULL,
      plate_number TEXT NOT NULL,
      capacity INTEGER DEFAULT 30,
      status TEXT CHECK(status IN ('active', 'maintenance', 'inactive')) DEFAULT 'active'
    );
  `);

  // 3. Lines Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      start_point TEXT NOT NULL,
      end_point TEXT NOT NULL,
      status TEXT CHECK(status IN ('active', 'inactive')) DEFAULT 'active'
    );
  `);

  // 4. Stations Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS stations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      sequence_order INTEGER NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      eta_offset_mins INTEGER DEFAULT 0,
      FOREIGN KEY (line_id) REFERENCES lines(id) ON DELETE CASCADE
    );
  `);
  await dbRun('CREATE INDEX IF NOT EXISTS idx_stations_line ON stations(line_id);');

  // 5. Passenger Registrations (Preferred stations for passengers)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS passenger_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      passenger_id INTEGER NOT NULL,
      line_id INTEGER NOT NULL,
      station_id INTEGER NOT NULL,
      FOREIGN KEY (passenger_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (line_id) REFERENCES lines(id) ON DELETE CASCADE,
      FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE,
      UNIQUE(passenger_id, line_id)
    );
  `);
  await dbRun('CREATE INDEX IF NOT EXISTS idx_pass_reg_user ON passenger_registrations(passenger_id);');

  // 6. Trips Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line_id INTEGER NOT NULL,
      driver_id INTEGER NOT NULL,
      bus_id INTEGER NOT NULL,
      status TEXT CHECK(status IN ('scheduled', 'active', 'completed')) DEFAULT 'scheduled',
      current_latitude REAL,
      current_longitude REAL,
      start_time TEXT,
      end_time TEXT,
      FOREIGN KEY (line_id) REFERENCES lines(id) ON DELETE CASCADE,
      FOREIGN KEY (driver_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (bus_id) REFERENCES buses(id) ON DELETE CASCADE
    );
  `);
  await dbRun('CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_trips_driver ON trips(driver_id);');

  // 7. Trip Station Arrivals (Log actual arrivals)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS trip_station_arrivals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      station_id INTEGER NOT NULL,
      actual_arrival_time TEXT NOT NULL,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
      FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE
    );
  `);
  await dbRun('CREATE INDEX IF NOT EXISTS idx_arrivals_trip ON trip_station_arrivals(trip_id);');

  // 8. Delay Alerts Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS delay_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      passenger_id INTEGER NOT NULL,
      station_id INTEGER NOT NULL,
      delay_mins INTEGER NOT NULL,
      driver_response TEXT CHECK(driver_response IN ('pending', 'waiting', 'rejected')) DEFAULT 'pending',
      created_at TEXT NOT NULL,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
      FOREIGN KEY (passenger_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE
    );
  `);
  await dbRun('CREATE INDEX IF NOT EXISTS idx_delay_trip ON delay_alerts(trip_id);');

  // Seed default data if users table is empty
  const userCount = await dbGet('SELECT COUNT(*) as count FROM users');
  if (userCount.count === 0) {
    console.log('Seeding database with default data...');

    // Hashing passwords
    const adminPassword = await bcrypt.hash('admin123', 10);
    const driver1Password = await bcrypt.hash('driver123', 10);
    const driver2Password = await bcrypt.hash('driver123', 10);
    const passenger1Password = await bcrypt.hash('passenger123', 10);
    const passenger2Password = await bcrypt.hash('passenger123', 10);

    // Insert Users
    await dbRun(`
      INSERT INTO users (name, email, phone, password, role) VALUES 
      ('مسؤول النظام (Admin)', 'admin@bustrack.com', '+201011111111', ?, 'admin'),
      ('أحمد علي (Ahmed Ali)', 'driver1@bustrack.com', '+201022222222', ?, 'driver'),
      ('محمد محمود (Mohamed Mahmoud)', 'driver2@bustrack.com', '+201033333333', ?, 'driver'),
      ('سارة أحمد (Sara Ahmed)', 'passenger1@bustrack.com', '+201044444444', ?, 'passenger'),
      ('يوسف خالد (Youssef Khaled)', 'passenger2@bustrack.com', '+201055555555', ?, 'passenger')
    `, [adminPassword, driver1Password, driver2Password, passenger1Password, passenger2Password]);

    // Insert Buses
    await dbRun(`
      INSERT INTO buses (bus_number, plate_number, capacity, status) VALUES
      ('101', 'أ ب ج 1234', 50, 'active'),
      ('102', 'د هـ و 5678', 30, 'active'),
      ('103', 'ر س ص 9012', 45, 'maintenance')
    `);

    // Insert Lines
    await dbRun(`
      INSERT INTO lines (name, start_point, end_point, status) VALUES
      ('خط جامعة القاهرة (Cairo University Line)', 'ميدان التحرير', 'جامعة القاهرة', 'active'),
      ('خط مدينة الشروق (Al-Shorouk Line)', 'مصر الجديدة', 'مدينة الشروق', 'active')
    `);

    // Insert Stations for Line 1 (Cairo University Line)
    // Tahrir (30.0444, 31.2357), Dokki (30.0382, 31.2114), Cairo University (30.0263, 31.2069)
    await dbRun(`
      INSERT INTO stations (line_id, name, sequence_order, latitude, longitude, eta_offset_mins) VALUES
      (1, 'ميدان التحرير (Tahrir Square)', 1, 30.0444, 31.2357, 0),
      (1, 'الدقي (Dokki Station)', 2, 30.0382, 31.2114, 10),
      (1, 'جامعة القاهرة (Cairo University)', 3, 30.0263, 31.2069, 20)
    `);

    // Insert Stations for Line 2 (Al-Shorouk Line)
    // Heliopolis (30.0971, 31.3256), Fifth Settlement (30.0074, 31.4740), Shorouk City (30.1478, 31.6314)
    await dbRun(`
      INSERT INTO stations (line_id, name, sequence_order, latitude, longitude, eta_offset_mins) VALUES
      (2, 'مصر الجديدة (Heliopolis)', 1, 30.0971, 31.3256, 0),
      (2, 'التجمع الخامس (Fifth Settlement)', 2, 30.0074, 31.4740, 25),
      (2, 'مدينة الشروق (Shorouk City)', 3, 30.1478, 31.6314, 50)
    `);

    // Assign Passenger 1 (Sara) to Cairo University Line, Station Dokki AND Al-Shorouk Line, Station Fifth Settlement
    await dbRun(`
      INSERT INTO passenger_registrations (passenger_id, line_id, station_id) VALUES
      (4, 1, 2),
      (4, 2, 5)
    `);

    // Assign Passenger 2 (Youssef) to Al-Shorouk Line, Station Fifth Settlement
    await dbRun(`
      INSERT INTO passenger_registrations (passenger_id, line_id, station_id) VALUES
      (5, 2, 5)
    `);

    // Create a default scheduled trip for Driver 1 (Ahmed Ali) on Line 1 with Bus 101
    await dbRun(`
      INSERT INTO trips (line_id, driver_id, bus_id, status) VALUES
      (1, 2, 1, 'scheduled')
    `);

    // Create a default scheduled trip for Driver 2 (Mohamed) on Line 2 with Bus 102
    await dbRun(`
      INSERT INTO trips (line_id, driver_id, bus_id, status) VALUES
      (2, 3, 2, 'scheduled')
    `);

    console.log('Database seeded successfully.');
  }
}

module.exports = {
  db,
  dbRun,
  dbGet,
  dbAll,
  initDb
};
