# Hospital Digital Prescription Management System — Backend

The complete project requirements are preserved in
[docs/PROJECT_REQUIREMENTS.txt](docs/PROJECT_REQUIREMENTS.txt).
Future development follows this specification and [AGENTS.md](AGENTS.md).

د Backend معماري، collections، API لارې، اجازې او مرحله‌وار پلان په
[docs/BACKEND_PLAN.md](docs/BACKEND_PLAN.md) کې دي. لومړی ټول Backend او
ازموینې بشپړوو، وروسته Frontend. نوي فولډرونه نه جوړوو.

Patient registration, search, and record viewing are documented in
[PATIENT_API.md](PATIENT_API.md), including role permissions and Postman examples.

Doctor prescription creation and viewing are documented in
[PRESCRIPTION_API.md](PRESCRIPTION_API.md).

د فهرست له دواوو سره د نسخې Draft جوړول، سمون، revision او Postman ازموینه:
[docs/PRESCRIPTION_DRAFT_API.md](docs/PRESCRIPTION_DRAFT_API.md).

د ډاکټر profile، کاري وختونو او Postman بشپړ لارښود:
[docs/DOCTOR_API.md](docs/DOCTOR_API.md).

د ملاقاتونو ثبت، تش وختونه، حالت، reschedule او Postman ازموینه:
[docs/APPOINTMENT_API.md](docs/APPOINTMENT_API.md).

د login، session او logout ساده تشریح او Postman ازموینه:
[docs/AUTH_API.md](docs/AUTH_API.md).

د خپل ملاقات طبي ریکارډ، draft، finalize او د اصلاح تاریخچه:
[docs/MEDICAL_RECORD_API.md](docs/MEDICAL_RECORD_API.md).

د ناروغ حساسیتونه، د روانې معاینې اجازه، review او د بدلونونو تاریخچه:
[docs/PATIENT_ALLERGY_API.md](docs/PATIENT_ALLERGY_API.md).

د فعالو دواوو له اجزاوو سره د حساسیت simulated پرتله او Postman ازموینه:
[docs/ALLERGY_CHECK_API.md](docs/ALLERGY_CHECK_API.md).

د دواوو ترمنځ د تعامل خیالي قواعد، د روان ملاقات preview او Postman ازموینه:
[docs/INTERACTION_API.md](docs/INTERACTION_API.md).

د دواوو ازمایښتي فهرست، اجزا، اجازې او Postman ازموینه:
[docs/MEDICINE_API.md](docs/MEDICINE_API.md).

اوس authentication د **Bearer JWT او AuthSession** له لارې کار کوي.

```text
server.js → routes → middleware → controller → models
```

- `server.js`: Express او MongoDB اتصال.
- `models/User.js`: حساب، رول او bcrypt password hash.
- `models/AuthSession.js`: د هر login session، expiry او revokedAt.
- `middleware/authMiddleware.js`: JWT، فعال session او د کارن اجازه چک کوي.
- `controller/authController.js`: signup، signin، logout او خپل حساب.
- `models/Patient.js` او `controller/patientController.js`: د ناروغ ثبت، لټون، کتنه او سمون.
- `models/Prescription.js` او `controller/prescriptionController.js`: ساده نسخې جوړول او کتل.
- `controller/prescriptionDraftController.js` او `middleware/prescriptionDraftValidation.js`:
  د خپل روان ملاقات catalog Draft، medicine snapshots او revision خوندي سمون.
- `models/Doctor.js` او `controller/doctorController.js`: د doctor حساب مسلکي profile، availability او فعال حالت.
- `middleware/doctorValidation.js`: د ډاکټر د معلوماتو validation په `validator` کوي؛
  د کوډ د لوستلو ساده پښتو لارښود په [DOCTOR_API.md](docs/DOCTOR_API.md) کې دی.
- `models/Appointment.js`، `controller/appointmentController.js` او
  `controller/appointmentScheduleController.js`: ملاقاتونه، کاري وختونه او تاریخچه.
