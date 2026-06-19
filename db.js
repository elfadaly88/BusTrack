const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'bustrack.db');
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
  console.log('Initializing multi-tenant database at:', dbPath);

  // Enable foreign keys
  await dbRun('PRAGMA foreign_keys = ON;');

  // 1. Tenants Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      status TEXT CHECK(status IN ('active', 'suspended')) DEFAULT 'active',
      created_at TEXT NOT NULL
    );
  `);

  // 2. Users Table (Super Admin user has tenant_id = NULL)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      password TEXT NOT NULL,
      role TEXT CHECK(role IN ('super_admin', 'admin', 'driver', 'passenger')) NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
  `);
  await dbRun('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);');

  // 3. Buses Table (Unique bus_number per tenant)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS buses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      bus_number TEXT NOT NULL,
      plate_number TEXT NOT NULL,
      capacity INTEGER DEFAULT 30,
      status TEXT CHECK(status IN ('active', 'maintenance', 'inactive')) DEFAULT 'active',
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      UNIQUE(bus_number, tenant_id)
    );
  `);
  await dbRun('CREATE INDEX IF NOT EXISTS idx_buses_tenant ON buses(tenant_id);');

  // 4. Lines Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      start_point TEXT NOT NULL,
      end_point TEXT NOT NULL,
      status TEXT CHECK(status IN ('active', 'inactive')) DEFAULT 'active',
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
  `);
  await dbRun('CREATE INDEX IF NOT EXISTS idx_lines_tenant ON lines(tenant_id);');

  // 5. Stations Table
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

  // 6. Passenger Registrations (Unique line registration per passenger)
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

  // 7. Trips Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      line_id INTEGER NOT NULL,
      driver_id INTEGER NOT NULL,
      bus_id INTEGER NOT NULL,
      status TEXT CHECK(status IN ('scheduled', 'active', 'completed')) DEFAULT 'scheduled',
      current_latitude REAL,
      current_longitude REAL,
      start_time TEXT,
      end_time TEXT,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (line_id) REFERENCES lines(id) ON DELETE CASCADE,
      FOREIGN KEY (driver_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (bus_id) REFERENCES buses(id) ON DELETE CASCADE
    );
  `);
  await dbRun('CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_trips_tenant ON trips(tenant_id);');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_trips_driver ON trips(driver_id);');

  // 8. Trip Station Arrivals (Log actual arrivals)
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

  // 9. Delay Alerts Table
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
    console.log('Seeding SaaS database with default multi-tenant data...');

    const timeNow = new Date().toISOString();

    // Insert Tenants
    await dbRun("INSERT INTO tenants (name, slug, status, created_at) VALUES ('جامعة القاهرة (Cairo University)', 'cairo-uni', 'active', ?)", [timeNow]);
    await dbRun("INSERT INTO tenants (name, slug, status, created_at) VALUES ('شركة أورانج (Orange Company)', 'orange', 'active', ?)", [timeNow]);

    // Hashing passwords
    const superPassword = await bcrypt.hash('super123', 10);
    const admin1Password = await bcrypt.hash('admin123', 10);
    const admin2Password = await bcrypt.hash('admin123', 10);
    const driver1Password = await bcrypt.hash('driver123', 10);
    const driver2Password = await bcrypt.hash('driver123', 10);
    const passenger1Password = await bcrypt.hash('passenger123', 10);
    const passenger2Password = await bcrypt.hash('passenger123', 10);

    // Insert Users
    // Tenant 1 (Cairo Uni): Admin (ID 2), Driver (ID 4), Passenger (ID 6)
    // Tenant 2 (Orange): Admin (ID 3), Driver (ID 5), Passenger (ID 7)
    await dbRun(`
      INSERT INTO users (tenant_id, name, email, phone, password, role) VALUES 
      (NULL, 'مدير المنصة (Super Admin)', 'super@bustrack.com', '+201000000000', ?, 'super_admin'),
      (1, 'مسؤول جامعة القاهرة (Admin)', 'admin@bustrack.com', '+201011111111', ?, 'admin'),
      (2, 'مسؤول شركة أورانج (Admin)', 'admin@orange.com', '+201011112222', ?, 'admin'),
      (1, 'أحمد علي (Ahmed Ali)', 'driver1@bustrack.com', '+201022222222', ?, 'driver'),
      (2, 'محمد محمود (Mohamed Mahmoud)', 'driver2@bustrack.com', '+201033333333', ?, 'driver'),
      (1, 'سارة أحمد (Sara Ahmed)', 'passenger1@bustrack.com', '+201044444444', ?, 'passenger'),
      (2, 'يوسف خالد (Youssef Khaled)', 'passenger2@bustrack.com', '+201055555555', ?, 'passenger')
    `, [superPassword, admin1Password, admin2Password, driver1Password, driver2Password, passenger1Password, passenger2Password]);

    // Insert Buses
    await dbRun(`
      INSERT INTO buses (tenant_id, bus_number, plate_number, capacity, status) VALUES
      (1, '101', 'أ ب ج 1234', 50, 'active'),
      (1, '102', 'د هـ و 5678', 30, 'active'),
      (2, '101', 'ر س ص 9012', 45, 'active') -- Same bus number '101' but different tenant!
    `);

    // Insert Lines
    await dbRun(`
      INSERT INTO lines (tenant_id, name, start_point, end_point, status) VALUES
      (1, 'خط جامعة القاهرة الرئيسي', 'ميدان التحرير', 'جامعة القاهرة', 'active'),
      (2, 'خط مكوك شركة أورانج', 'مصر الجديدة', 'مدينة الشروق', 'active'),
      (1, 'خط الجيزة الفرعي', 'المهندسين', 'الدقي', 'active')
    `);

    // Insert Stations for Line 1 (Cairo Uni Line)
    await dbRun(`
      INSERT INTO stations (line_id, name, sequence_order, latitude, longitude, eta_offset_mins) VALUES
      (1, 'ميدان التحرير (Tahrir Square)', 1, 30.0444, 31.2357, 0),
      (1, 'الدقي (Dokki Station)', 2, 30.0382, 31.2114, 10),
      (1, 'جامعة القاهرة (Cairo University)', 3, 30.0263, 31.2069, 20)
    `);

    // Insert Stations for Line 2 (Orange Shuttle)
    await dbRun(`
      INSERT INTO stations (line_id, name, sequence_order, latitude, longitude, eta_offset_mins) VALUES
      (2, 'مصر الجديدة (Heliopolis)', 1, 30.0971, 31.3256, 0),
      (2, 'التجمع الخامس (Fifth Settlement)', 2, 30.0074, 31.4740, 25),
      (2, 'مدينة الشروق (Shorouk City)', 3, 30.1478, 31.6314, 50)
    `);

    // Insert Stations for Line 3 (Giza Shuttle - Tenant 1)
    await dbRun(`
      INSERT INTO stations (line_id, name, sequence_order, latitude, longitude, eta_offset_mins) VALUES
      (3, 'ميدان لبنان (Lebanon Sq)', 1, 30.0617, 31.2014, 0),
      (3, 'المهندسين (Mohandessin)', 2, 30.0534, 31.2039, 10),
      (3, 'الدقي الفرعية (Dokki Sub)', 3, 30.0390, 31.2110, 18)
    `);

    // Assign Passenger 1 (Sara, Tenant 1) to Line 1 (Tahrir->Uni, Station Dokki ID 2) and Line 3 (Giza, Station Dokki Sub ID 9)
    await dbRun(`
      INSERT INTO passenger_registrations (passenger_id, line_id, station_id) VALUES
      (6, 1, 2),
      (6, 3, 9)
    `);

    // Assign Passenger 2 (Youssef, Tenant 2) to Line 2 (Orange Shuttle, Station Fifth Settlement ID 5)
    await dbRun(`
      INSERT INTO passenger_registrations (passenger_id, line_id, station_id) VALUES
      (7, 2, 5)
    `);

    // Create scheduled trips
    // Trip 1 (Tenant 1) on Line 1, Driver 4, Bus 1
    await dbRun(`
      INSERT INTO trips (tenant_id, line_id, driver_id, bus_id, status) VALUES
      (1, 1, 4, 1, 'scheduled')
    `);

    // Trip 2 (Tenant 2) on Line 2, Driver 5, Bus 3
    await dbRun(`
      INSERT INTO trips (tenant_id, line_id, driver_id, bus_id, status) VALUES
      (2, 2, 5, 3, 'scheduled')
    `);

    console.log('SaaS Database seeded successfully.');
  }
}

module.exports = {
  db,
  dbRun,
  dbGet,
  dbAll,
  initDb
};
