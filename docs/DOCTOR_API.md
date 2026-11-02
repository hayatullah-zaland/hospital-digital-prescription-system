# Doctor Management — د Postman لارښود

دا module د موجود `doctor` login حساب لپاره مسلکي profile جوړوي. دا د
login پر ځای جلا حساب نه دی. ټول endpointونه Bearer token غواړي.

فایلونه: `models/Doctor.js`، `middleware/doctorValidation.js`،
`controller/doctorController.js` او `routes/doctorRoutes.js`.
Server یې په `/api/doctors` کې نښلوي.

## د کوډ د لوستلو ساده لار

لومړی `models/Doctor.js` وګورئ: هلته لیکل شوي چې د ډاکټر کوم معلومات
په DB کې ساتو، لکه تخصص، څانګه او کاري وختونه. هر field په جلا کرښو لیکل شوی.

بیا په `controller/doctorController.js` کې `createDoctor` ولولئ:

1. له `req.body` څخه د Postman لېږل شوي معلومات اخلي.
2. د `User.findById(userId)` په وسیله حساب پیدا کوي او د doctor رول یې ګوري.
3. د `Doctor.create(...)` په وسیله پروفایل په DB کې ثبتوي.
4. د `res.status(201).json(...)` په وسیله ځواب بېرته لېږي.

`await` د DB د کار پای ته انتظار کوي. `trim()` د متن د سر او پای اضافي تشې
لرې کوي. `populate('user', 'name')` د نښلول شوي حساب نوم راوړي.

په `updateDoctor` کې هر field خپل `if` شرط لري. د بېلګې په توګه:

```js
if (specialization !== undefined) {
  doctor.specialization = specialization.trim();
}
```

یعنې که specialization مو لېږلی وي، هغه بدلوي. که مو نه وي لېږلی،
پخوانی تخصص ساتي. په پای کې `doctor.save()` بدلونونه DB ته لېږي.

د غوښتنې مسیر داسې دی:

```text
Postman → route → protect → allowRoles → validation → controller → model → DB
```

`protect` token ګوري، `allowRoles` رول ګوري، او `doctorValidation.js`
د `validator` په وسیله د Body معلومات چک کوي. که معلومات سم وي، `next()`
بل فنکشن چلوي؛ که ناسم وي، **400** ځواب لېږي. د وختونو په validation کې
عادي `for...of` لوپونه ګوري چې د یوې ورځې دوه کاري وختونه سره ګډ نه شي.

`req.params.doctorUserId` د URL ID دی؛ `req.query` د لټون او پاڼو معلومات دي،
لکه `?search=general&page=1`. د لېست `skip` تېرې پایلې پرېږدي او `limit`
د یوې پاڼې د پایلو شمېر ټاکي. د ازموینې فایل د همدې چلند د چک لپاره دی.

## ۱. د ډاکټر د حساب ID پیدا کول

که doctor حساب نه لرئ، په **Body > raw > JSON** کې یې ثبت کړئ:

```http
POST http://localhost:5000/api/auth/signup
```

```json
{
  "name": "Test Doctor",
  "email": "doctor@example.test",
  "password": "ExamplePassphrase123!",
  "role": "doctor"
}
```

له ځواب څخه `user.id` کاپي کړئ. که حساب مو مخکې جوړ کړی وي، د doctor په
token `GET /api/auth/me` ولېږئ او `user.id` واخلئ.

دا **doctorUserId** دی. وروسته د profile خپل `_id` د URL لپاره مه کاروئ.
د signup او signin role policy د پخواني کاروونکي له تصمیم سره سم ساتل شوې.

## ۲. د اډمین له خوا profile جوړول

په `POST /api/auth/signin` کې د خپل موجود administrator په email/password
ننوزئ. د هغه token په **Authorization > Bearer Token** کې واچوئ، بیا:

```http
POST http://localhost:5000/api/doctors
```

```json
{
  "userId": "PASTE_DOCTOR_USER_ID_HERE",
  "specialization": "General Medicine",
  "department": "Outpatient",
  "registrationNumber": "DEMO-001",
  "availability": [
    {
      "day": "saturday",
      "startTime": "08:00",
      "endTime": "12:00"
    }
  ],
  "isActive": true
}
```

`userId` په اصلي doctor user ID بدل کړئ. تمه: **201 Created** او
`message: "Doctor profile created successfully"`. په MongoDB کې `doctors`
collection ته ثبتېږي. `createdBy` له admin token څخه اخیستل کېږي.

`specialization` او `department` هر یو 2–100 حروف؛ `registrationNumber`
3–50 حروف غواړي. متن trim کېږي او registrationNumber uppercase ساتل کېږي.
یو user یو profile لري او registrationNumber هم unique دی. Duplicate **409**
ورکوي. ناموجود user **404**، او د غیر-doctor حساب ټاکل **400** ورکوي.

`availability` اختیاري دی، default یې `[]` دی. `isActive` default یې `true`
دی او باید JSON boolean وي؛ `"true"` یا `"false"` strings نه منل کېږي.

## ۳. د کتلو، لټون او سمون لارې

