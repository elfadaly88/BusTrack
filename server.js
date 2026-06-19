const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const { initDb, dbAll, dbGet, dbRun } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'bustrack_super_secret_jwt_key_2026';
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Authentication Middleware
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'لم يتم توفير رمز التحقق (No token provided)' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'صيغة رمز التحقق غير صالحة (Invalid token format)' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'رمز التحقق غير صالح أو انتهت صلاحيته (Invalid or expired token)' });
    }
    req.user = decoded;
    next();
  });
};

// Role Checking Middleware
const roleMiddleware = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'غير مصرح لك بإجراء هذه العملية (Unauthorized role)' });
    }
    next();
  };
};

// --- AUTHENTICATION ENDPOINTS ---

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'يرجى إدخال البريد الإلكتروني وكلمة المرور (Please enter email and password)' });
  }

  try {
    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة (Invalid email or password)' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة (Invalid email or password)' });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'حدث خطأ في الخادم (Server error)' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await dbGet('SELECT id, name, email, phone, role FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'المستخدم غير موجود (User not found)' });
    }
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'حدث خطأ في الخادم (Server error)' });
  }
});

// --- ADMIN ENDPOINTS ---

// Get Stats
app.get('/api/admin/stats', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    const activeTrips = await dbGet("SELECT COUNT(*) as count FROM trips WHERE status = 'active'");
    const totalBuses = await dbGet("SELECT COUNT(*) as count FROM buses WHERE status = 'active'");
    const totalDrivers = await dbGet("SELECT COUNT(*) as count FROM users WHERE role = 'driver'");
    const totalLines = await dbGet("SELECT COUNT(*) as count FROM lines WHERE status = 'active'");

    res.json({
      activeTrips: activeTrips.count,
      totalBuses: totalBuses.count,
      totalDrivers: totalDrivers.count,
      totalLines: totalLines.count
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error fetching stats' });
  }
});

// Buses CRUD
app.get('/api/admin/buses', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    const buses = await dbAll('SELECT * FROM buses');
    res.json(buses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/buses', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  const { bus_number, plate_number, capacity, status } = req.body;
  try {
    const result = await dbRun(
      'INSERT INTO buses (bus_number, plate_number, capacity, status) VALUES (?, ?, ?, ?)',
      [bus_number, plate_number, capacity || 30, status || 'active']
    );
    res.json({ id: result.lastID, bus_number, plate_number, capacity, status });
  } catch (error) {
    res.status(400).json({ error: 'رقم الحافلة مسجل بالفعل أو المدخلات خاطئة (Bus already exists or invalid data)' });
  }
});

