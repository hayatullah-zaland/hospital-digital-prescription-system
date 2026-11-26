# د دواوو د تعامل تعلیمي کتنه

نېټه: ۲۰۲۶-۱۱-۲۶

دا برخه خیالي، simulated معلومات کاروي او د اصلي ناروغانو د درملنې لپاره
معتبره نه ده. severity، طبي evidence یا د درملنې سپارښتنه نه اټکل کوي.
د معتبر clinical provider انتخاب او له نسخې سره ثابت SafetyCheck لا پاتې دي.

## ۱. جوړښت او اجازې

`routes → middleware → controller → models → MongoDB`

- `models/KnowledgeRule.js`: د دوو بېلابېلو Ingredient IDs ثابت قاعده.
- `middleware/interactionValidation.js`: په validator د ثبت او query کتنه.
- `controller/interactionController.js`: ثبت، لېست، detail او read-only preview.
- `routes/interactionRuleRoutes.js`: د قواعدو لارې.
- `routes/patientInteractionRoutes.js`: د ناروغ لپاره د کتنې لاره.

د اجزاوو IDs لومړی په ثابت ترتیب ساتل کېږي؛ pairKey unique دی. د جوړې
سرچپه ترتیب او هممهاله ثبت دوهمه قاعده نه جوړوي. د rule PATCH/DELETE API
نشته؛ outcome، اجزا، actor او source ثابت دي. د قواعدو correction، import،
د راتلونکو source نسخو مدیریت او عمومي AuditLog لا راتلونکی کار دی.

| Method | Endpoint | اجازه |
| --- | --- | --- |
| POST | `/api/interaction-rules` | hospital_admin، hospital_pharmacist |
| GET | `/api/interaction-rules` | پورته رولونه او doctor |
| GET | `/api/interaction-rules/:id` | پورته رولونه او doctor |
| POST | `/api/patients/:patientId/interactions/check` | فعال doctor، خپل رسېدلی in_progress ملاقات |

receptionist، patient او external_pharmacist د قواعدو لاسرسی نه لري.
اډمین او درملتونوال د ناروغ preview ته اجازه نه لري. د قواعدو role اجازه
د patient یا pharmacy نسخو ته عمومي لاسرسی نه ورکوي.

د preview لپاره د allergies موجوده requireAllergyVisit او د medicineIds
validation بیا کاروو. protect او no-store په اصلي patient router کې دي.
هر request فعال doctor، موجود patient او خپل روان ملاقات بیا چک کوي؛
completed، راتلونکی یا د بل doctor ملاقات اجازه نه ورکوي. `patientId`
د Patient._id دی، د login User._id نه دی. CareAssignment لا ځنډېدلی دی.

## ۲. په Postman کې ازموینه

Backend په `npm run dev` چالان کړئ. Base URL: `http://localhost:5000`.
په Authorization کې Bearer Token وټاکئ او د اړوند رول تازه signin token
ورکړئ. د JSON لپاره Body → raw → JSON وټاکئ.

۱. د اډمین یا hospital_pharmacist له token سره دوه خیالي اجزا جوړ کړئ:

```http
POST /api/ingredients
```

```json
{"code":"DEMO-INTERACTION-A","name":"Fictional Interaction Component A"}
```

```json
{"code":"DEMO-INTERACTION-B","name":"Fictional Interaction Component B"}
```

د ځواب ingredient._id دواړه IDs وساتئ. که مخکې مو خیالي اجزا جوړ کړي وي،
د هغوی IDs هم کارولای شئ؛ real درمل یا طبي قاعدې دلته مه اټکل کوئ.

۲. د همدغو IDs لپاره خیالي warning ثبت کړئ:

```http
POST /api/interaction-rules
```

```json
{
  "ingredientIds": ["INGREDIENT_A_ID", "INGREDIENT_B_ID"],
  "outcome": "warning"
}
```

بریا `201` ده، ځواب `{rule, knowledge}` دی. یوازې ingredientIds او outcome
منل کېږي. تکراري جوړه `409` ورکوي. source، mode، actor، severity، evidence
یا message client نه ټاکي. دواړه اجزا باید د موجود current simulated catalog وي.

۳. دوه خیالي دواوې جوړې کړئ؛ هره یوه دې خپل جزء ولري:

```http
POST /api/medicines
```

```json
{
  "code": "DEMO-INTERACTION-MED-A",
  "name": "Fictional Interaction Medicine A",
  "strength": "10 demo units",
  "form": "tablet",
  "ingredientIds": ["INGREDIENT_A_ID"]
}
```

د دوهمې دوا code/name بدل کړئ او INGREDIENT_B_ID وکاروئ. د دواوو له
ځواب medicine._id IDs وساتئ. strength دلته یوازې ښودنیز متن دی.

۴. د ناروغ لپاره د هماغه doctor ملاقات check-in او in_progress کړئ؛ د
ملاقات جریان په [APPOINTMENT_API.md](APPOINTMENT_API.md) کې دی. اوس د
هماغه doctor token سره دواوې وګورئ:

```http
POST /api/patients/PATIENT_ID/interactions/check
```

```json
{"medicineIds":["MEDICINE_A_ID","MEDICINE_B_ID"]}
```

بریا `200` ده. `check.status` باید warning، findings کې یوه جوړه، او
knowledge کې mode: simulated او د نه مناسب والي notice وي. check د
patient، appointment، checkedBy، checkedAt، د دواوو versions، rulesUsed او
coverage معلومات هم لري. د ruleId او ingredientIds له لارې قاعده معلومېږي.

۵. لېست او detail وګورئ:

```http
GET /api/interaction-rules?page=1&limit=10
GET /api/interaction-rules?ingredientId=INGREDIENT_A_ID
GET /api/interaction-rules/RULE_ID
```

default limit لس، max پنځوس دی؛ ځواب rules، pagination او knowledge لري.
یوازې page، limit او ingredientId query منل کېږي. ناموجود detail `404` دی.

## ۳. د پایلې معنا

| status | معنا |
| --- | --- |
| warning | لږ تر لږه یوې سالمې خیالي قاعدې warning ورکړی؛ نورې نیمګړتیاوې هم کېدای شي موجودې وي |
| unknown | warning نشته، خو قاعده/جزء/سرچینه نیمګړې ده، یا دوه بېلابېل اجزا نشته |
| clear | د ټولو ټاکل شوو بېلابېلو اجزاوو هرې جوړې څرګند no_demo_interaction قاعده لرله او معلومات بشپړ وو |

clear یوازې د محدود خیالي مثال پایله ده؛ clinical safety یا د sign اجازه
نه تاییدوي. no_demo_interaction د تمرین لپاره څرګند منفي مثال دی، د واقعي
دواوو د تعامل د نشتوالي ثبوت نه دی. د clear د ازموینې لپاره دوه نوي خیالي
اجزا او دواوې جوړې کړئ او د هغوی قاعده په no_demo_interaction ثبت کړئ؛
پخوانۍ warning قاعده مه بدلوئ. له قاعدې پرته جوړه unknown ورکوي.

له ۱ تر ۲۰ distinct medicine IDs منل کېږي؛ ټولې دواوې باید موجودې او فعالې
وي، کنه ټوله غوښتنه `404` ده. تر ۴۰ بېلابېلو اجزاوو، یعنې تر ۷۸۰ جوړو،
زیاته غوښتنه `400` ده. د مرکبې دوا داخلي جوړې هم کتل کېږي. تکراري ingredient
IDs یوازې یو ځل پرتله کېږي؛ د یوې جوړې warning د ټولو اړوندو دواوو IDs لري.
د عادي قواعدو د لېست pagination د preview پوښښ نه محدودوي.

coverage.complete یوازې د دې محدودې simulated پرتله بشپړوالی دی. issues:
unsupported_medicine_source، missing_medicine_ingredients، unavailable_ingredient،
uncovered_ingredient_pairs او no_distinct_ingredient_pair دي. missingPairCount
بې‌قاعدې، ناسمې قاعدې یا نامعتبر جزء لرونکې جوړې شمېري. بشپړ clinical coverage
نه دی؛ د نومونو، synonym، class، dose، تکراري دوا او د ناروغ پخوانۍ دواوې نه ګوري.

## ۴. ازموینې او حدود

ناسم JSON/body/query/IDs `400`، ناسم یا بند session `401`، د role/profile/
ملاقات د اجازې نشتوالی `403`، ناموجود patient/فعاله دوا `404` او د ثبت
تکراري جوړه `409` ورکوي. DB failure خوندي generic `500` ورکوي؛ clear نه ورکوي.
ټول ځوابونه Cache-Control: no-store لري.

preview DB ته نتیجه نه لیکي، نسخه او allergy نه بدلوي. د څو collections
لوستل atomic snapshot نه دي؛ له هر سمون وروسته بیا check وکړئ. ثابت rule IDs
او د دوا versions د دې preview شواهد دي؛ د signing SafetyCheck ځای نه نیسي.
معتبر provider، clinical evidence، عمومي audit او prescription revision سره
نښلول لا پاتې دي. د sourceVersion مقدار د demo بڼه ده، clinical freshness نه دی.

```powershell
node --test controller/patientAllergyController.test.js controller/medicineController.test.js
```

د ۲۰۲۶-۱۱-۲۶ focused run: **۱۲۰ بریالۍ، صفر ناکامې**؛ ۹۳ د allergy/mapping/
preview/interaction ګډې ازموینې او ۲۷ د catalog دي. د تعامل ۲۱ نوې cases
شاملې دي، او موجود permission/session/visit tests نوی endpoint هم ګوري.
نور suites په دې پړاو کې بیا نه دي چلول شوي. ازموینې خپل موقتي MongoDB
او خیالي fixtures کاروي؛ `.env` او عادي DB نه کاروي. mongod په PATH یا
MONGOD_BINARY کې پکار دی.