په ټولو مثالونو کې base URL `http://localhost:5000` دی.

| Method | Endpoint | لاسرسی |
| --- | --- | --- |
| POST | `/api/doctors` | یوازې hospital_admin |
| GET | `/api/doctors` | hospital_admin، receptionist، doctor |
| GET | `/api/doctors/DOCTOR_USER_ID` | مجاز staff؛ لاندې د inactive قاعده وګورئ |
| PATCH | `/api/doctors/DOCTOR_USER_ID` | admin یا د هماغه profile doctor |
| PATCH | `/api/doctors/DOCTOR_USER_ID/availability` | admin یا د هماغه profile doctor |

د لېست مثالونه:

```http
GET http://localhost:5000/api/doctors
GET http://localhost:5000/api/doctors?search=General
GET http://localhost:5000/api/doctors?page=1&limit=5
GET http://localhost:5000/api/doctors?isActive=false
```

Search د doctor نوم، specialization او department کې case-insensitive
plain-text لټون کوي. Default limit 10 او max 50 دی. ځواب `doctors` او
`pagination` لري. د inactive لېست یوازې admin کتلی شي.

Receptionist او doctor directory کې یوازې active profiles ویني؛ په directory
او د نورو active profiles په ځواب کې registrationNumber او createdBy نه
ښودل کېږي. Doctor خپل بشپړ profile، حتی inactive، کتلی شي. Admin ټول
profiles کتلی شي. د user له معلوماتو یوازې `_id` او `name` ورکول کېږي.

## ۴. Partial update

Admin کولای شي specialization، department، registrationNumber، availability
او isActive بدل کړي. Doctor یوازې خپل specialization او availability بدلوي.
د بل doctor profile سمول **404** ورکوي؛ administrative fields د doctor
له خوا بدلول **403** ورکوي. `user` او `createdBy` د بدلون وړ نه دي.

د doctor په خپل token:

```http
PATCH http://localhost:5000/api/doctors/DOCTOR_USER_ID
```

```json
{
  "specialization": "Updated Demo Specialty"
}
```

تمه: **200 OK** او `message: "Doctor profile updated successfully"`.
نه لېږل شوي fields خپل پخواني معلومات ساتي. Empty body او ناپېژندل شوي
fields **400** ورکوي. د هممهاله stale edit په صورت کې **409**، بیا profile
له سره راواخلئ او خپل بدلون ولېږئ.

## ۵. کاري وختونه

```http
PATCH http://localhost:5000/api/doctors/DOCTOR_USER_ID/availability
```

```json
{
  "availability": [
    {
      "day": "monday",
      "startTime": "09:00",
      "endTime": "13:00"
    }
  ]
}
```

دا ټول weekly availability لېست بدلوي. د ټولو مطلوبو ورځو/وختونو بشپړ
لېست ولېږئ؛ د پاکولو لپاره `"availability": []` وکاروئ. دا endpoint یوازې
`availability` field مني. د عمومي PATCH له لارې یې هم بدلولای شئ.

ورځې په lowercase دي: `saturday`، `sunday`، `monday`، `tuesday`،
`wednesday`، `thursday` او `friday`. وختونه د کابل د محلي وخت له مخې
په 24-hour `HH:mm` بڼه دي. تر 28 time periods پورې منل کېږي. هر period
باید په هماغه ورځ تر شروع وروسته ختم شي؛ overnight shift نه منل کېږي.
د یوې ورځې periods یو پر بل نه اوړي؛ پرله‌پسې `08:00–10:00` او
`10:00–12:00` منل کېږي. د ملاقات available slots راتلونکی پړاو دی.

## ۶. فعال/غیرفعال حالت

Admin د عمومي PATCH له لارې `{"isActive": false}` لېږي. غیرفعال profile
په عادي directory کې نه ښکاري او هغه doctor نوې نسخه نه شي جوړولی (**403**).
پخوانۍ نسخې او history نه حذفېږي. Doctor خپل ځان فعالولای نه شي؛ admin
یې د `{"isActive": true}` په لېږلو بېرته فعالوي.

دا د Doctor profile حالت دی، د User حساب logout یا session revocation نه
دی. هغه جلا امنیتي پړاو لا پاتې دی. د پخوانیو doctor حسابونو لپاره چې
لا profile نه لري، د نسخې پخوانی flow ساتل شوی؛ اجباري profile migration
اوس نه دی پلي شوی.

## ۷. اتومات ازموینې

د Backend له فولډره:

```powershell
npm test
```

ازموینې په موجود `controller/doctorController.test.js` کې دي. `mongod`
باید په PATH کې وي؛ که نه وي، `MONGOD_BINARY` ته د executable بشپړ path
ورکړئ. ازموینه خپل local MongoDB په OS temporary directory کې چلوي، خیالي
حسابونه جوړوي او وروسته یې پاکوي. د عادي application `.env` نه لولي.

د profile CRUD، roles/ownership، duplicate registration، validation، literal
search، pagination، availability، stale saves او inactive prescribing checks
پکې شته. نوی project فولډر او نوی npm dependency نه دی اضافه شوی.
