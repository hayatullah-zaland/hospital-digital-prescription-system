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

د ډاکټر profile، کاري وختونو او Postman بشپړ لارښود:
[docs/DOCTOR_API.md](docs/DOCTOR_API.md).

د ملاقاتونو ثبت، تش وختونه، حالت، reschedule او Postman ازموینه:
[docs/APPOINTMENT_API.md](docs/APPOINTMENT_API.md).

د login، session او logout ساده تشریح او Postman ازموینه:
[docs/AUTH_API.md](docs/AUTH_API.md).

د خپل ملاقات طبي ریکارډ، draft، finalize او د اصلاح تاریخچه:
[docs/MEDICAL_RECORD_API.md](docs/MEDICAL_RECORD_API.md).

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

د اوسني login logout او session revocation جوړ دي. Refresh-token flow،
د User عمومي فعال حالت، audit logging، clinical safety checks، signing او
pharmacy processing لا د پورته پلان برخه دي.

د backend دننه `npm run dev` وچلوئ. د لومړي مدیر لپاره `POST /api/auth/signup` ته `role: hospital_admin` ولېږئ.

د auth/session، Doctor، ملاقاتونو او Medical Records دایمي اتومات ازموینې په `npm test` چلېږي. `mongod`
باید په PATH کې وي، یا یې بشپړ path په `MONGOD_BINARY` کې وټاکئ. Test خپل
جلا موقتي DB کاروي. جزئیات په [Doctor API لارښود](docs/DOCTOR_API.md) او
[د ملاقاتونو لارښود](docs/APPOINTMENT_API.md) کې دي.
د auth ازموینې او تازه token اخیستل په [AUTH_API.md](docs/AUTH_API.md) کې دي.
د طبي ریکارډ ازموینه په [MEDICAL_RECORD_API.md](docs/MEDICAL_RECORD_API.md) کې ده.

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