app.put('/api/admin/buses/:id', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  const { bus_number, plate_number, capacity, status } = req.body;
  try {
    await dbRun(
      'UPDATE buses SET bus_number = ?, plate_number = ?, capacity = ?, status = ? WHERE id = ?',
      [bus_number, plate_number, capacity, status, req.params.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/admin/buses/:id', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    await dbRun('DELETE FROM buses WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Drivers CRUD (Users table with role='driver')
app.get('/api/admin/drivers', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    const drivers = await dbAll("SELECT id, name, email, phone, role FROM users WHERE role = 'driver'");
    res.json(drivers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/drivers', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'جميع الحقول المطلوبة يجب ملؤها (Missing required fields)' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await dbRun(
      "INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, 'driver')",
      [name, email, phone, hashedPassword]
    );
    res.json({ id: result.lastID, name, email, phone, role: 'driver' });
  } catch (error) {
    res.status(400).json({ error: 'البريد الإلكتروني مسجل بالفعل (Email already registered)' });
  }
});

app.put('/api/admin/drivers/:id', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  const { name, email, phone, password } = req.body;
  try {
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await dbRun(
        "UPDATE users SET name = ?, email = ?, phone = ?, password = ? WHERE id = ? AND role = 'driver'",
        [name, email, phone, hashedPassword, req.params.id]
      );
    } else {
      await dbRun(
        "UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ? AND role = 'driver'",
        [name, email, phone, req.params.id]
      );
    }
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/admin/drivers/:id', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    await dbRun("DELETE FROM users WHERE id = ? AND role = 'driver'", [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Lines and Stations CRUD
app.get('/api/admin/lines', authMiddleware, async (req, res) => {
  try {
    const lines = await dbAll('SELECT * FROM lines');
    for (let line of lines) {
      line.stations = await dbAll('SELECT * FROM stations WHERE line_id = ? ORDER BY sequence_order ASC', [line.id]);
    }
    res.json(lines);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/lines', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  const { name, start_point, end_point, stations } = req.body;
  if (!name || !start_point || !end_point || !stations || !stations.length) {
    return res.status(400).json({ error: 'الرجاء إدخال تفاصيل الخط والمحطات (Missing route parameters)' });
  }

  try {
    // Transaction to insert line and stations
    await dbRun('BEGIN TRANSACTION;');
    const lineResult = await dbRun(
      'INSERT INTO lines (name, start_point, end_point, status) VALUES (?, ?, ?, ?)',
      [name, start_point, end_point, 'active']
    );
    const lineId = lineResult.lastID;

    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      await dbRun(
        'INSERT INTO stations (line_id, name, sequence_order, latitude, longitude, eta_offset_mins) VALUES (?, ?, ?, ?, ?, ?)',
        [lineId, st.name, i + 1, st.latitude, st.longitude, st.eta_offset_mins || 0]
      );
    }
    await dbRun('COMMIT;');

    res.json({ success: true, lineId });
  } catch (error) {
    await dbRun('ROLLBACK;');
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/lines/:id', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  const { name, start_point, end_point, stations } = req.body;
  const lineId = req.params.id;
  try {
    await dbRun('BEGIN TRANSACTION;');
    await dbRun(
      'UPDATE lines SET name = ?, start_point = ?, end_point = ? WHERE id = ?',
      [name, start_point, end_point, lineId]
    );

    // Delete existing stations
    await dbRun('DELETE FROM stations WHERE line_id = ?', [lineId]);

    // Insert new stations
    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      await dbRun(
        'INSERT INTO stations (line_id, name, sequence_order, latitude, longitude, eta_offset_mins) VALUES (?, ?, ?, ?, ?, ?)',
        [lineId, st.name, i + 1, st.latitude, st.longitude, st.eta_offset_mins || 0]
      );
    }
    await dbRun('COMMIT;');
    res.json({ success: true });
  } catch (error) {
    await dbRun('ROLLBACK;');
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/lines/:id', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    await dbRun('DELETE FROM lines WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Active Trips Admin/General List
app.get('/api/admin/trips', authMiddleware, async (req, res) => {
  try {
    const trips = await dbAll(`
      SELECT t.*, l.name as line_name, u.name as driver_name, b.bus_number
      FROM trips t
      JOIN lines l ON t.line_id = l.id
      JOIN users u ON t.driver_id = u.id
      JOIN buses b ON t.bus_id = b.id
      ORDER BY t.id DESC
    `);
    res.json(trips);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/trips', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  const { line_id, driver_id, bus_id } = req.body;
  if (!line_id || !driver_id || !bus_id) {
    return res.status(400).json({ error: 'الرجاء ملء جميع بيانات الرحلة المجدولة' });
  }
  try {
    // Check if driver already has an active or scheduled trip
    const activeDriver = await dbGet("SELECT id FROM trips WHERE driver_id = ? AND status != 'completed'", [driver_id]);
    if (activeDriver) {
      return res.status(400).json({ error: 'السائق لديه رحلة نشطة أو مجدولة بالفعل (Driver has an active/scheduled trip)' });
    }

    // Check if bus is already in use
    const activeBus = await dbGet("SELECT id FROM trips WHERE bus_id = ? AND status != 'completed'", [bus_id]);
    if (activeBus) {
      return res.status(400).json({ error: 'الحافلة مستخدمة حالياً في رحلة أخرى (Bus is already active)' });
    }

    const result = await dbRun(
      "INSERT INTO trips (line_id, driver_id, bus_id, status) VALUES (?, ?, ?, 'scheduled')",
      [line_id, driver_id, bus_id]
    );
    res.json({ id: result.lastID, line_id, driver_id, bus_id, status: 'scheduled' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/trips/:id', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    await dbRun('DELETE FROM trips WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// --- DRIVER ENDPOINTS ---

app.get('/api/driver/trips', authMiddleware, roleMiddleware(['driver']), async (req, res) => {
  try {
    // Get scheduled or active trip for driver
    const trips = await dbAll(`
      SELECT t.*, l.name as line_name, l.start_point, l.end_point, b.bus_number, b.plate_number
      FROM trips t
      JOIN lines l ON t.line_id = l.id
      JOIN buses b ON t.bus_id = b.id
      WHERE t.driver_id = ? AND t.status != 'completed'
    `, [req.user.id]);
    
    // Add stations to trips
    for (let trip of trips) {
      trip.stations = await dbAll('SELECT * FROM stations WHERE line_id = ? ORDER BY sequence_order ASC', [trip.line_id]);
      
      // Get already arrived stations for active trip
      if (trip.status === 'active') {
        trip.arrivals = await dbAll('SELECT station_id, actual_arrival_time FROM trip_station_arrivals WHERE trip_id = ?', [trip.id]);
        trip.alerts = await dbAll(`
          SELECT d.*, u.name as passenger_name, s.name as station_name 
          FROM delay_alerts d
          JOIN users u ON d.passenger_id = u.id
          JOIN stations s ON d.station_id = s.id
          WHERE d.trip_id = ?
        `, [trip.id]);
      } else {
        trip.arrivals = [];
        trip.alerts = [];
      }
    }
    res.json(trips);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/driver/start-trip', authMiddleware, roleMiddleware(['driver']), async (req, res) => {
  const { trip_id } = req.body;
  try {
    const trip = await dbGet('SELECT * FROM trips WHERE id = ? AND driver_id = ?', [trip_id, req.user.id]);
    if (!trip) {
      return res.status(404).json({ error: 'الرحلة غير موجودة (Trip not found)' });
    }

    const firstStation = await dbGet('SELECT latitude, longitude FROM stations WHERE line_id = ? ORDER BY sequence_order ASC LIMIT 1', [trip.line_id]);
    const startLat = firstStation ? firstStation.latitude : null;
    const startLng = firstStation ? firstStation.longitude : null;

    const startTime = new Date().toISOString();
    await dbRun(
      "UPDATE trips SET status = 'active', start_time = ?, current_latitude = ?, current_longitude = ? WHERE id = ?",
      [startTime, startLat, startLng, trip_id]
    );

    // Notify admins and passengers of start
    io.emit('trip_started', { trip_id, line_id: trip.line_id, start_time: startTime, current_latitude: startLat, current_longitude: startLng });

    res.json({ success: true, status: 'active', start_time: startTime, current_latitude: startLat, current_longitude: startLng });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/driver/arrive-station', authMiddleware, roleMiddleware(['driver']), async (req, res) => {
  const { trip_id, station_id } = req.body;
  try {
    const time = new Date().toISOString();
    
    // Check if already registered
    const existing = await dbGet('SELECT id FROM trip_station_arrivals WHERE trip_id = ? AND station_id = ?', [trip_id, station_id]);
    if (!existing) {
      await dbRun(
        'INSERT INTO trip_station_arrivals (trip_id, station_id, actual_arrival_time) VALUES (?, ?, ?)',
        [trip_id, station_id, time]
      );
    }

    // Fetch station name
    const station = await dbGet('SELECT name, sequence_order, latitude, longitude FROM stations WHERE id = ?', [station_id]);

    // Update current location to match the station coordinates
    if (station) {
      await dbRun(
        'UPDATE trips SET current_latitude = ?, current_longitude = ? WHERE id = ?',
        [station.latitude, station.longitude, trip_id]
      );
    }

    // Broadcast update
    io.to(`trip_${trip_id}`).emit('station_arrived', { trip_id, station_id, station_name: station ? station.name : '', sequence_order: station ? station.sequence_order : 0, actual_arrival_time: time });
    io.emit('admin_location_update', { trip_id, current_latitude: station.latitude, current_longitude: station.longitude });
    io.emit('admin_station_arrived', { trip_id, station_id, actual_arrival_time: time });

    res.json({ success: true, actual_arrival_time: time });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/driver/end-trip', authMiddleware, roleMiddleware(['driver']), async (req, res) => {
  const { trip_id } = req.body;
  try {
    const endTime = new Date().toISOString();
    await dbRun(
      "UPDATE trips SET status = 'completed', end_time = ? WHERE id = ? AND driver_id = ?",
      [endTime, trip_id, req.user.id]
    );

    // Broadcast end
    io.to(`trip_${trip_id}`).emit('trip_completed', { trip_id, end_time: endTime });
    io.emit('admin_trip_completed', { trip_id, end_time: endTime });

    res.json({ success: true, status: 'completed', end_time: endTime });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/driver/delay-response', authMiddleware, roleMiddleware(['driver']), async (req, res) => {
  const { alert_id, response } = req.body; // response: 'waiting' or 'rejected'
  try {
    const alert = await dbGet('SELECT * FROM delay_alerts WHERE id = ?', [alert_id]);
    if (!alert) {
      return res.status(404).json({ error: 'طلب التنبيه غير موجود (Alert not found)' });
    }

    await dbRun('UPDATE delay_alerts SET driver_response = ? WHERE id = ?', [response, alert_id]);

    // Broadcast reply
    io.to(`trip_${alert.trip_id}`).emit('delay_alert_replied', { alert_id, response, passenger_id: alert.passenger_id });
    io.emit('admin_delay_alert_replied', { alert_id, response });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// --- ADMIN PASSENGERS & SUBSCRIPTIONS ENDPOINTS ---

// Get all passengers with their registrations
app.get('/api/admin/passengers', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    const passengers = await dbAll("SELECT id, name, email, phone FROM users WHERE role = 'passenger'");
    for (let p of passengers) {
      p.subscriptions = await dbAll(`
        SELECT r.id as reg_id, r.line_id, r.station_id, l.name as line_name, s.name as station_name 
        FROM passenger_registrations r 
        JOIN lines l ON r.line_id = l.id 
        JOIN stations s ON r.station_id = s.id 
        WHERE r.passenger_id = ?
      `, [p.id]);
    }
    res.json(passengers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new passenger user
app.post('/api/admin/passengers', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'الرجاء ملء كافة البيانات المطلوبة' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await dbRun(
      "INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, 'passenger')",
      [name, email, phone, hashedPassword]
    );
    res.json({ id: result.lastID, name, email, phone, role: 'passenger', subscriptions: [] });
  } catch (error) {
    res.status(400).json({ error: 'البريد الإلكتروني مسجل بالفعل (Email already registered)' });
  }
});

// Update passenger profile details
app.put('/api/admin/passengers/:id', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  const { name, email, phone, password } = req.body;
  try {
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await dbRun(
        "UPDATE users SET name = ?, email = ?, phone = ?, password = ? WHERE id = ? AND role = 'passenger'",
        [name, email, phone, hashedPassword, req.params.id]
      );
    } else {
      await dbRun(
        "UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ? AND role = 'passenger'",
        [name, email, phone, req.params.id]
      );
    }
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete passenger
app.delete('/api/admin/passengers/:id', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    await dbRun("DELETE FROM users WHERE id = ? AND role = 'passenger'", [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add route/station subscription for a passenger
app.post('/api/admin/passengers/:id/subscriptions', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  const { line_id, station_id } = req.body;
  const passengerId = req.params.id;
  if (!line_id || !station_id) {
    return res.status(400).json({ error: 'الرجاء تحديد الخط والمحطة' });
  }
  try {
    const result = await dbRun(
      'INSERT INTO passenger_registrations (passenger_id, line_id, station_id) VALUES (?, ?, ?)',
      [passengerId, line_id, station_id]
    );
    
    // Fetch details
    const sub = await dbGet(`
      SELECT r.id as reg_id, r.line_id, r.station_id, l.name as line_name, s.name as station_name 
      FROM passenger_registrations r 
      JOIN lines l ON r.line_id = l.id 
      JOIN stations s ON r.station_id = s.id 
      WHERE r.id = ?
    `, [result.lastID]);

    res.json(sub);
  } catch (error) {
    res.status(400).json({ error: 'الراكب مشترك بالفعل في هذا الخط (Passenger already registered to this line)' });
  }
});

// Delete subscription for passenger
app.delete('/api/admin/passengers/subscriptions/:sub_id', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    await dbRun('DELETE FROM passenger_registrations WHERE id = ?', [req.params.sub_id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// --- PASSENGER ENDPOINTS ---

app.get('/api/passenger/registration', authMiddleware, roleMiddleware(['passenger']), async (req, res) => {
  try {
    const registrations = await dbAll(
      'SELECT r.*, l.name as line_name, s.name as station_name FROM passenger_registrations r JOIN lines l ON r.line_id = l.id JOIN stations s ON r.station_id = s.id WHERE r.passenger_id = ?',
      [req.user.id]
    );
    res.json(registrations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/passenger/registration', authMiddleware, roleMiddleware(['passenger']), async (req, res) => {
  const { line_id, station_id } = req.body;
  if (!line_id || !station_id) {
    return res.status(400).json({ error: 'الرجاء تحديد الخط والمحطة المفضلة (Missing parameters)' });
  }

  try {
    // Try updating first, if not exists insert
    const existing = await dbGet('SELECT id FROM passenger_registrations WHERE passenger_id = ? AND line_id = ?', [req.user.id, line_id]);
    if (existing) {
      await dbRun('UPDATE passenger_registrations SET station_id = ? WHERE id = ?', [station_id, existing.id]);
    } else {
      await dbRun(
        'INSERT INTO passenger_registrations (passenger_id, line_id, station_id) VALUES (?, ?, ?)',
        [req.user.id, line_id, station_id]
      );
    }

    const registrations = await dbAll(
      'SELECT r.*, l.name as line_name, s.name as station_name FROM passenger_registrations r JOIN lines l ON r.line_id = l.id JOIN stations s ON r.station_id = s.id WHERE r.passenger_id = ?',
      [req.user.id]
    );
    res.json(registrations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get active trip for a line
app.get('/api/passenger/active-trip/:line_id', authMiddleware, async (req, res) => {
  const lineId = req.params.line_id;
  try {
    const trip = await dbGet(`
      SELECT t.*, u.name as driver_name, u.phone as driver_phone, b.bus_number, b.plate_number
      FROM trips t
      JOIN users u ON t.driver_id = u.id
      JOIN buses b ON t.bus_id = b.id
      WHERE t.line_id = ? AND t.status = 'active'
      LIMIT 1
    `, [lineId]);

    if (!trip) {
      return res.json(null);
    }

    // Add stations
    trip.stations = await dbAll('SELECT * FROM stations WHERE line_id = ? ORDER BY sequence_order ASC', [lineId]);
    // Add actual arrival times
    trip.arrivals = await dbAll('SELECT station_id, actual_arrival_time FROM trip_station_arrivals WHERE trip_id = ?', [trip.id]);
    
    // Add delay alert sent by THIS passenger on this trip (if any)
    trip.my_delay_alert = await dbGet(
      'SELECT * FROM delay_alerts WHERE trip_id = ? AND passenger_id = ? ORDER BY id DESC LIMIT 1',
      [trip.id, req.user.id]
    );

    res.json(trip);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/passenger/delay-alert', authMiddleware, roleMiddleware(['passenger']), async (req, res) => {
  const { trip_id, station_id, delay_mins } = req.body;
  if (!trip_id || !station_id || !delay_mins) {
    return res.status(400).json({ error: 'معلومات غير كاملة لإرسال إشعار التأخر (Missing parameters)' });
  }

  try {
    // Anti-Spam: Rate limiting of 1 delay alert per passenger per trip
    const existing = await dbGet('SELECT id FROM delay_alerts WHERE trip_id = ? AND passenger_id = ?', [trip_id, req.user.id]);
    if (existing) {
      return res.status(429).json({ error: 'عذراً، يمكنك إرسال إشعار تأخر واحد فقط لكل رحلة (Only one delay alert allowed per trip)' });
    }

    const time = new Date().toISOString();
    const result = await dbRun(
      'INSERT INTO delay_alerts (trip_id, passenger_id, station_id, delay_mins, driver_response, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [trip_id, req.user.id, station_id, delay_mins, 'pending', time]
    );

    const alertId = result.lastID;
    const station = await dbGet('SELECT name FROM stations WHERE id = ?', [station_id]);

    const broadcastData = {
      id: alertId,
      trip_id,
      passenger_id: req.user.id,
      passenger_name: req.user.name,
      station_id,
      station_name: station ? station.name : '',
      delay_mins,
      driver_response: 'pending',
      created_at: time
    };

    // Broadcast to Driver & Admins
    io.to(`trip_${trip_id}`).emit('delay_alert_received', broadcastData);
    io.emit('admin_delay_alert_received', broadcastData);

    res.json(broadcastData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// --- WEB SOCKET CONNECTIONS ---

io.on('connection', (socket) => {
  let user = null;

  // Authenticate socket connection
  socket.on('authenticate', (token) => {
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        socket.emit('unauthorized', 'رمز التحقق غير صالح (Invalid token)');
        return;
      }
      user = decoded;
      socket.emit('authenticated', { name: user.name, role: user.role });

      // Join standard rooms based on role
      if (user.role === 'admin') {
        socket.join('admin');
        console.log(`Admin joined socket room: ${user.name}`);
      }
    });
  });

  // Client requests to join a trip room
  socket.on('join_trip', (tripId) => {
    socket.join(`trip_${tripId}`);
    console.log(`Socket joined room trip_${tripId}`);
  });

  // Client requests to leave a trip room
  socket.on('leave_trip', (tripId) => {
    socket.leave(`trip_${tripId}`);
    console.log(`Socket left room trip_${tripId}`);
  });

  // Driver broadcasts real-time GPS location updates
  socket.on('driver_location', (data) => {
    // data should contain: { tripId, latitude, longitude }
    if (!user || user.role !== 'driver') {
      return;
    }
    
    // Secure Location Check: verify if this trip belongs to this driver
    dbGet('SELECT driver_id FROM trips WHERE id = ?', [data.tripId], (err, row) => {
      if (err || !row || row.driver_id !== user.id) {
        console.warn(`Unauthorized location post attempt by user ${user.id} for trip ${data.tripId}`);
        return;
      }

      // Update current position in trips table
      dbRun('UPDATE trips SET current_latitude = ?, current_longitude = ? WHERE id = ?', [
        data.latitude,
        data.longitude,
        data.tripId
      ]);

      // Broadcast to passengers following the trip
      io.to(`trip_${data.tripId}`).emit('location_updated', {
        tripId: data.tripId,
        latitude: data.latitude,
        longitude: data.longitude
      });

      // Broadcast to admins
      io.to('admin').emit('admin_location_update', {
        tripId: data.tripId,
        latitude: data.latitude,
        longitude: data.longitude
      });
    });
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});


// Start server after initializing DB
initDb().then(() => {
  server.listen(PORT, () => {
    console.log(`BusTrack server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
});
