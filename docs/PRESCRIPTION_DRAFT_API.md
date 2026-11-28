# د فهرست له دواوو سره د نسخې Draft

نېټه: ۲۰۲۶-۱۱-۲۶

په دې برخه کې ډاکټر د خپل روان ملاقات لپاره unsigned Draft جوړوي او سموي.
دواوې له موجود simulated catalog څخه ټاکل کېږي. ټول معلومات تعلیمي او خیالي
دي؛ د اصلي ناروغانو د درملنې لپاره معتبر نه دي. د نسخې simulated SafetyCheck اوس شته؛ لاسلیک،
اصلاح شوې signed revision، لغوه کول او pharmacy ته لېږل لا پاتې دي.

## ۱. فایلونه او د معلوماتو تګ

`prescriptionRoutes → protect/role/active doctor → validation → draft controller → models`

- `models/Prescription.js`: موجود model مو غځولی؛ نوې collection نه جوړېږي.
- `middleware/prescriptionDraftValidation.js`: د IDs، متن، medicine lines او revision کتنه په validator.
- `controller/prescriptionDraftController.js`: د ملاقات اجازه، catalog snapshots او save.
- `routes/prescriptionRoutes.js`: نوې لارې د موجودو لارو ترڅنګ دي.

ناروغ د Appointment.patient او ډاکټر د login له User._id څخه ټاکل کېږي.
Client patient، doctor، status، format، snapshots او source نه ټاکي. فعال doctor
profile او خپل رسېدلی in_progress ملاقات د جوړولو او هر سمون لپاره اړین دي.
completed، راتلونکی یا د بل doctor ملاقات اجازه نه ورکوي. PATCH د Draft
هماغه اصلي ملاقات غواړي؛ د ناروغ بل ملاقات یې ځای نه نیسي.

| Method | Endpoint | اجازه |
| --- | --- | --- |
| POST | `/api/prescriptions/drafts` | فعال doctor؛ خپل روان ملاقات |
| PATCH | `/api/prescriptions/:id` | فعال لیکونکی؛ هماغه روان ملاقات او تازه revision |
| GET | `/api/prescriptions` | موجود قرارداد: doctor خپل؛ hospital_admin ټول |
| GET | `/api/prescriptions/:id` | موجود قرارداد: doctor خپل؛ hospital_admin ټول |

اډمین، receptionist، دواړه pharmacist رولونه او patient د Draft د لیکلو اجازه
نه لري. د بل doctor د نسخې PATCH/GET `404` دی. د admin موجود لوستلو scope
بدل شوی نه دی؛ بشپړ audited clinical access لا د امنیتي پړاو پاتې کار دی.

## ۲. په Postman کې Draft جوړول

Backend په `npm run dev` چالان کړئ؛ base URL `http://localhost:5000` دی.
د doctor په signin تازه token واخلئ، Authorization → Bearer Token کې یې ورکړئ.
Body → raw → JSON وټاکئ.

لومړی دې دا معلومات موجود وي:

1. د doctor فعال profile.
2. ثبت شوی Patient او د همدغه doctor رسېدلی in_progress ملاقات؛
   [APPOINTMENT_API.md](APPOINTMENT_API.md) یې جریان لري.
3. د اډمین یا hospital_pharmacist له خوا جوړه شوې فعاله خیالي دوا چې موجود
   simulated ingredients ولري؛ [MEDICINE_API.md](MEDICINE_API.md) وګورئ.

```http
POST /api/prescriptions/drafts
```

```json
{
  "appointmentId": "APPOINTMENT_ID",
  "diagnosis": "Fictional diagnosis for the university demonstration",
  "medicines": [
    {
      "medicineId": "CATALOG_MEDICINE_ID",
      "dosage": "Fictional dosage",
      "frequency": "Fictional frequency",
      "duration": "Fictional duration",
      "instructions": "Fictional instructions"
    }
  ],
  "notes": "Fictional university draft"
}
```

ID placeholders له خپلو اصلي IDs سره بدل کړئ. medicineId د Medicine._id او
appointmentId د Appointment._id دی. د دوا نوم مه لېږئ؛ سرور یې له فهرست اخلي.
بریا `201` ده؛ ځواب `{message, prescription}` دی. prescription._id او
revision وساتئ. هر بریالی POST نوی Draft جوړوي؛ د هماغه Draft سمون PATCH دی.

نوی ریکارډ format: catalog_v1، status: draft، revision: 1، appointment،
updatedBy او catalog metadata لري. هره medicine line دا کاپي ساتي:

- medicine ID، catalogVersion، name، code، strength او form.
- د ingredients ID، code او name.
- د doctor ټاکل شوی dosage، frequency، duration او instructions.

catalog د mode، source، sourceVersion او د نه مناسب والي notice لري او په
DB او ځواب کې خوندي دی. strength، dosage، frequency او duration ښودنیز/لیکل
شوی متن دی؛ دلته د dose محاسبه یا clinical اعتبار نه ارزول کېږي.

## ۳. کتل او سمول

```http
GET /api/prescriptions/PRESCRIPTION_ID
GET /api/prescriptions?patientId=PATIENT_RECORD_ID&page=1&limit=10
```

