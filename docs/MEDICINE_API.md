# د دواوو فهرست او اجزا — د Postman لارښود

نېټه: ۲۰۲۶-۱۱-۲۳

د Medicine Catalog لومړۍ برخه جوړه ده: د اجزاوو ثبت او کتنه، او د دواوو
ثبت، لټون، فلټر، کتنه او سمون. دا inventory نه دی؛ مقدار، بیه او stock
لا نه ساتي. اوسنی Prescription لا ورسره نه دی نښلول شوی. د ۲۰۲۶-۱۱-۲۴ راهیسې
PatientAllergy له Ingredient سره اختیاري manual mapping لري؛
[PATIENT_ALLERGY_API.md](PATIENT_ALLERGY_API.md) یې ګامونه ښيي.
د همدې اجزاوو simulated allergy preview په [ALLERGY_CHECK_API.md](ALLERGY_CHECK_API.md) کې دی.

ټول معلومات د زده کړې لپاره خیالي او په لاس داخلېږي. په DB او د بریالي
API ځواب په `catalog` کې دا نښې شته:

```json
{
  "mode": "simulated",
  "source": "academic_demo_manual",
  "sourceVersion": "1",
  "notice": "Simulated catalog data; unsuitable for actual patient care."
}
```

`sourceVersion` د دې ازمایښتي سرچینې د بڼې نسخه ده؛ د معتبر طبي provider
د معلوماتو نسخه نه ده. د Medicine جلا `version` د سمون شمېره ده.
دا فهرست د واقعي ناروغ د درملنې لپاره مناسب نه دی.

## ۱. اړیکې او د کوډ لوستل

یو Ingredient د دوا یو جزء دی. یوه Medicine له ۱ تر ۱۰ بېلابېل ثبت شوي
اجزا لري. یوه جزء په څو دواوو کې کارېدای شي. دوا د Ingredient `_id`
ساتي او API یې code او name هم ښکاره کوي. د نومونو له مخې طبي هویت یا
د دواوو مترادف نومونه په اتومات ډول نه اټکل کېږي.

```text
server.js → routes → auth → medicineValidation → medicineController → models → MongoDB
```

- `models/Ingredient.js`: ثابت code/name، سرچینه او ثبتوونکی.
- `models/Medicine.js`: دوا، د اجزاوو IDs، فعال حالت او version.
- `middleware/medicineValidation.js`: د `validator` له لارې input، ID او query چک.
- `controller/medicineController.js`: د جزء موجودیت، اجازو ته مناسب لېست او save.
- `routes/ingredientRoutes.js` او `medicineRoutes.js`: لارې او role اجازه.

اجزا اوس PATCH یا DELETE نه لري، څو د یو ID معنا په پټه بدله نه شي.
Medicine code هم ثابت دی. ناسم جزء د همدې مرحلې API له لارې نه سمېږي؛
سم جزء په نوي code ثبت کړئ. عمومي correction/audit flow راتلونکی کار دی.

## ۲. لارې او اجازې

ټولو لارو ته د signin تازه Bearer token پکار دی. base URL:
`http://localhost:5000`.

| Method | Endpoint | اجازه |
| --- | --- | --- |
| POST | `/api/ingredients` | hospital_admin او hospital_pharmacist |
| GET | `/api/ingredients` | پورته دوه رولونه او doctor |
| GET | `/api/ingredients/:id` | پورته درې رولونه |
| POST | `/api/medicines` | hospital_admin او hospital_pharmacist |
| GET | `/api/medicines` | مدیران ټول؛ doctor یوازې فعالې دواوې |
| GET | `/api/medicines/:id` | مدیران ټول؛ doctor یوازې فعاله دوا |
| PATCH | `/api/medicines/:id` | hospital_admin او hospital_pharmacist |

receptionist، patient او external_pharmacist اوس `403` اخلي. د بهرني
pharmacy د approval/membership تر جوړېدو پورې ورته لاسرسی نه دی پرانیستل شوی.
فهرست شخصي clinical record نه دی؛ د doctor د لوستلو لپاره appointment نه غواړي.
دا اجازه د ناروغانو معلوماتو ته نوی لاسرسی نه ورکوي.

## ۳. په Postman کې ګام په ګام ازموینه

د Backend په terminal کې `npm run dev` وچلوئ. خپل موجود اډمین یا د روغتون
درمل جوړونکي حساب ته `POST /api/auth/signin` وکړئ. د ځواب `token` په
**Authorization → Bearer Token** کې واچوئ. د POST/PATCH لپاره
**Body → raw → JSON** وټاکئ.

### لومړی: خیالي جزء ثبت کړئ

`POST http://localhost:5000/api/ingredients`

```json
{
  "code": "DEMO-ING-A",
  "name": "Fictional Component A"
}
```

ځواب `201` دی. د `ingredient._id` ارزښت کاپي کړئ. `code` له دواړو غاړو
تش ځایونه لرې کوي او uppercase ساتل کېږي؛ تکراري code `409` ورکوي.
code له ۲ تر ۴۰ حروفو، شمېرو، `-` او `_` جوړېږي او په حرف یا شمېره پیلېږي.
name له ۲ تر ۱۵۰ تورو دی.

### دویم: خیالي دوا ثبت کړئ

`POST http://localhost:5000/api/medicines`

په لاندې body کې `PASTE_INGREDIENT_ID` د تېر ځواب په حقیقي `_id` بدل کړئ:

```json
{
  "code": "DEMO-MED-A",
  "name": "Fictional Medicine A",
  "strength": "10 demo units",
  "form": "tablet",
  "ingredientIds": ["PASTE_INGREDIENT_ID"],
  "notes": "Fictional academic example",
  "isActive": true
}
```

ځواب `201` دی. `medicine._id` او `medicine.version` وساتئ؛ لومړی version
`0` دی. د سرچینې معلومات، createdBy او updatedBy server ټاکي.

strength یوازې له ۱ تر ۸۰ تورو ښودنیز متن دی؛ dosage یا واحدونه نه محاسبه
کوي. form: `tablet`، `capsule`، `syrup`، `cream`، `injection`، `drops` یا
`other`. notes اختیاري او تر ۱۰۰۰ تورو دی. isActive اختیاري boolean دی،
default یې `true` دی. د جوړولو پر وخت نور پورته fields اړین دي.

د ګډې دوا لپاره دویم خیالي جزء هم په جلا code ثبت کړئ او دوا ته یې دواړه
IDs ولېږئ. تکراري ID `400` او ناموجود جزء `404` ورکوي.

### درېیم: لېست، کتنه او لټون

```http
GET http://localhost:5000/api/ingredients
GET http://localhost:5000/api/ingredients?search=DEMO-ING
GET http://localhost:5000/api/ingredients/INGREDIENT_ID
GET http://localhost:5000/api/medicines
GET http://localhost:5000/api/medicines/MEDICINE_ID
GET http://localhost:5000/api/medicines?search=Fictional&page=1&limit=10
GET http://localhost:5000/api/medicines?form=tablet&ingredientId=INGREDIENT_ID&isActive=true
```

د URL placeholder هم په اصلي ID بدل کړئ. search د name یا code عادي
متن لټوي؛ د regex دستور نه چلوي. دواړه لېستونه د name او بیا ID له مخې
مرتب دي، default limit `10` او اعظمي `50` دی. ځواب `pagination` لري.
ingredient لېست یوازې search/page/limit مني؛ د دوا لېست پورته نور filters هم مني.

### څلورم: دوا سمه یا غیرفعاله کړئ

`PATCH http://localhost:5000/api/medicines/MEDICINE_ID`

```json
{
  "version": 0,
  "notes": "Fictional updated description",
  "isActive": false
}
```

ځواب `200` او نوی version `1` دی. یوازې رالېږل شوي fields بدلېږي.
name، strength، form، ingredientIds، notes او isActive بدلېدای شي؛ code نه.
په هر PATCH کې د وروستي GET/PATCH `version` ولېږئ. زوړ version یا د دوو
هممهاله سمونونو بایلونکی `409` اخلي؛ تازه GET وکړئ او خپل بدلون بیا وارزوئ.
د بیا فعالولو لپاره تازه version او `isActive: true` ولېږئ.

### پنځم: د doctor اجازه وګورئ

د doctor په token فعالې دواوې `200` ورکوي. غیرفعاله دوا په لېست کې نه
ښکاري او د detail GET یې `404` دی. `?isActive=false` او create/update
د doctor لپاره `403` دي. مدیر لا هم غیرفعاله دوا کتلای او فعالولای شي.

## ۴. خطاګانې، ازموینې او پاتې کار

- `400`: ناسم body، ID، query، تکراري ingredient ID، منع شوی field یا ناسم version.
- `401`: token نشته، ختم دی یا session بند شوی دی.
- `403`: role اجازه نه لري یا doctor غیرفعال فهرست غواړي.
- `404`: جزء/دوا نشته، یا دوا د doctor په مجاز فعال scope کې نه ده.
- `409`: تکراري code یا د سمون version conflict.

په body کې mode، source، sourceVersion، notice، actor، timestamps او نور
نامجاز fields مه لېږئ. ټول ځوابونه `Cache-Control: no-store` لري.
د دوا د حذف API نشته؛ isActive کارېږي. د بدلون وروستی updatedBy/time
ساتل کېږي؛ دا د ټولو پخوانیو بدلونونو بشپړ audit history نه دی.

یوازې د دې برخې اړوند اتومات ازموینې:

```powershell
node --test controller/medicineController.test.js
```

د ۲۰۲۶-۱۱-۲۳ پایله: **۲۷ بریالۍ ازموینې، صفر ناکامې**. په دې پړاو کې
ټول پخواني suites بیا نه دي چلول شوي. ازموینې real HTTP، signin/session،
ټول roles، ۷ endpoints، validation، filters، duplicate codes او هممهاله
سمون ګوري. جلا موقتي MongoDB او خیالي معلومات کاروي؛ `.env` او عادي DB
نه کاروي. `mongod` په PATH کې یا `MONGOD_BINARY` کې پکار دی.

پاتې کار: معتبر knowledge provider، clinical coverage/source updates،
معتبر clinical Allergy Checking او Drug Interaction Checking،
له structured prescription سره نښلول، signed snapshots، عمومي AuditLog،
pharmacy approval او inventory. اوسنی فهرست هېڅ دوا «خوندي» نه اعلانوي.

د موجود فهرست د اجزاوو لپاره جلا simulated interaction rules او د روان
ملاقات preview اوس په [INTERACTION_API.md](INTERACTION_API.md) کې دي؛ دا
د پورته معتبر clinical checking بدیل نه دی.
