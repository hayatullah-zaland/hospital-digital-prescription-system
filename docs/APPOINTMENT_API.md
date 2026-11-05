# ملاقاتونه — ساده تشریح او د Postman لارښود

دا د Appointment Management لومړۍ برخه ده. ټولې لارې Bearer token غواړي.
اډمین او receptionist ملاقات ثبتوي؛ ډاکټر یوازې خپل ملاقاتونه ګوري او خپله
معاینه پیل یا بشپړوي. د patient حساب لپاره دا لارې لا نه دي پرانیستل شوې؛
هغه د تایید شوي Patient حساب د لینک له جوړېدو وروسته راځي.

## ۱. فایلونه او اړیکې

- `models/Appointment.js`: د ملاقات معلومات او د بدلونونو تاریخچه.
- `middleware/appointmentValidation.js`: د `validator` په وسیله د input چک.
- `controller/appointmentController.js`: ثبت، لېست، کتنه او د حالت بدلون.
- `controller/appointmentScheduleController.js`: تش وختونه او reschedule.
- `controller/appointmentTime.js`: د ۳۰ دقیقو وختونه او د کابل د ورځې حساب.
- `routes/appointmentRoutes.js`: د ملاقات لارې او د رول اجازه.
- `routes/doctorRoutes.js`: د ډاکټر د تشو وختونو لاره.

`Appointment.patient` د `Patient._id` سره نښلي. `Appointment.doctor` د ډاکټر
د `User._id` سره نښلي؛ د Doctor پروفایل خپل `_id` دلته نه کاروو.
`createdBy` او د تاریخچې `actor` له token څخه اخیستل کېږي.

د غوښتنې مسیر:

```text
Postman → route → protect → allowRoles → validation → controller → Appointment → MongoDB
```

د لوستلو لپاره لومړی model، بیا `createAppointment` وګورئ: ناروغ پیدا کوي،
فعال doctor profile ګوري، مناسب وخت پیدا کوي، او ملاقات ثبتوي.
`getWorkingSlots` یوازې د ډاکټر کاري وختونه په وړو وختونو وېشي؛ controller
له DB څخه نیول شوي وختونه راوباسي او له تش لېست څخه یې لرې کوي.

## ۲. د وخت قواعد

- په دې نسخه کې هر ملاقات **۳۰ دقیقې** دی؛ شروع یې `:00` یا `:30` وي.
- input د کابل محلي وخت دی: `date: YYYY-MM-DD` او `startTime: HH:mm`.
- DB کې `startAt` او `endAt` په UTC ساتل کېږي. مثلاً د کابل `09:00`
  په ځواب کې `04:30:00.000Z` کېږي؛ دا د هماغه وخت بله بڼه ده.
- وخت باید راتلونکی وي او په بشپړ ډول د ډاکټر په یوه weekly period کې راشي.
  د `08:10–10:10` لپاره `08:30`، `09:00` او `09:30` منل کېږي.
- د ۳۰ دقیقو اندازه په دې نسخه کې ثابته ده، settings لا نه لري. د دې اندازې
  راتلونکی بدلون باید د موجودو bookings د migration له ارزونې سره وشي.
- د هماغه ډاکټر یا ناروغ دوه فعال ملاقاتونه په یوه وخت کې نه ثبتېږي.
  MongoDB unique indexes حتی هممهاله requests کې **409** ورکوي.
- `scheduled`، `checked_in` او `in_progress` وخت نیسي. لغوه شوی ملاقات
  له تاریخچې سره پاتې کېږي او وخت یې بیا کارول کېدای شي.
- د doctor availability بدلون راتلونکي نوي bookings اغېزمنوي؛ پخواني
  ملاقاتونه په پټه نه بدلوي یا لغوه کوي. غیرفعال ډاکټر ته نوی booking او
  reschedule نه کېږي، خو د موجودو ملاقاتونو کتنه او اداري cancellation شته.

## ۳. API لارې او اجازې

Base URL: `http://localhost:5000`.