هماغه موجود endpoints نوي Drafts او پخوانۍ نسخې ښيي. GET د patient او doctor
محدود identity fields populate کوي؛ POST/PATCH کې references خام IDs دي.
د list default limit لس او max پنځوس دی. status filter اوس نه شته.

```http
PATCH /api/prescriptions/PRESCRIPTION_ID
```

```json
{
  "revision": 1,
  "diagnosis": "Revised fictional diagnosis",
  "notes": "Revised fictional note"
}
```

بریا `200` ده او revision دوه کېږي. بل PATCH باید همدا نوې revision ولېږي.
یوازې diagnosis، medicines او notes سمېږي؛ نه لېږل شوي fields هماغسې پاتې کېږي.
medicines لېږل ټول لېست بدلوي؛ هره line بیا بشپړه غواړي:

```json
{
  "revision": 2,
  "medicines": [
    {
      "medicineId": "CATALOG_MEDICINE_ID",
      "dosage": "Revised fictional dosage",
      "frequency": "Fictional frequency",
      "duration": "Fictional duration"
    }
  ]
}
```

دا غوښتنه له فعال catalog څخه ټول medicine snapshots بیا جوړوي. حتی هماغه
medicine list بیا لېږل د څرګند refresh په معنا دي او revision زیاتوي.
یوازې د notes/diagnosis بدلون پخواني medicine snapshots ساتي؛ که catalog
وروسته بدل یا دوا غیرفعاله شي، notes-only سمون snapshot نه تازه کوي.
دا د دوا د اوسني خوندي والي تایید نه دی. اوسنی simulated SafetyCheck freshness
او د هماغې نسخې محتوا بیا ارزوي؛ لارښود په `PRESCRIPTION_SAFETY_API.md` کې دی.

د متن بې‌بدلونه PATCH `400` دی. زوړ revision یا هممهاله conflicting save
`409` دی؛ تازه GET واخلئ او د تازه revision له مخې بیا سمون وکړئ. revision
د Draft د بدلون شمېر دی؛ د هر پخواني Draft محتوا جلا history نه ساتل کېږي.
د signed immutable revision او audit جوړول لا راتلونکی پړاو دی.

د catalog او ملاقات لوستل له Prescription save سره یو atomic transaction
نه دی. د راتلونکي safety check او signing پر مهال به اړوند محتوا، نسخې او
اجازې بیا چک کېږي؛ اوسنی Draft د sign کولو ثبوت نه دی.

## ۴. Validation او پخوانۍ نسخې

- diagnosis له trim وروسته ۲–۵۰۰، notes تر ۱۰۰۰ تورو.
- له ۱ تر ۲۰ medicine lines؛ medicine IDs باید valid او distinct وي.
- dosage/frequency/duration هر یو ۱–۱۰۰ توري؛ instructions اختیاري تر ۳۰۰.
- notes او instructions نه لېږل په create کې تش متن ساتي؛ null نه منل کېږي.
- ټولې دواوې فعالې، د current simulated source او موجود version لرونکې وي.
- اجزا باید موجود او د همدې سرچینې وي؛ تر ۴۰ distinct اجزاوو محدودیت لري.
- Body اضافي fields او query parameters نه مني؛ server-owned fields نه جعلېږي.

پخوانی `POST /api/prescriptions` د free-text مثال لپاره پاتې دی او په
[PRESCRIPTION_API.md](../PRESCRIPTION_API.md) کې مستند دی. پخوانی record په
خپله Draft، signed یا catalog-mapped نه ګرځي. نوی PATCH یوازې catalog_v1
Draft مني؛ legacy یا non-draft record ته `409` ورکوي. پخوانی create د
نوي appointment/catalog جریان بدیل نه دی؛ د signing لپاره explicit migration
او تازه check ته اړتیا لري. دا د ټولو prescription امنیتي کارونو بشپړوالی نه دی.

ناسم input/ID `400`، ناسم/ختم/revoked session `401`، د role/profile/visit
اجازې نشتوالی `403`، ناموجود مجاز prescription/patient/catalog record `404`،
revision یا state conflict `409` او generic DB failure `500` دی.
ناکام replacement د Draft نور fields هم نه ذخیره کوي.
ټول ځوابونه Cache-Control: no-store لري.

## ۵. ازموینې او راتلونکی ګام

```powershell
node --test controller/prescriptionDraftController.test.js controller/doctorController.test.js controller/medicineController.test.js
```

د ۲۰۲۶-۱۱-۲۶ پایله: **۱۰۹ بریالۍ، صفر ناکامې**؛ ۲۹ نوې Draft ازموینې،
۵۳ د Doctor او ۲۷ د catalog دي. validation، roles، session/visit، snapshots،
legacy compatibility، read scopes، stale/concurrent edits او failure rollback
چک شوي دي. suites جلا temporary MongoDB او خیالي fixtures کاروي؛ `.env` او
عادي DB نه لولي. mongod په PATH یا MONGOD_BINARY کې پکار دی. نور suites
په دې بدلون کې بیا نه دي چلول شوي.

د همدې Draft مشخص revision لپاره simulated allergy/interaction SafetyCheck
اوس جوړ شوی؛ [د کتنې لارښود](PRESCRIPTION_SAFETY_API.md) وګورئ. ورپسې signing،
traceable correction/cancellation او transmission پاتې دي.
