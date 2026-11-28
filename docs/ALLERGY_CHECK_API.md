# د حساسیت ازمایښتي پرتله — د Postman لارښود

نېټه: ۲۰۲۶-۱۱-۲۴

دا د Allergy Checking لومړۍ، simulated برخه ده. د ټاکلو دواوو ingredient
IDs د ناروغ له موجودو manual mappings سره پرتله کوي. د ورته نوم، مترادف
نوم، brand، drug class یا cross-reaction طبي اټکل نه کوي. دا معتبر clinical
knowledge provider نه لري او د واقعي ناروغ د درملنې لپاره مناسب نه دی.

## ۱. لاره، اجازه او اړیکې

```http
POST http://localhost:5000/api/patients/PATIENT_ID/allergies/check
```

هماغه موجود JWT/session، doctor role، فعال Doctor profile او خپل رسېدلی
`in_progress` Appointment غواړي. د ملاقات بشپړول په راتلونکې غوښتنه کې
دا لاسرسی بندوي. Admin، receptionist، pharmacists او patient یې نه شي چلولای.
د Patient ID معنا د Patient ریکارډ `_id` ده، نه د login User ID.

```text
patientRoutes → patientAllergyRoutes → موجود role/visit checks
→ validateAllergyCheckInput → allergyCheckController
→ Medicine + Ingredient + د همدې Patient غیر-refuted PatientAllergy
```

نوی controller په موجود `controller/` کې دی. Input validation په موجود
`middleware/patientAllergyValidation.js` او route په `routes/patientAllergyRoutes.js`
کې زیات شوي. د test DB، auth او fixtures موجود harness بیا کارول شوی دی.
نوې collection، فولډر، dependency یا د عام auth بدلون نشته.

دا یوازې preview دی. PatientAllergy، Medicine او Prescription نه بدلوي او
نتیجه د SafetyCheck په توګه نه ساتي. د prescription لپاره جلا simulated ساتل شوی check اوس په `PRESCRIPTION_SAFETY_API.md` کې دی. Signing او durable audit لا پاتې دي.

## ۲. Body او پایلې

```json
{
  "medicineIds": ["MEDICINE_ID"]
}
```

له ۱ تر ۲۰ distinct، valid MongoDB IDs منل کېږي. د یوه ID لوی/کوچني حروف
تکرار ګڼل کېږي. نور Body fields او ټول query parameters منع دي؛ patient،
اجزا، allergy IDs، source، status او findings د client له Body څخه نه اخیستل کېږي.

سرور موجودې فعالې دواوې، د هغوی اجزا او د همدې ناروغ اوسني راپورونه لولي.
Confirmed او unconfirmed دواړه پرتله کېږي. Refuted راپور نه پرتله کېږي، خو
نه حذفېږي. تر ۲۰۰ غیر-refuted راپورونو ګوري؛ که نور هم وي coverage نیمګړی دی.
د دوا یا جزء source/mode/sourceVersion باید د اوسني simulated catalog برابر وي.
د allergy snapshot کوډ او نوم هم له موجود جزء سره باید برابر وي.

| `check.status` | معنا |
| --- | --- |
| `warning` | لږ تر لږه یو exact ingredient ID برابر دی؛ matched راپورونه په findings کې دي |
| `unknown` | برابر ID ونه موندل شو، خو معلومات نیمګړي دي یا غیر-refuted راپور نشته |
| `clear` | د همدې محدودې simulated پرتله معلومات بشپړ وو او exact ID برابر نه شو |

`clear` د «دوا خوندي ده» معنا نه لري. Coverage یوازې د پورته ID پرتله
بشپړتیا ده؛ د ناروغ د ټولو حساسیتونو نشتوالی یا clinical validation نه تاییدوي.
تش history او یوازې refuted history `unknown` دي. بې‌mapping راپورونه نه اټکل
کېږي. که warning او نامعلوم معلومات دواړه وي، status `warning` پاتې کېږي،
خو `coverage.complete: false` او issues هم ورسره راځي.

ځواب `check` او `catalog` لري. په check کې patientId، appointmentId، checkedBy،
checkedAt، د دواوو نوم/ID/version، allergyVersions، findings او coverage شته.
هر finding د دوا، جزء او راپور ID، kind، verificationStatus او reaction ښيي؛
د ټول allergy history او notes کاپي نه راوړي. د یوه medicine/ingredient/report
لپاره یو finding راځي؛ څو راپورونه یا دواوې جلا findings لرلای شي.

هر بریالی ځواب دا ثابتې نښې هم لري:

```json
{
  "mode": "simulated",
  "source": "academic_demo_manual",
  "sourceVersion": "1",
  "notice": "Simulated catalog data; unsuitable for actual patient care."
}
```

دا د `catalog` fields دي؛ `check.mode` هم simulated دی. sourceVersion د
ازمایښتي بڼې نسخه ده، د معتبر طبي provider release یا د وخت د تازه والي ثبوت نه دی.

## ۳. په Postman کې ازموینه