| Method | Endpoint | اجازه |
| --- | --- | --- |
| GET | `/api/doctors/DOCTOR_USER_ID/slots?date=YYYY-MM-DD` | admin، receptionist، doctor؛ یوازې تش وختونه |
| POST | `/api/appointments` | admin یا receptionist |
| GET | `/api/appointments` | admin/receptionist ټول؛ doctor یوازې خپل |
| GET | `/api/appointments/APPOINTMENT_ID` | admin/receptionist؛ یا هماغه doctor |
| PATCH | `/api/appointments/APPOINTMENT_ID/status` | د لاندې حالتونو د رول له مخې |
| POST | `/api/appointments/APPOINTMENT_ID/reschedule` | admin یا receptionist |

په هر request کې **Authorization → Bearer Token** وټاکئ. د `POST` او `PATCH`
لپاره **Body → raw → JSON** وټاکئ. `GET` ته Body مه لېږئ.

## ۴. د ازموینې چمتووالی

د backend په Terminal کې `npm run dev` وچلوئ. یو موجود Patient ریکارډ او یو
فعال doctor profile له کاري وختونو سره پکار دي. د ناروغ login ID د Patient
ریکارډ ID بدیل نه دی. د ثبت لپاره د اډمین یا receptionist په حساب signin
وکړئ؛ د doctor خپل token د خپل ملاقات د کتلو او معاینې لپاره وساتئ.

لاندې `PATIENT_RECORD_ID` او `DOCTOR_USER_ID` په خپلو اصلي IDs بدل کړئ.
`2026-11-07` یوازې مثال دی؛ داسې راتلونکې نېټه وکاروئ چې ډاکټر پکې کار کوي.

## ۵. تش وختونه وګورئ

```http
GET http://localhost:5000/api/doctors/DOCTOR_USER_ID/slots?date=2026-11-07
```

تمه: **200 OK**؛ ځواب `timeZone: "Asia/Kabul"`، `slotMinutes: 30` او `slots`
لري. له لېست څخه `startTime` واخلئ. خالي `slots: []` معنا دا ده چې په دې ورځ
د راتلونکي booking لپاره وخت نشته. دا endpoint د نورو ناروغانو معلومات نه لېږي.

د تش وخت لیدل یې ریزرف کول نه دي؛ که بل کارکوونکی یې لومړی ثبت کړي، POST
به **409** ورکړي. لېست بیا راواخلئ او بل وخت وټاکئ.

## ۶. ملاقات ثبت کړئ

د admin یا receptionist token سره:

```http
POST http://localhost:5000/api/appointments
```

```json
{
  "patientId": "PATIENT_RECORD_ID",
  "doctorUserId": "DOCTOR_USER_ID",
  "date": "2026-11-07",
  "startTime": "09:00"
}
```

تمه: **201 Created**، `message: "Appointment created successfully"` او
`appointment`. د ځواب `appointment._id` د راتلونکو غوښتنو لپاره وساتئ.
حالت په سرور کې `scheduled` ټاکل کېږي؛ `endAt` هم سرور حسابوي.
په MongoDB کې یې د `appointments` collection دننه کتلی شئ.

که په هماغه وخت بیا ثبت وکړئ، تمه **409 Conflict** ده؛ نوی ریکارډ نه جوړېږي.
ناموجود Patient یا فعال doctor profile **404** ورکوي.

## ۷. لېست، filters او کتنه

```http
GET http://localhost:5000/api/appointments
GET http://localhost:5000/api/appointments?date=2026-11-07&status=scheduled
GET http://localhost:5000/api/appointments?doctorUserId=DOCTOR_USER_ID
GET http://localhost:5000/api/appointments?patientId=PATIENT_RECORD_ID&page=1&limit=5
GET http://localhost:5000/api/appointments/APPOINTMENT_ID
```

تمه: **200 OK**. لېست `appointments` او `pagination` لري، د شروع وخت له مخې
مرتب دی، او max limit یې 50 دی. یوازې detail ځواب history هم لري.
د doctor token سره د بل doctor ملاقات **404** ورکوي؛ د بل doctor له ID سره
د لېست فلټر **403** ورکوي. د patient او pharmacy رولونو ته دا لارې **403** دي.

## ۸. حالت بدل کړئ

```http
PATCH http://localhost:5000/api/appointments/APPOINTMENT_ID/status
```

