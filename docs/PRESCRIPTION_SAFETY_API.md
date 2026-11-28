# د Draft د حساسیت او تعامل ساتل شوې کتنه

نېټه: ۲۰۲۶-۱۱-۲۸

دا برخه د catalog Draft د یوه مشخص revision لپاره د حساسیت او تعامل ګډه
پایله په `SafetyCheck` collection کې ساتي. معلومات **simulated** دي او د
واقعي ناروغ د درملنې لپاره مناسب نه دي. حتی `clear` د واقعي خوندي والي
تایید نه دی. `usableForSigning` تل `false` دی؛ signing لا نه دی جوړ شوی.

## فایلونه او تګلاره

`prescriptionRoutes → protect/doctor/active profile → validation → controller → models`

- `models/SafetyCheck.js`: د هرې کتنې ثابت record، hashes، وخت، سرچینه او پایلې.
- `middleware/prescriptionSafetyValidation.js`: د IDs او numeric revision کتنه؛ اضافي fields نه مني.
- `controller/prescriptionSafetyController.js`: اجازه، محاسبه، save او د زړې پایلې پېژندل.
- `controller/prescriptionSafetyData.js`: د اړوندو inputs لوستل او ثابت content hash جوړول.
- `controller/medicationSafety.js`: د حساسیت او تعامل پخوانی ګډ منطق؛ previews یې هم کاروي.

Prescription، patient، doctor او appointment د موجود Draft څخه اخیستل کېږي.
Client یوازې revision لېږي؛ status، دواوې، findings او hashes نه شي ټاکلای.
د کتنې جوړول د Draft محتوا، revision یا status نه بدلوي. بیا کتنه نوی record
جوړوي؛ پخوانی record نه بدلوي. د کتنو PATCH/DELETE او عمومي history list نشته.

## په Postman کې ازموینه

۱. سرور په `npm run dev` وچلوئ. د فعال profile لرونکي doctor حساب ته signin
وکړئ او **Authorization → Bearer Token** کې token واچوئ. خپل ملاقات باید
وخت ته رسېدلی او `in_progress` وي. د هماغه ملاقات catalog Draft جوړ کړئ؛
لارښود په [PRESCRIPTION_DRAFT_API.md](PRESCRIPTION_DRAFT_API.md) کې دی.

۲. د Draft `_id` او اوسنی `revision` واخلئ. د پخواني free-text Prescription
پر ځای `format: catalog_v1` او `status: draft` لرونکې نسخه وکاروئ.

```http
POST {{baseUrl}}/api/prescriptions/{{prescriptionId}}/check-safety
Content-Type: application/json
```

**Body → raw → JSON**:

```json
{
  "revision": 1
}
```

بریالی ځواب `201` دی. `safetyCheck` کې دا مهم fields وګورئ:

- `_id`، `prescription`، `revision`، `checkedBy` او `checkedAt`.
- `status`: `warning`، `unknown` یا محدود simulated `clear`.
- `allergy` او `interaction`: جلا findings، versions او coverage.
- `contentHash`: د هماغې نسخې محتوا SHA-256 نښه.
- `inputHash` او `inputSnapshot`: لوستل شوي catalog، allergy او rule معلومات.
- `mode: simulated`، `source`، `sourceVersion`، `algorithmVersion` او notice.

دوه hashes د بدلون د معلومولو لپاره دي؛ digital signature نه دي.

۳. وروستۍ کتنه ولولئ؛ GET ته Body مه لېږئ:

```http
GET {{baseUrl}}/api/prescriptions/{{prescriptionId}}/safety-checks/latest
```

د یوې مشخصې پخوانۍ کتنې لپاره د POST له ځواب څخه `_id` وکاروئ:

```http
GET {{baseUrl}}/api/prescriptions/{{prescriptionId}}/safety-checks/{{checkId}}
```

۴. د Draft notes په تازه revision سره PATCH کړئ. پخوانۍ کتنه بیا GET کړئ؛
`freshness.state` به `stale` او reasons کې `revision_changed` او
`prescription_content_changed` وي. نوی check د نوي revision په لېږلو جوړ کړئ.
پخوانۍ پایله او شواهد په DB کې هماغسې پاتې کېږي.

## پایله او تازه والی

