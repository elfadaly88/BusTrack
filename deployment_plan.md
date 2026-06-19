# خطة نشر نظام تتبع الحافلات (BusTrack Deployment Plan)

هذه وثيقة خطة نشر وتدشين النظام ليعمل على خادم سحابي عام ليكون متاحاً لجميع المستخدمين (المسؤول، السائق، الراكب) عبر الإنترنت.

---

## 📋 المتطلبات التقنية الخاصة بالنظام عند النشر

نظرًا لأن تطبيق **BusTrack** يعتمد على تقنيتين رئيسيتين:
1. **SQLite (`bustrack.db`)**: قاعدة بيانات ملفية محلية. عند النشر على منصات سحابية حاوية (مثل Render أو Railway أو Heroku)، يتم مسح أي ملف يتم إنشاؤه أثناء التشغيل بمجرد إعادة تشغيل الحاوية (Ephemeral filesystem). لذلك **نحتاج إلى مساحة تخزين مستمرة (Persistent Volume/Disk)** لحفظ ملف قاعدة البيانات بشكل دائم.
2. **WebSockets (Socket.io)**: تتطلب خادماً يدعم الاتصالات المستمرة ذات الاتجاهين (Stateful connections). بعض خدمات Serverless (مثل Vercel) لا تدعم اتصالات الـ WebSockets المستمرة، لذا يجب النشر على سيرفر Node.js كامل.

---

## 🛠️ الخيارات المقترحة للنشر (Hosting Options)

### 1️⃣ الخيار الأول: منصة Render (الخيار الأسهل والاقتصادي)
منصة سحابية ممتازة تمكنك من النشر مباشرة عبر ربط حساب GitHub الخاص بك.

* **المميزات**:
  * ربط تلقائي مع GitHub (نشر تلقائي بمجرد عمل Commit/Push للفرع الرئيسي).
  * توفر قرص تخزين مستمر (Persistent Disk) بسعر رمزي جداً (حوالي 1$ شهرياً).
  * شهادة أمان SSL (HTTPS) مجانية وتلقائية.