| اوسنی حالت | نوی حالت | څوک یې بدلوي؟ |
| --- | --- | --- |
| scheduled | checked_in | admin / receptionist |
| scheduled | cancelled | admin / receptionist؛ دلیل اړین |
| scheduled | no_show | admin / receptionist؛ دلیل او د وخت ختمېدل اړین |
| checked_in | cancelled | admin / receptionist؛ دلیل اړین |
| checked_in | in_progress | هماغه فعال doctor؛ د شروع وخت رسېدلی وي |
| in_progress | completed | هماغه فعال doctor |

د receptionist token سره:

```json
{
  "status": "checked_in"
}
```

بیا د ټاکل شوي doctor token سره، د ملاقات وخت چې ورسېد:

```json
{
  "status": "in_progress"
}
```

د معاینې په پای کې، د هماغه doctor token سره:

```json
{
  "status": "completed"
}
```

هر بریالی بدلون **200 OK** او `Appointment status updated successfully` ورکوي.
د راتلونکي ملاقات مخکې له وخت څخه پیلول **400** ورکوي؛ `no_show` د پای له
وخت مخکې هم **400** دی. د بشپړ یا لغوه شوي ملاقات بیا پرانیستل **409** دي.

د cancellation جلا ازموینې لپاره یو بل scheduled ملاقات وکاروئ؛ د receptionist token سره:

```json
{
  "status": "cancelled",
  "reason": "Patient requested cancellation"
}
```

## ۹. وخت بدل کړئ

یوازې scheduled ملاقات، د admin یا receptionist token سره:

```http
POST http://localhost:5000/api/appointments/APPOINTMENT_ID/reschedule
```

```json
{
  "date": "2026-11-07",
  "startTime": "10:00",
  "reason": "Patient requested another time"
}
```

تمه: **200 OK** او `Appointment rescheduled successfully`.
هماغه appointment ID، patient، doctor او createdBy ساتل کېږي. پخوانی وخت د
history په لومړني entry کې پاتې وي؛ نوی وخت، actor، دلیل او وخت ورزیاتېږي.
په دې لومړۍ نسخه کې نوی appointment سند نه جوړېږي؛ بدلون او تاریخچه په یوه
atomic save کې کېږي، څو جلا multi-document transaction ته اړتیا پیدا نه شي.

نیول شوی نوی وخت **409** ورکوي، پخوانی ملاقات او history خپل حالت ساتي.
د doctor یا patient بدلول د دې endpoint له لارې نه منل کېږي. تش یا تر 3
حروفو لنډ دلیل **400** ورکوي. د بل وخت لپاره slots بیا وګورئ.

## ۱۰. validation او هممهاله بدلونونه

- `09:15`، `9:00`، `25:00`، ناسمې نېټې او تېر وختونه **400** ورکوي.
- Client د `status`، `createdBy`، `history`، `isBooked` یا `endAt` واک نه لري.
- د cancellation، no-show او reschedule دلیل 3–300 حروف دی.
- د دوو هممهاله saves پر مهال زوړ save **409** ورکوي. ملاقات بیا راواخلئ.
- cancellation، completion او reschedule د خپل event سره په هماغه سند کې
  ثبتېږي. دا د ملاقات تاریخچه ده؛ عمومي `AuditLog` لا راتلونکی پړاو دی.

## ۱۱. اتومات ازموینې او پاتې کار

```powershell
npm test
```

`controller/appointmentController.test.js` خپل جلا temporary MongoDB او خیالي
ریکارډونه کاروي. د application `.env` نه لولي او عادي DB نه پاکوي. `mongod`
باید په PATH کې وي یا یې path په `MONGOD_BINARY` کې ورکړئ.

ازموینې permissions، validation، timezone/date boundaries، doctor/patient
collision، concurrent booking/reschedule، status transitions، تاریخچه،
ناکام بدلون کې د معلوماتو ساتل او stale saves چک کوي. د doctor پخوانۍ
ازموینې هم ورسره چلېږي.

د اوسني login session/logout په [AUTH_API.md](AUTH_API.md) کې جوړ او مستند دي.
CareAssignment، verified patient self-booking، د User عمومي امنیت/audit او
د ملاقاتونو notifications لا پاتې دي. دا لومړۍ برخه د بشپړ Backend یا د
clinical history د لاسرسي بشپړېدو ادعا نه کوي.
