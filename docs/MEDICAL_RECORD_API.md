# Medical Records — ساده تشریح او د Postman لارښود

دا د هرې معاینې لپاره د ډاکټر د طبي یادښتونو لومړۍ برخه ده. هر ریکارډ له
`Patient`، د ډاکټر له `User` حساب او یوه `Appointment` سره نښلي.
CareAssignment د کاروونکي د ۲۰۲۶-۱۱-۰۵ د پرېکړې له مخې فعلاً ځنډېدلی دی.
په دې نسخه کې ډاکټر یوازې د خپلو ملاقاتونو خپل ریکارډونه اداره کوي.

## ۱. فایلونه او ساده مسیر

- `models/MedicalRecord.js`: fields، اړیکې، timestamps او duplicate index.
- `middleware/medicalRecordAccess.js`: د لیکلو لپاره فعال doctor profile.
- `middleware/medicalRecordValidation.js`: د `validator` په وسیله input چک.
- `controller/medicalRecordController.js`: ثبت، کتنه، سمون، finalize او correction.
- `routes/medicalRecordRoutes.js`: لارې، session او doctor role.
- `controller/medicalRecordController.test.js`: د دې برخې اتومات ازموینې.

```text
Postman → route → protect → doctor role → active profile (writes) → validation → controller → MedicalRecord → DB
```

لومړی model او بیا `createMedicalRecord` ولولئ: خپل ملاقات پیدا کوي، د
معاینې حالت او ناروغ ګوري، او draft ثبتوي. په `updateMedicalRecord` کې
هر field خپل واضح `if` شرط او assignment لري. وروستی ریکارډ د API له
لارې مستقیم نه سمېږي؛ نوې linked correction غواړي.

## ۲. د اجازې قواعد

- هر endpoint معتبر login session او `doctor` role غواړي.
- د ثبت لپاره خپل ملاقات، رسېدلی startAt او `in_progress` یا `completed`
  حالت اړین دي. نور حالتونه **409** ورکوي.
- ټول writes فعال doctor profile غواړي. غیرفعال doctor خپل پخواني
  ریکارډونه کتلی شي، خو ثبت، سمون، finalize او correction نه کوي.
- د بل ډاکټر ریکارډ/ملاقات **404** ورکوي؛ حتی د هماغه ناروغ د بل ډاکټر
  یادښتونه په دې لومړۍ نسخه کې اجازه نه لري.
- اډمین، receptionist، pharmacists او patient دې clinical لارو ته **403** اخلي.
  د اډمین audited clinical access او Patient Portal کتنه راتلونکی کار دی.

سرور patient، doctor او appointment ټاکي. Client د لیکونکي، status یا
د تایید او اصلاح metadata واک نه لري. Medical Record د معاینې یادښت دی؛
Prescription خپل جلا موجود API لري.

## ۳. Fields او validation

| Field | قاعده |
| --- | --- |
| `appointmentId` | یوازې په create کې؛ معتبر ID او خپل مجاز ملاقات |
| `symptoms` | اړین متن؛ trim وروسته 2–1000 حروف |
| `diagnosis` | اړین متن؛ trim وروسته 2–500 حروف |
| `observations` | اختیاري متن؛ تر 2000 حروفو؛ default تش متن |
| `vitals` | اختیاري JSON object؛ default تش |
| `vitals.temperatureC` | اختیاري finite JSON number، په Celsius |
| `vitals.weightKg` | اختیاري finite JSON number له صفر څخه لوی، په kilogram |

Vitals یوازې همدا دوه fields مني. Strings لکه `"37"`، `null`، arrays او
نامعلوم fields نه منل کېږي. دا د عدد او واحد د بڼې چک دی؛ د اندازه شوو
معلوماتو د روغتیایي ارزونې یا تشخیص ادعا نه کوي.

په PATCH کې نه لېږل شوي root fields پخوانی حالت ساتي. که `vitals` ولېږئ،
ټول object بدلوي؛ ټول مطلوب measurements ورسره ولېږئ. `"vitals": {}`
یې په draft کې پاکوي. `"observations": ""` یادښت تشوي.

## ۴. API لارې

Base URL: `http://localhost:5000`.

| Method | Endpoint | موخه |
| --- | --- | --- |
| POST | `/api/medical-records` | د خپل ملاقات اصلي draft |
| GET | `/api/medical-records` | خپل لېست، filters او pagination |
| GET | `/api/medical-records/RECORD_ID` | خپل بشپړ ریکارډ |
| PATCH | `/api/medical-records/RECORD_ID` | د خپل draft سمون |
| POST | `/api/medical-records/RECORD_ID/finalize` | د خپل draft وروستی تایید |
| POST | `/api/medical-records/RECORD_ID/corrections` | له finalized ریکارډ څخه linked draft |

په ټولو کې **Authorization → Bearer Token** وټاکئ. د معلوماتو لپاره
**Body → raw → JSON** وکاروئ؛ GET او finalize Body نه غواړي.

## ۵. په Postman کې چمتووالی

د backend له Terminal څخه `npm run dev` وچلوئ. په خپل doctor حساب تازه
signin وکړئ؛ فعال profile پکار دی. خپل پیل شوی یا بشپړ ملاقات پیدا کړئ:

```http
GET http://localhost:5000/api/appointments?status=in_progress
GET http://localhost:5000/api/appointments?status=completed
```

که داسې ملاقات نه وي، اډمین/receptionist یې ثبت او check-in کوي؛ ټاکل شوی
doctor د وخت تر رسېدو وروسته `in_progress` کوي. تفصیل په
[APPOINTMENT_API.md](APPOINTMENT_API.md) کې دی. Scheduled ملاقات ته مستقیم
Medical Record جوړول **409** ورکوي.

