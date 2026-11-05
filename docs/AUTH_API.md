# Login، Session او Logout — ساده پښتو لارښود

نېټه: ۲۰۲۶-۱۱-۰۵

هر بریالی signin اوس خپل `AuthSession` لري. د هماغه login token د `sid`
په وسیله session ته نښلي. له logout وروسته هماغه session بندېږي او token
بیا protected لارو ته لاسرسی نه لري. د حساب نور loginونه فعال پاتې کېږي.

## ۱. Session څه شی دی؟

Session د یوه login ریکارډ دی، لکه په Postman یا یوه وسیله کې ننوتل.
په MongoDB کې `authsessions` collection دا معلومات ساتي:

| Field | معنا |
| --- | --- |
| `user` | د User حساب ID |
| `expiresAt` | د login د اعتبار پای؛ نږدې یو ساعت |
| `revokedAt` | د logout وخت؛ په فعال session کې `null` |
| `createdAt` / `updatedAt` | د ریکارډ د ثبت او بدلون وختونه |

خام token او password په دې collection کې نه ساتل کېږي. JWT د `id`،
`sid`، `iat` او `exp` معلومات لري او د `HS256` په وسیله لاسلیک کېږي.
د هر signin نوی session ID د هماغه حساب tokenونه له یو بل څخه جلا کوي.

د JWT یا session له اعتبار څخه چې کوم یو لومړی ختم شي، لاسرسی بندېږي.
MongoDB د TTL index په وسیله ختم شوي sessions وروسته پاکوي؛ دا background
پاکول سمدستي نه وي. `protect` د نېټې چک په هره غوښتنه کې سمدستي کوي.

## ۲. کوم فایلونه بدل شوي؟

- `models/AuthSession.js`: له User سره د session اړیکه او د اعتبار وختونه.
- `controller/authController.js`: signin session جوړوي او logout یې بندوي.
- `middleware/authMiddleware.js`: JWT، session او د User موجودیت چک کوي.
- `routes/authRoutes.js`: د logout لاره او `Cache-Control: no-store`.
- `controller/authController.test.js`: د login او logout د سم کار ازموینې.

د signin ترتیب: input validation → password چک → session او token جوړول →
session په DB کې ثبتول → ځواب. که token جوړ نه شي یا session ثبت نه شي،
signin بریالی ځواب او token نه لېږي.

د protected غوښتنې ترتیب:

```text
Bearer token → JWT signature/expiry → sid → active AuthSession → User → role → controller
```

د ساده لوستلو لپاره لومړی model، بیا `signin`، وروسته `protect` او په پای
کې `logout` ولولئ. `req.authSession` د سرور له چک څخه راځي؛ د client له
Body څخه نه اخیستل کېږي. Logout د هماغه ریکارډ `revokedAt` بدلوي.

## ۳. موجودې auth لارې

Base URL: `http://localhost:5000`.

| Method | Endpoint | موخه |
| --- | --- | --- |
| POST | `/api/auth/signup` | نوی حساب؛ خپل پخوانی role انتخاب ساتي |
| POST | `/api/auth/signin` | ننوتل، نوی session او token |
| POST | `/api/auth/logout` | د اوسني token session بندول |
| GET | `/api/auth/me` | د ننوتلي حساب معلومات |
| GET | `/api/auth/admin` | د hospital_admin د اجازې چک |
| POST | `/api/auth/users` | د اډمین له خوا حساب جوړول |

Signup یوازې User جوړوي؛ د token لپاره signin پکار دی. د signin ځواب خپل
پخواني `message`، `token` او `user` fields ساتي. ټول auth ځوابونه `no-store`
دي. د logout لپاره هر رول خپل معتبر token کارولای شي.

## ۴. پخواني tokenونه

له دې بدلون مخکې tokenونه `sid` نه لري. له server restart وروسته هغوی
protected لارو ته **401** ورکوي. د خپل موجود حساب په email/password یو ځل
بیا signin وکړئ او نوی token وکاروئ. د User، Patient، Doctor، Appointment
یا Prescription معلوماتو پاکولو ته اړتیا نشته.

## ۵. په Postman کې ازموینه