| field | معنا |
| --- | --- |
| status: warning | exact allergy mapping یا خیالي interaction rule خبرداری لري؛ نیمګړتیا یې نه پټوي |
| status: unknown | معلومات یا pair coverage نیمګړي دي؛ د خطر نشتوالی نه ثابتوي |
| status: clear | دواړه محدودې محاسبې بشپړې دي او په خیالي معلوماتو کې warning نشته |
| freshness: current | لوستل شوې محتوا او inputs برابر دي او coverage بشپړ دی؛ warning هم current کېدای شي |
| freshness: incomplete | بدلون نه دی موندل شوی، خو coverage نیمګړی دی |
| freshness: stale | revision، محتوا، inputs، algorithm یا medicine snapshots بدل شوي دي |

حساسیت نه ثبتېدل، unmapped راپور او بې‌قاعدې ingredient pair `unknown`
ساتي. Refuted راپورونه نه ارزول کېږي. د `clear` خیالي مثال لپاره له دواوو
سره نه برابر mapped allergy او د هرې جوړې څرګند `no_demo_interaction` rule
پکار دی؛ د قواعدو لارښود په [INTERACTION_API.md](INTERACTION_API.md) کې دی.
د حقیقي دواوو لپاره قواعد مه اټکلوئ.

د دوا version/strength/ingredients یا source بدلون زوړ Draft snapshot مني نه؛
POST `409` ورکوي. په Draft PATCH کې د medicines بشپړ لېست په څرګند ډول بیا
ولېږئ، نوی revision واخلئ، بیا check وکړئ. Notes-only PATCH snapshots نه تازه کوي.
د allergy اضافه کول، review/refute او د اړوندو rules بدلون پخوانۍ پایله زړوي.

## اجازه، محدودیت او تېروتنې

درې واړه لارې یوازې لیکونکی فعال doctor د هماغه اصلي روان ملاقات پر مهال
کارولای شي. د بل doctor نسخه `404` ده. Admin او نور roles `403` اخلي.
ملاقات completed یا راتلونکی وي، لاسرسی `403` دی، حتی پخوانۍ کتنې ته.

| HTTP | لامل |
| --- | --- |
| 400 | ناسم ID/revision، اضافي body fields یا query parameters |
| 401 | token ورک، ناسم، expired یا logout شوی |
| 403 | ناسم role/profile یا د اصلي ملاقات اجازه نشته |
| 404 | نسخه، ناروغ یا د همدې نسخې کتنه نشته |
| 409 | زوړ revision، legacy/non-draft، زاړه snapshots یا د محاسبې پر مهال بدلون |
| 500 | DB ناکامي؛ د تازه یا clear پایلې ادعا نه کوي |

تر ۲۰ دواوو، ۴۰ distinct اجزاوو او ۷۸۰ جوړو محدودیت شته. د حساسیتونو لومړي
۲۰۰ راپورونه ارزول کېږي؛ تر ۲۰۱ bounded inputs او ټول شمېر ساتل کېږي.
له ۲۰۰ پورته coverage تل incomplete وي؛ د پاتې راپورونو د هر بدلون بشپړه
تاریخچه/fingerprint نه ساتل کېږي او داسې check هېڅکله current نه ښودل کېږي.

له save مخکې محتوا، inputs او ملاقات بیا لوستل کېږي؛ د لوستلو پر مهال
موندل شوی بدلون `409` کوي. څو queries atomic transaction نه دي؛ د وروستي
لوستلو وروسته بدلون لا ممکن دی. GET هم د خپل لوستلو پر وخت پرتله کوي.
دا برخه د signing لپاره atomic ثبوت، عمومي audit یا معتبر clinical provider
نه دی. راتلونکی signing باید بیا validation او مناسب concurrency تضمین ولري.

## ازموینې

```powershell
node --test controller/prescriptionDraftController.test.js controller/patientAllergyController.test.js controller/medicineController.test.js
```

د ۲۰۲۶-۱۱-۲۸ پایله: **۱۶۷ بریالۍ، صفر ناکامې**؛ ۴۷ Draft/SafetyCheck،
۹۳ allergy/mapping/previews/interaction او ۲۷ catalog ازموینې. د SafetyCheck
۱۸ نوې ازموینې شاملې دي. هر suite جلا موقتي DB او خیالي معلومات کاروي؛
عادي DB او `.env` نه لولي. نور modules او بشپړ suite بیا نه دي چلول شوي.