د Backend له Terminal څخه `npm run dev` وچلوئ. د خپل doctor حساب signin
token په **Authorization → Bearer Token** کې واچوئ. فعال profile او خپل
روان ملاقات چمتو کړئ؛ [APPOINTMENT_API.md](APPOINTMENT_API.md) یې ګامونه لري.
ټولې POST غوښتنې **Body → raw → JSON** غواړي.

لومړی یوه فعاله خیالي دوا او د هغې جزء پیدا کړئ:

```http
GET http://localhost:5000/api/medicines
```

د دوا `_id` او د هغې د `ingredients` له لېست څخه د ټاکلي جزء `_id` وساتئ.
که فهرست تش وي، admin/hospital pharmacist د [MEDICINE_API.md](MEDICINE_API.md)
له مخې خیالي اجزا او دوا جوړوي.

د همدغه خیالي جزء لپاره allergy ثبت کړئ:

```http
POST http://localhost:5000/api/patients/PATIENT_ID/allergies
```

```json
{
  "substance": "Fictional Component A",
  "ingredientId": "INGREDIENT_ID",
  "kind": "allergy",
  "reaction": "Fictional itching report",
  "source": "patient_reported"
}
```

د URL او Body placeholders په حقیقي IDs بدل کړئ. که راپور مخکې شته، د
[PATIENT_ALLERGY_API.md](PATIENT_ALLERGY_API.md) له مخې یې په تازه version او
reason سموئ؛ duplicate POST `409` دی. د حقیقي طبي mapping ادعا مه کوئ؛
دا مثال خیالي test دی او نوی راپور unconfirmed پاتې کېږي.

اوس د preview لاره وازمویئ:

```http
POST http://localhost:5000/api/patients/PATIENT_ID/allergies/check
```

```json
{
  "medicineIds": ["MEDICINE_ID"]
}
```

تمه: `200`، `check.status: warning` او په findings کې د همدغه جزء راپور.
Unconfirmed هم warning ورکوي؛ د جوړولو وروسته review ته انتظار نه باسي.

د نورو پایلو د کتلو لپاره یوه بله خیالي دوا وکاروئ چې له راپورونو سره
ګډ ingredient ID نه لري. که ټول غیر-refuted راپورونه اوسني معتبر simulated
mappings ولري، پایله `clear` ده. که یو راپور بې‌mapping وي، `unknown` دی.
که له بل موجود راپور سره match هم وي، پایله warning او coverage نیمګړی وي.
د ټولو راپورونو refuted کول د «حساسیت نشته» ثبت نه دی او unknown ورکوي.

په check کې د `coverage.issues` دا codes د نیمګړتیا علت ښيي:

| Code | علت |
| --- | --- |
| `no_active_allergy_reports` | غیر-refuted راپور نشته؛ د حساسیت نشتوالی معلوم نه دی |
| `unmapped_allergy` | راپور ingredient نه لري |
| `unavailable_allergy_mapping` | جزء نشته یا mapping snapshot/source د اوسني catalog برابر نه دی |
| `unsupported_allergy_report` | د ذخیره شوي راپور kind یا verificationStatus نه پېژندل کېږي |
| `unsupported_medicine_source` | د دوا source/mode/version د اوسني simulated catalog برابر نه دی |
| `missing_medicine_ingredients` | دوا اجزا نه لري |
| `unavailable_medicine_ingredient` | د دوا جزء ورک دی یا سرچینه یې د اوسني catalog برابر نه ده |
| `allergy_limit_exceeded` | تر ۲۰۰ زیات غیر-refuted راپورونه شته؛ ټول نه دي ارزول شوي |

## ۴. خطاګانې، ازموینې او حدود

- `400`: ناسم Body/ID، تکراري IDs، له ۲۰ زیات IDs، query یا اضافي field.
- `401`: token/session ناسم، ختم یا بند دی.
- `403`: role، فعال profile یا خپل روان ملاقات نشته.
- `404`: patient نشته، یا یوه ټاکل شوې دوا نشته/غیرفعاله ده؛ جزوي preview نه ورکوي.
- `500`: د معلوماتو لوستل ناکام شول؛ خوندي یا clear نتیجه نه ورکوي.

ټول ځوابونه `Cache-Control: no-store` لري. له هر اړوند سمون وروسته بیا
preview وغواړئ. ځواب د لوستل شوو records نسخه ښيي، خو د څو collections
atomic snapshot یا د نسخې د لاسلیک اجازه نه ده. دا پړاو severity، dosing،
signing، transmission او د معتبر provider checking نه بشپړوي. جلا simulated
interaction preview اوس په [INTERACTION_API.md](INTERACTION_API.md) کې مستند دی.

```powershell
node --test controller/patientAllergyController.test.js controller/medicineController.test.js
```

د ۲۰۲۶-۱۱-۲۴ پایله: **۹۹ بریالۍ ازموینې، صفر ناکامې**. ۷۲ د allergy
ثبت/mapping/preview او ۲۷ د catalog دي. ۲۱ نوې preview cases شته او د موجودو
permission/session tests له لارې نوې لاره هم چک شوې. نور suites بیا نه دي
چلول شوي. ازموینې خپل temporary MongoDB او خیالي fixtures کاروي؛ `.env`
او عادي DB نه کاروي. `mongod` په PATH یا `MONGOD_BINARY` کې پکار دی.