- `middleware/appointmentValidation.js`: د ملاقات input validation.
- `models/MedicalRecord.js` او `controller/medicalRecordController.js`: د خپل
  ملاقات طبي یادښتونه، draft/finalize او linked corrections.
- `middleware/medicalRecordValidation.js` او `medicalRecordAccess.js`: input،
  فعال doctor profile او د لیکلو اجازه؛ د نورو ډاکټرانو ګډ history لا پاتې دی.
- `models/PatientAllergy.js` او `controller/patientAllergyController.js`: حساسیتونه،
  review، version، تاریخچه او اختیاري Ingredient mapping؛ د خپل روان ملاقات doctor یې اداره کوي.
- `middleware/patientAllergyAccess.js` او `patientAllergyValidation.js`: اجازه او input.
- `controller/allergyCheckController.js`: د خپل روان ملاقات لپاره simulated
  allergy preview؛ exact IDs، warning/unknown/محدود clear او coverage.
- `models/Ingredient.js`، `models/Medicine.js` او `controller/medicineController.js`:
  د دواوو simulated فهرست، ثابت اجزا، لټون او version لرونکی سمون.
- `middleware/medicineValidation.js`: د دواوو/اجزاوو input او query validation.
- `models/KnowledgeRule.js` او `controller/interactionController.js`: د اجزاوو
  ثابت خیالي قواعد او د خپل روان ملاقات simulated interaction preview.
- `middleware/interactionValidation.js`: د قواعدو input او query validation.
- `middleware/jsonErrorHandler.js`: ناسم JSON ته ساده JSON ځواب.

د اوسني login logout او session revocation جوړ دي. Refresh-token flow،
د User عمومي فعال حالت، audit logging، clinical safety checks، signing او
pharmacy processing لا د پورته پلان برخه دي.

د backend دننه `npm run dev` وچلوئ. د لومړي مدیر لپاره `POST /api/auth/signup` ته `role: hospital_admin` ولېږئ.

د auth/session، Doctor، ملاقاتونو، Medical Records او allergies دایمي اتومات ازموینې په `npm test` چلېږي. `mongod`
باید په PATH کې وي، یا یې بشپړ path په `MONGOD_BINARY` کې وټاکئ. Test خپل
جلا موقتي DB کاروي. جزئیات په [Doctor API لارښود](docs/DOCTOR_API.md) او
[د ملاقاتونو لارښود](docs/APPOINTMENT_API.md) کې دي.
د auth ازموینې او تازه token اخیستل په [AUTH_API.md](docs/AUTH_API.md) کې دي.
د طبي ریکارډ ازموینه په [MEDICAL_RECORD_API.md](docs/MEDICAL_RECORD_API.md) کې ده.
د حساسیتونو ازموینه په [PATIENT_ALLERGY_API.md](docs/PATIENT_ALLERGY_API.md) کې ده.

د دواوو فهرست focused ازموینه `node --test controller/medicineController.test.js`
ده؛ د ۲۰۲۶-۱۱-۲۳ ټولې ۲۷ ازموینې بریالۍ شوې. د دې بدلون لپاره پخواني
suites بیا نه دي چلول شوي. د هرې برخې اړوند tests چلوو؛ بشپړ `npm test`
د پراخ اغېز لرونکو بدلونونو او مهمو پړاوونو لپاره دی.
د ۲۰۲۶-۱۱-۲۴ mapping بدلون لپاره د allergies او catalog دواړو focused suites
ټولې ۷۸ ازموینې بریالۍ شوې؛ نور suites بیا نه دي چلول شوي.
دا catalog خیالي دی او د واقعي درملنې لپاره مناسب نه دی. حساسیت له Ingredient
سره په لاس نښلېږي؛ د prescription بشپړ lifecycle، معتبر clinical checking او inventory لا پاتې دي.