## ۶. Draft جوړول

```http
POST http://localhost:5000/api/medical-records
```

```json
{
  "appointmentId": "APPOINTMENT_ID",
  "symptoms": "Fictional complaint",
  "diagnosis": "Fictional diagnosis",
  "observations": "Fictional examination notes",
  "vitals": {
    "temperatureC": 37,
    "weightKg": 70
  }
}
```

دا خیالي test معلومات دي؛ ID په خپل مجاز ملاقات بدل کړئ. تمه: **201 Created**،
`Medical record created successfully` او `medicalRecord`. د ځواب `_id`
وساتئ؛ لاندې ورته `RECORD_ID` وایو. حالت `draft` او finalization/correction
IDs په پیل کې `null` دي. په MongoDB کې `medicalrecords` collection کارېږي.
د یوه ملاقات دوهم اصلي ریکارډ، حتی هممهاله، **409** ورکوي.

## ۷. کتنه، لېست او سمون

```http
GET http://localhost:5000/api/medical-records
GET http://localhost:5000/api/medical-records/RECORD_ID
GET http://localhost:5000/api/medical-records?patientId=PATIENT_RECORD_ID
GET http://localhost:5000/api/medical-records?appointmentId=APPOINTMENT_ID
GET http://localhost:5000/api/medical-records?status=draft&page=1&limit=5
```

تمه: **200 OK**. لېست `medicalRecords` او `pagination` لري، default limit 10
او max 50 دی، او تازه ثبت شوي ریکارډونه لومړی راځي. لېست لنډ معلومات ښيي؛
بشپړ symptoms، observations او vitals په detail کې وګورئ. Filters هم یوازې
د ننوتلي ډاکټر خپل ریکارډونه راولي.

```http
PATCH http://localhost:5000/api/medical-records/RECORD_ID
```

```json
{
  "diagnosis": "Updated fictional diagnosis",
  "observations": "Updated fictional examination notes"
}
```

تمه: **200 OK** او `Medical record updated successfully`. یوازې draft سمېږي.
نور root fields پخواني معلومات ساتي؛ patient/doctor/appointment نه بدلېږي.

## ۸. Finalize

```http
POST http://localhost:5000/api/medical-records/RECORD_ID/finalize
```

**Body → none**. تمه: **200 OK** او `Medical record finalized successfully`.
سرور `status: finalized`، `finalizedAt` او `finalizedBy` ټاکي. اوس PATCH او
دوهم finalize **409** ورکوي؛ معلومات نه بدلېږي. دا د طبي یادښت وروستی
تایید دی؛ د Prescription signing او pharmacy transmission پړاوونه جلا دي.

## ۹. اصلاح په درې ساده ګامونو کې

لومړی د finalized ریکارډ لپاره دلیل ولېږئ:

```http
POST http://localhost:5000/api/medical-records/RECORD_ID/corrections
```

```json
{
  "reason": "Correct a fictional entry"
}
```

تمه: **201 Created** او `Correction draft created successfully`. ځواب نوې
draft ID لري؛ `correctionOf` پخواني finalized ریکارډ ته نښلي او
`correctionReason` دلیل ساتي. معلومات یې د پخواني ریکارډ کاپي وي؛ پخوانی
ریکارډ، finalization او timestamps خپل حالت ساتي.

بیا د **نوې correction ID** لپاره PATCH ولېږئ او اړین معلومات سم کړئ.
په پای کې د همدې نوې ID لپاره `/finalize` ولېږئ.

هر finalized ریکارډ یوازې یوه مستقیمه correction لري؛ تکراري او هممهاله
غوښتنې **409** ورکوي. د موجودې draft سمون ته دوام ورکړئ. که وروستۍ correction
بیا اصلاح غواړي، لومړی finalize کېږي، بیا د هغې له ID څخه بله draft جوړېږي.
د ملاقات ټول اصلي او corrective ریکارډونه د `appointmentId` filter له لارې
وګورئ. زاړه finalized ریکارډونه په لېست کې پاتې کېږي؛ `correctionOf` اړیکې ښيي.

## ۱۰. خطاګانې، ازموینې او پاتې کار

- ناسم input، ID، query یا نامعلوم field: **400**.
- ورک، ختم شوی یا logged-out token/session: **401**.
- ناسم role یا د لیکلو لپاره غیرفعال/ناموجود doctor profile: **403**.
- ناموجود یا د بل ډاکټر ریکارډ/ملاقات: **404**.
- نامناسب visit status، duplicate، finalized edit یا concurrent save: **409**.
- د correction دلیل 3–500 حروف دی. د هممهاله edit/finalize پر مهال زوړ
  save رد کېږي؛ تازه ریکارډ بیا واخلئ.

دا clinical trace دی؛ عمومي AuditLog راتلونکی کار دی. DELETE API نه لري.
ازموینې د Backend له فولډره په `npm test` چلېږي. د دې پړاو په پای کې ټولې
**۱۳۹** بریالۍ دي: **۲۷ medical records**، **۳۳ auth/session**، **۵۳ doctor**
او **۲۶ appointment**. خپل temporary local MongoDB او خیالي معلومات کاروي؛
د application `.env` نه لولي او عادي DB نه پاکوي.

CareAssignment فعلاً ځنډېدلی دی. د نورو ډاکټرانو مجاز history، د ناروغ
بشپړ مشترک history endpoint، allergies، verified patient link/portal او
د اډمین audited clinical access لا پاتې دي. دا د Medical Records لومړۍ برخه ده.