د Backend په Terminal کې:

```powershell
npm run dev
```

لومړی signin وکړئ. **Body → raw → JSON** وټاکئ او د خپل موجود حساب email
او password ورکړئ؛ لاندې یوازې خیالي مثال دی:

```http
POST http://localhost:5000/api/auth/signin
```

```json
{
  "email": "patient@example.test",
  "password": "ExamplePassphrase123!"
}
```

تمه: **200 OK** او `Signin successful`. له ځواب څخه `token` کاپي کړئ؛ دې ته
دلته **Token A** وایو. په لاندې غوښتنو کې **Authorization → Bearer Token**
وټاکئ او همدا token پکې واچوئ.

خپل حساب وګورئ:

```http
GET http://localhost:5000/api/auth/me
```

تمه: **200 OK** او `user` معلومات. GET ته Body مه لېږئ.

اوس په هماغه Token A logout وکړئ؛ Body نه غواړي:

```http
POST http://localhost:5000/api/auth/logout
```

تمه: **200 OK**:

```json
{
  "message": "Logout successful"
}
```

بیا هماغه Token A د `/api/auth/me` لپاره وکاروئ. تمه: **401 Unauthorized**:

```json
{
  "message": "Your session has ended. Please signin again"
}
```

له همدې token سره دوهم logout هم **401** ورکوي. د بیا کار لپاره signin
وکړئ او نوی token واخلئ. دا هماغه پخواني حساب ته نوی session جوړوي.

## ۶. دوه loginونه جلا وازمویئ

1. په یوه حساب signin وکړئ او Token A وساتئ.
2. بیا په هماغه حساب signin وکړئ او Token B وساتئ.
3. د A په وسیله `/api/auth/logout` ولېږئ؛ **200**.
4. د A په وسیله `/api/auth/me` ولېږئ؛ **401**.
5. د B په وسیله `/api/auth/me` ولېږئ؛ **200**.

Logout یوازې د هماغه token session بندوي. په Body کې د بل `sid`، `sessionId`
یا `userId` لېږل د بل login واک نه درکوي؛ اوسنی session له token اخیستل کېږي.

## ۷. خطاګانې او حدود

- ناسم password یا ناموجود حساب: **401**؛ session نه جوړېږي.
- ناسم input: **400**؛ session نه جوړېږي.
- ورک، ناسم، ختم شوی یا revoked token/session: **401**.
- session باید د هماغه JWT د User حساب وي؛ د بل حساب session نه منل کېږي.
- د DB چک یا د logout ثبت ناکامي: **500**؛ سرور بریالی logout نه اعلانوي.
  بیا غوښتنه ولېږئ. د session د چک پر ناکامۍ لاسرسی نه ورکول کېږي.
- Logout بشپړ شویو عملیاتو ته بدلون نه ورکوي. راتلونکې protected غوښتنې
  نوی session چک کوي؛ هغه request چې مخکې یې اجازه اخیستې وي ښايي پای ته ورسېږي.

Refresh-token rotation، د sessions لېست، د بل خپل session لغوه کول، د ټول
User حساب فعال/غیرفعال حالت، عمومي audit او staff approval لا پاتې دي.
دا بدلون د public signup د role انتخاب پخوانی قرارداد نه بدلوي. د Doctor
پروفایل `isActive` خپل موجود محدودیتونه لري؛ د User عمومي بندول جلا کار دی.

## ۸. اتومات ازموینې

```powershell
npm test
```

د auth/session suite **۳۳** ازموینې لري. له **۵۳ doctor**، **۲۶ appointment**
او **۲۷ Medical Records** سره ټولې **۱۳۹** بریالۍ شوې دي. د ملاقاتونو fixtures هم
د اصلي signin له لارې session لرونکي tokenونه اخلي.

ازموینې د ټولو رولونو logout، جلا loginونه، revoke/expiry، پخواني tokenونه،
د User/session اړیکه، ټول protected API groups، concurrent logout او د DB
د ناکامۍ حالتونه پوښي. هر suite خپل temporary MongoDB او خیالي معلومات
کاروي؛ د عادي application `.env` نه لولي او عادي DB نه پاکوي.