اوس د `POST /api/patients/:patientId/allergies/check` preview شته. د همدې ورځې
وروستی focused run ۹۹ بریالۍ ازموینې لري: ۷۲ allergies/mapping/preview او ۲۷ catalog.
`clear` یوازې په محدودې simulated ID پرتله کې match نه موندل دي؛ د دوا د
واقعي خوندي والي یا د نسخې د sign کولو اجازه نه ده. معتبر provider او له
prescription revision سره ثابت check لا پاتې دي.

د ۲۰۲۶-۱۱-۲۶ simulated Drug Interaction برخه هم شته: `/api/interaction-rules`
د ثابتو خیالي قواعدو ثبت/کتنه کوي؛ `/api/patients/:patientId/interactions/check`
د خپل روان ملاقات doctor ته warning/unknown/محدود clear ورکوي. بې‌قاعدې جوړه
unknown ده؛ no_demo_interaction یوازې د خیالي مثال څرګند منفي قاعده ده.
دا معتبر clinical checking نه دی. همدغه دوه focused suites ټولې ۱۲۰ ازموینې
بریالۍ تېرې کړې: ۹۳ allergy/mapping/previews/interaction او ۲۷ catalog؛
۲۱ نوې interaction cases شاملې دي. د نورو modules suites بیا نه دي چلول شوي.

اوس `POST /api/prescriptions/drafts` او `PATCH /api/prescriptions/:id` د
فعال doctor خپل روان ملاقات لپاره catalog_v1 Draft جوړوي او سموي. snapshots،
revision conflict او legacy compatibility شته؛ ثابت SafetyCheck او signing
لا پاتې دي. د دې بدلون Draft/Doctor/catalog focused run ټولې ۱۰۹ ازموینې
بریالۍ تېرې کړې: ۲۹ نوي Draft، ۵۳ Doctor او ۲۷ catalog؛ نور suites بیا نه دي چلول شوي.

| Method | API | اجازه |
| --- | --- | --- |
| POST | /api/auth/signup | عام ثبت، رول ټاکل کېدای شي |
| POST | /api/auth/signin | ننوتل |
| POST | /api/auth/logout | د اوسني token session بندول |
| GET | /api/auth/me | JWT غواړي |
| POST | /api/auth/users | یوازې hospital_admin |

په Postman کې **Body → raw → JSON** وټاکئ. د ثبت غوښتنه name، email او password غواړي؛ login یوازې email او password غواړي. پاسورډ لږ تر لږه ۱۲ توري او تر ۷۲ UTF-8 bytes پورې وي.

```json
{
  "name": "Fictional Patient",
  "email": "patient@example.test",
  "password": "ExamplePassphrase123!"
}
```

د signin په ځواب کې `token` راځي. د `/api/auth/me`، `/api/auth/users` او نورو protected غوښتنو لپاره **Authorization → Bearer Token** وټاکئ او هماغه token پکې واچوئ:

```http
Authorization: Bearer YOUR_TOKEN
```

موجود JWT او session نږدې یو ساعت اعتبار لري. Logout هماغه session بندوي؛
له هغه token سره راتلونکې protected غوښتنې `401` ورکوي. د حساب نور loginونه
فعال پاتې کېږي. Refresh-token flow لا نه دی جوړ شوی.

له پخوانۍ نسخې tokenونه session ID نه لري؛ د خپل موجود حساب په وسیله بیا
signin وکړئ. د پخوانیو کاروونکو یا نورو DB معلوماتو پاکولو ته اړتیا نشته.

مدیر د /api/auth/users له لارې name، email، password او role لېږي. رولونه hospital_admin، receptionist، doctor، hospital_pharmacist، external_pharmacist او patient دي. عام ثبت role مني؛ که role ونه لېږل شي، patient ټاکل کېږي.

JWT_SECRET شخصي وساتئ. موجودې protected غوښتنې token په Authorization header کې غواړي. د راتلونکي browser د CORS، cookies او session تګلاره په Backend پلان کې ده. د authentication کوډ لپاره لومړی `routes/authRoutes.js`، بیا `middleware/authMiddleware.js` او `controller/authController.js` ولولئ.