* **خطوات النشر على Render**:
  1. إنشاء حساب على [Render.com](https://render.com) وربطه بـ GitHub.
  2. إنشاء **Web Service** جديدة واختيار مستودع `BusTrack`.
  3. تعيين الإعدادات التالية:
     * **Runtime**: `Node`
     * **Build Command**: `npm install`
     * **Start Command**: `node server.js`
  4. في إعدادات الخدمة، اذهب إلى تبويب **Disks** وأضف قرصاً جديداً:
     * **Mount Path**: `/data`
     * **Size**: `1 GB` (كافٍ جداً لملايين السجلات لـ SQLite).
  5. تعيين متغيرات البيئة (Environment Variables) في تبويب **Environment**:
     * `PORT` = `10000` (أو أي منفذ يحدده Render تلقائياً).
     * `JWT_SECRET` = `سلسلة_نصية_عشوائية_وقوية_جداً_للأمان`
     * `DB_PATH` = `/data/bustrack.db` (توجيه قاعدة البيانات لتخزن في القرص المستمر دائم الحفظ).

---

### 2️⃣ الخيار الثاني: سيرفر خاص افتراضي (VPS) مثل DigitalOcean / Hetzner / OVH
تأجير سيرفر خاص بنظام Linux (Ubuntu) وتثبيت التطبيق عليه يدوياً أو باستخدام Docker.

* **المميزات**:
  * تحكم كامل 100% في السيرفر وموارد النظام.
  * أداء ممتاز وبدون حدود للاتصالات المستمرة لـ WebSockets.
  * سعر ثابت (يبدأ من 4$ إلى 5$ شهرياً).
* **خطوات النشر على VPS باستخدام PM2 (مدير عمليات Node.js)**:
  1. الدخول على السيرفر عبر SSH وتثبيت Node.js و Git.
  2. تثبيت أداة PM2 لإبقاء التطبيق يعمل في الخلفية بشكل دائم حتى لو تمت إعادة تشغيل السيرفر:
     ```bash
     npm install -g pm2
     ```
  3. سحب كود المشروع من GitHub إلى السيرفر:
     ```bash
     git clone https://github.com/elfadaly88/BusTrack.git
     ```
  4. إنشاء ملف بيئة `.env` ووضع المتغيرات فيه (`PORT`, `JWT_SECRET`, `DB_PATH`).
  5. تشغيل التطبيق بواسطة PM2:
     ```bash
     pm2 start server.js --name "bustrack"
     pm2 save
     pm2 startup
     ```
  6. تثبيت Nginx كـ Reverse Proxy لتوجيه حركة المرور وتأمين التطبيق بشهادة SSL مجانية عبر Certbot/Let's Encrypt.

---

### 3️⃣ الخيار الثالث: خادم أوراكل السحابي (Oracle Cloud Infrastructure - OCI) [مجاني بالكامل!]
توفر أوراكل باقة **"OCI Always Free"** والتي تتيح خوادم افتراضية (Compute VMs) مجانية تماماً مدى الحياة، مما يجعلها الخيار المثالي لنشر هذا التطبيق دون أي تكلفة مادية!

* **المميزات**:
  * مجاني تماماً 100% مدى الحياة (سيرفر كامل مع عنوان IP عام).
  * قرص تخزين دائم (Block Volume) مجاني لحفظ قاعدة البيانات.
  * أداء عالٍ جداً للـ WebSockets ومكتبات Node.js.
* **خطوات النشر على Oracle Cloud**:
  1. تسجيل الدخول إلى لوحة تحكم [Oracle Cloud](https://cloud.oracle.com).
  2. إنشاء خادم افتراضي جديد (**Create VM Instance**):
     * **Image**: `Canonical Ubuntu` (مثال: Ubuntu 22.04).
     * **Shape**: `VM.Standard.E4.Micro` (معالج AMD المجاني) أو معالج `VM.Standard.A1.Flex` (ARM المجاني).
     * **Networking**: تأكد من توليد وحفظ مفاتيح الـ SSH للدخول للسيرفر، وتخصيص Public IP.
  3. **تهيئة جدار الحماية (Security List)** في Oracle Cloud لفتح المنفذ:
     * اذهب إلى شبكة السيرفر (VCN) -> Security Lists -> Ingress Rules.
     * أضف قاعدة جديدة لفتح منفذ الويب العام:
       * **Source CIDR**: `0.0.0.0/0`
       * **IP Protocol**: `TCP`
       * **Destination Port Range**: `80, 443, 3000` (منفذ الويب العام ومنفذ التطبيق).
  4. الدخول إلى السيرفر عبر SSH وفتح جدار حماية نظام التشغيل الداخلي (لأن أوراكل تفعل جدار حماية iptables افتراضياً):
     ```bash
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
     sudo netfilter-persistent save
     ```
  5. تثبيت Node.js و Git وسحب الكود وتفعيل PM2 (نفس خطوات السيرفر الخاص VPS الموضحة أعلاه).

---

## 📈 التغييرات المطلوبة في الكود قبل النشر (Code Readiness)

لنجعل الكود جاهزاً تماماً لأي بيئة نشر، سنقوم بالخطوات التالية:
1. **تحديث ملف [db.js](file:///f:/PrivateWork/BusTrack/db.js)** لقراءة مسار قاعدة البيانات من متغير البيئة `process.env.DB_PATH` وإذا لم يكن موجوداً يقع افتراضياً على المسار المحلي الحالي.
2. **تحديث ملف [server.js](file:///f:/PrivateWork/BusTrack/server.js)** لقراءة الـ `JWT_SECRET` والـ `PORT` من متغيرات البيئة لضمان عدم كشف كلمات المرور والمفاتيح السرية في مستودع GitHub العام.
