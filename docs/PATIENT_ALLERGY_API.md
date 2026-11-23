# د ناروغ حساسیتونه — ساده تشریح او د Postman لارښود

نېټه: ۲۰۲۶-۱۱-۲۲

د Patient Allergies لومړۍ برخه جوړه ده: ثبت، کتنه، review او د سمون
تاریخچه. د Medicine Catalog ازمایښتي بنسټ اوس په `MEDICINE_API.md` کې دی؛
اتومات allergy checking لا ingredient mapping او معتبرې معلوماتي سرچینې ته اړتیا لري.

## ۱. اړیکې او د کوډ مسیر

یو Patient څو PatientAllergy ریکارډونه لري. `recordedBy` د لومړي ثبتوونکي
د User حساب ID دی. هر history entry خپل actor، د روان ملاقات ID، وخت،
دلیل او د هماغه وخت د معلوماتو کاپي لري.

- `models/PatientAllergy.js`: fields، history، indexes او version.
- `middleware/patientAllergyAccess.js`: فعال doctor او خپل روان ملاقات.
- `middleware/patientAllergyValidation.js`: د `validator` په وسیله input چک.
- `controller/patientAllergyController.js`: ثبت، لېست، کتنه او سمون.
- `routes/patientAllergyRoutes.js`: څلور لارې؛ په `patientRoutes.js` کې نښلي.
- `middleware/jsonErrorHandler.js`: ناسم JSON ته ساده `400` JSON ځواب.
- `controller/patientAllergyController.test.js`: دایمي ازموینې.

```text
Postman → patientRoutes (protect) → allergyRoutes (doctor role)
→ patient ID → فعال profile او خپل روان ملاقات → input validation
→ controller → PatientAllergy → MongoDB
```

لومړی model، بیا access middleware او `createPatientAllergy` ولولئ.
په update کې هر field خپل واضح `if` او assignment لري. د تاریخچې د
تکراري کوډ د مخنیوي لپاره `appendAllergyHistory` یوه کوچنۍ جلا دنده ده.

## ۲. د اجازې قواعد

- ټولې لارې معتبر session، `doctor` role او فعال doctor profile غواړي.
- همدغه doctor باید له همدغه Patient سره خپل `in_progress` ملاقات ولري؛
  startAt باید رسېدلی وي. یوازې doctor role اجازه نه ورکوي.
- Scheduled، checked-in، completed، cancelled او no-show ملاقات اجازه نه ورکوي.
  د معاینې `completed` کول په راتلونکو غوښتنو کې لاسرسی بندوي.
- endAt په خپله لاسرسی نه ختموي؛ اوږده معاینه تر status بدلون پورې روانه ده.
- بل فعال doctor چې وروسته د همدې ناروغ خپل روان ملاقات ولري، پخواني
  allergy راپورونه هم کتلی او په دلیل سمولای شي.
- دا اجازه یوازې allergies ته ده؛ د بل doctor Medical Records نه پرانیستل کېږي.
- Admin، receptionist، pharmacists او patient دې لارو ته اوس `403` اخلي.

CareAssignment د کاروونکي د پخوانۍ پرېکړې له مخې ځنډېدلی دی. Verified
Patient Portal او د اډمین audited clinical access راتلونکی کار دی.

## ۳. Fields او validation

| Field | قاعده |
| --- | --- |
| `substance` | اړین متن، trim وروسته 2–150 حروف؛ د مادې راپور شوی نوم |
| `kind` | `allergy` یا `sensitivity` |
| `reaction` | اړین متن، 2–500 حروف؛ راپور شوی غبرګون |
| `source` | `patient_reported`، `medical_record` یا `clinician_observed` |
| `notes` | اختیاري متن، تر 1000 حروفو؛ تش string یې پاکوي |
| `verificationStatus` | `unconfirmed`، `confirmed` یا `refuted` |
| `version` | د ریکارډ شمېره؛ په هر PATCH کې اوسنۍ numeric شمېره اړینه ده |
| `reason` | یوازې PATCH کې اړین دلیل، 3–500 حروف |

Create تل `unconfirmed` دی. په create کې verificationStatus یوازې
`unconfirmed` لېږل کېدای شي، یا یې مه لېږئ. Confirm/refute د PATCH له لارې
د doctor جلا ارزونه او دلیل غواړي. Source د راپور اصل دی؛ مثلاً د ناروغ
راپور د جلا تایید وروسته هم `patient_reported` پاتې کېدای شي.

سرور د confirmed/refuted ارزونې لپاره `reviewedBy` او `reviewedAt` ټاکي.
Unconfirmed کول دا اوسني values null کوي؛ پخوانۍ ارزونه په history کې پاتې ده.
د substance، kind، reaction یا source حقیقي بدلون پخوانی تایید unconfirmed
کوي، مګر که doctor په هماغه PATCH کې په څرګنده verificationStatus هم ورکړي.
یوازې notes بدلول تایید نه ختموي. بې‌بدلونه PATCH `400` دی.

Patient، recordedBy، updatedBy، reviewedBy/At، history او timestamps سرور
ټاکي؛ له Body څخه نه منل کېږي. `ingredientId` لا نه منل کېږي.

د duplicate پر مهال کوچني/لوی حروف او تکراري whitespace یو شان دي.
د یوه patient لپاره د هماغه نوم او kind دوهم ریکارډ `409` دی، حتی که لومړی
refuted وي؛ موجود ریکارډ سم کړئ. دا یوازې د نوم د تکرار مخنیوی دی؛
د دواوو مترادف نومونه، ingredients او طبي هویت نه پېژني.

## ۴. API لارې

Base URL: `http://localhost:5000`.

| Method | Endpoint | موخه |
| --- | --- | --- |
| POST | `/api/patients/PATIENT_ID/allergies` | نوی unconfirmed راپور |
| GET | `/api/patients/PATIENT_ID/allergies` | د همدې ناروغ لېست او filters |
| GET | `/api/patients/PATIENT_ID/allergies/ALLERGY_ID` | بشپړ ریکارډ او history |
| PATCH | `/api/patients/PATIENT_ID/allergies/ALLERGY_ID` | سمون یا review له دلیل سره |

`PATIENT_ID` د Patient ریکارډ `_id` دی، د login User ID نه دی.
ټول ځوابونه `Cache-Control: no-store` لري. لېست history نه راوړي؛ detail یې راوړي.
DELETE API نه لري. Refuted ریکارډ هم په عادي لېست کې پاتې کېږي.

## ۵. د Postman چمتووالی

د backend له Terminal څخه `npm run dev` وچلوئ. د خپل doctor حساب لپاره:

```http
POST http://localhost:5000/api/auth/signin
```

د حساب email/password په **Body → raw → JSON** کې ولېږئ. د ځواب token
په لاندې ټولو غوښتنو کې **Authorization → Bearer Token** ته کاپي کړئ.
د DB پاکولو ته اړتیا نشته. خپل روان ملاقات او د ناروغ ID پیدا کړئ:

```http
GET http://localhost:5000/api/appointments?status=in_progress
```

که روان ملاقات نه لرئ، admin/receptionist ملاقات ثبت او check-in کوي.
بیا ټاکل شوی doctor د وخت تر رسېدو وروسته `in_progress` کوي. دقیق ګامونه
په [APPOINTMENT_API.md](APPOINTMENT_API.md) کې دي. حساسیتونه د معاینې له
بشپړولو مخکې وازمویئ.

## ۶. خیالي راپور ثبت کړئ

```http
POST http://localhost:5000/api/patients/PATIENT_ID/allergies
```

**Body → raw → JSON**:

```json
{
  "substance": "Fictional Substance A",
  "kind": "allergy",
  "reaction": "Fictional skin itching report",
  "source": "patient_reported",
  "notes": "Fictional test data only"
}
```

تمه: **201 Created**، `Patient allergy recorded successfully` او `allergy`.
`allergy._id` او `allergy.version` وساتئ. په پیل کې version `0`،
verificationStatus `unconfirmed` او history یو entry لري.
MongoDB collection `patientallergies` ده. یوازې خیالي معلومات وکاروئ.

## ۷. لېست او کتنه

```http
GET http://localhost:5000/api/patients/PATIENT_ID/allergies
GET http://localhost:5000/api/patients/PATIENT_ID/allergies/ALLERGY_ID
GET http://localhost:5000/api/patients/PATIENT_ID/allergies?kind=sensitivity
GET http://localhost:5000/api/patients/PATIENT_ID/allergies?verificationStatus=confirmed&page=1&limit=5
```

تمه: **200 OK**. لېست `allergies` او `pagination` لري؛ default limit 10،
max 50، او ترتیب د تازه جوړېدو له مخې دی. Filter یوازې همدې patient ته محدود دی.
تش لېست یوازې «ثبت شوی ریکارډ ونه موندل شو» معنا لري؛ د allergy نشتوالی نه تاییدوي.

## ۸. تایید یا سمون

```http
PATCH http://localhost:5000/api/patients/PATIENT_ID/allergies/ALLERGY_ID
```

```json
{
  "verificationStatus": "confirmed",
  "reason": "Fictional review for API testing",
  "version": 0
}
```

تمه: **200 OK** او `Patient allergy updated successfully`. سرور reviewer
او وخت ټاکي؛ version `1` او history دوه entries کېږي. دا خیالي test دی،
د حقیقي حساسیت طبي تایید نه دی.

د سمون بل مثال، د هماغه تازه version په کارولو:

```json
{
  "reaction": "Corrected fictional reaction",
  "reason": "Correct a fictional entry",
  "version": 1
}
```

اوس version `2` او د reaction د بدلون له امله verificationStatus بېرته
`unconfirmed` کېږي؛ پخوانی confirmed snapshot خوندي پاتې کېږي.
د ردولو لپاره `verificationStatus: "refuted"`، دلیل او تازه version ولېږئ.

تل د GET یا وروستي بریالي PATCH تازه version وکاروئ. زوړ version یا دوه
هممهاله سمونونه `409` ورکوي؛ GET بیا واخلئ، بدلون وارزوئ او بیا یې ولېږئ.
معلومات او نوې history entry په یوه atomic document save کې ثبتېږي.

## ۹. ازموینې او پاتې کار

- ناسم input، ID، query، reason، version یا metadata: **400**.
- ورک، ختم شوی یا logged-out session: **401**.
- ناسم role، inactive profile یا خپل روان ملاقات نه لرل: **403**.
- ناموجود patient، allergy یا د بل patient allergy: **404**.
- duplicate، زوړ version یا concurrent save: **409**.
- ناسم JSON ساده **400** JSON ځواب لري؛ request body او stack نه ښکاره کوي.

د Backend له فولډره `npm test` وچلوئ. د ۲۰۲۶-۱۱-۲۲ پایله **۱۷۵ بریالۍ**
ازموینې ده: ۳۶ allergies، ۲۷ Medical Records، ۳۳ auth/session، ۵۳ doctor او
۲۶ appointments. `mongod` باید په PATH کې وي یا `MONGOD_BINARY` وټاکئ.
هر suite خپله جلا temporary DB کاروي؛ د application `.env` نه لولي او
عادي database نه پاکوي.

دا د حساسیتونو د ثبت او review لومړۍ برخه ده. اتومات ingredient matching،
interaction checking، معتبر knowledge source، Patient Portal او عمومي
AuditLog لا پاتې دي. Embedded history د همدې ریکارډ trace دی.
